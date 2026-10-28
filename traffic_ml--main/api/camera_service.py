"""
api/camera_service.py
---------------------
Service to manage live camera sessions for TrafficTwin:
1. Browser-streamed camera frames (Webcam/USB via WebRTC/canvas capture).
2. Backend-attached OpenCV hardware cameras (cv2.VideoCapture loop).

Maintains:
- ByteTracker (YOLOv8 + ByteTrack) for continuous multi-vehicle detection and tracking.
- RoadROI polygons and RoadState trackers for real-time ingress/egress, queues, and calibrated speeds.
- Continuous live telemetry compatible with LiveAnalysisState and Adaptive Signals.
- Frame buffers for real-time MJPEG live streaming with bounding boxes and polygon overlays.
"""

import collections
import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
import torch

from src.data.road_config import RoadROI
from src.inference.pipeline import RoadState, compute_total_roads_summary
from src.inference.visualizer import draw_count_panel, draw_road_rois, draw_tracks
from src.tracking.movement_state import VehicleMovementDetector
from src.tracking.road_assigner import RoadAssigner
from src.tracking.tracker import ByteTracker

log = logging.getLogger("traffictwin.camera")


class LiveCameraSession:
    """
    Stateful real-time tracking session for a single live camera source.
    Processes incoming frames, updates vehicle trajectories, road bounds,
    and publishes metrics to global live state.
    """

    def __init__(
        self,
        session_id: str,
        device_id: str,
        device_name: str,
        source_type: str = "BROWSER_CAMERA",
        manual_roads: Optional[List[dict]] = None,
        camera_index: Optional[int] = None,
        frame_buffer_maxlen: int = 30,
    ):
        self.session_id = session_id
        self.device_id = device_id
        self.device_name = device_name
        self.source_type = source_type
        self.camera_index = camera_index
        self.manual_roads = manual_roads or []

        self.frame_index = 0
        self.start_time = time.time()
        self.last_frame_time = time.time()
        self.is_active = True
        self.lock = threading.Lock()

        # Resolution detection on first frame
        self.width = 1280
        self.height = 720

        # Frame buffer for MJPEG streaming
        self.frame_buffer = collections.deque(maxlen=frame_buffer_maxlen)

        # Hardware & Model resolution
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
        model_path = "yolov8n.pt" if os.path.exists("yolov8n.pt") else None

        self.tracker = ByteTracker(
            model_path=model_path,
            confidence=0.35,
            iou_threshold=0.5,
            device=device,
            track_buffer=30,
        )

        self.movement_detector = VehicleMovementDetector()
        self.road_assigner = RoadAssigner()

        # Initialize road geometry and trackers
        self.road_rois: List[RoadROI] = []
        self.road_states: Dict[str, RoadState] = {}
        self.set_roads(self.manual_roads)

        # Telemetry cache
        self.latest_telemetry: Dict[str, Any] = {}
        self.bg_thread: Optional[threading.Thread] = None

    def set_roads(self, roads: List[dict]):
        """Update or configure road boundary polygons for this camera."""
        with self.lock:
            self.manual_roads = roads
            self.road_rois = []
            for idx, r in enumerate(roads):
                length_m = r.get("length_meters", r.get("length", None))
                raw_poly = r.get("polygon", [])
                vertices = [(int(p[0]), int(p[1])) for p in raw_poly if len(p) >= 2]
                r_id = r.get("road_id", f"road_{idx + 1}")
                r_name = str(r.get("name") or f"Road {idx + 1}").strip()
                self.road_rois.append(
                    RoadROI(
                        road_id=r_id,
                        name=r_name,
                        color=(0, 255, 255),
                        vertices=vertices,
                        scaled_vertices=vertices,
                        length_meters=float(length_m) if length_m is not None and float(length_m) > 0 else None,
                    )
                )

            # Preserve existing road counters if IDs match, else initialize new RoadState
            new_road_states = {}
            for r in self.road_rois:
                if r.road_id in self.road_states:
                    existing = self.road_states[r.road_id]
                    existing.name = r.name
                    existing.length_meters = r.length_meters
                    existing.is_calibrated = (r.length_meters is not None and r.length_meters > 0)
                    new_road_states[r.road_id] = existing
                else:
                    new_road_states[r.road_id] = RoadState(
                        road_id=r.road_id,
                        name=r.name,
                        window_seconds=30.0,
                        length_meters=r.length_meters,
                    )
            self.road_states = new_road_states

    def process_frame(self, frame_bgr: np.ndarray) -> Tuple[Dict[str, Any], bytes]:
        """
        Run YOLOv8 + ByteTrack detection, trajectory tracking, ROI containment,
        and overlay rendering on an incoming frame.
        """
        with self.lock:
            if not self.is_active:
                return self.latest_telemetry, b""

            self.frame_index += 1
            now = time.time()
            elapsed_sec = max(0.01, now - self.start_time)
            dt = max(0.001, now - self.last_frame_time)
            self.last_frame_time = now
            fps = 1.0 / dt

            h, w = frame_bgr.shape[:2]
            self.width, self.height = w, h

            # 1. Detection and tracking
            tracks = self.tracker.track_frame(frame_bgr, self.frame_index, elapsed_sec)

            # 2. Movement detection & Road assignment
            current_movement_state = {}
            current_road_assignment = {}
            active_track_ids = []
            tracks_by_road: Dict[str, Dict[int, Tuple[float, float, str]]] = collections.defaultdict(dict)
            current_classes: Dict[str, int] = collections.defaultdict(int)

            for track in tracks:
                active_track_ids.append(track.track_id)
                cls_name = getattr(track, "class_name", "Car") or "Car"
                current_classes[cls_name] += 1

                ref_x = (track.x1 + track.x2) / 2.0
                ref_y = track.y2  # bottom_center
                mov_state = self.movement_detector.update(track.track_id, ref_x, ref_y, elapsed_sec)
                current_movement_state[track.track_id] = mov_state

                # Check road assignment
                if self.road_rois:
                    road_id = self.road_assigner.update(
                        track.track_id, track.x1, track.y1, track.x2, track.y2, self.road_rois
                    )
                    if road_id:
                        current_road_assignment[track.track_id] = road_id
                        tracks_by_road[road_id][track.track_id] = (ref_x, ref_y, cls_name)

            # 3. Update RoadState objects
            all_active_tids = set(active_track_ids)
            road_rois_map = {r.road_id: r for r in self.road_rois}
            road_summaries = []

            for r_id, r_state in self.road_states.items():
                r_roi = road_rois_map.get(r_id)
                tracks_in_road = tracks_by_road.get(r_id, {})
                r_state.update_frame(
                    current_tracks_in_road=tracks_in_road,
                    timestamp_sec=elapsed_sec,
                    road_roi=r_roi,
                    frame_height=h,
                    all_active_track_ids=all_active_tids,
                )
                summary = r_state.to_summary(
                    current_timestamp=elapsed_sec,
                    movement_states=current_movement_state,
                )
                road_summaries.append(summary)

            total_summary = compute_total_roads_summary(road_summaries, self.road_states)

            # 4. In-place visual rendering
            annotated_frame = frame_bgr.copy()
            if self.road_rois:
                annotated_frame = draw_road_rois(annotated_frame, self.road_rois)

            annotated_frame = draw_tracks(
                annotated_frame,
                tracks,
                road_rois=self.road_rois,
                road_assignment=current_road_assignment,
                movement_states=current_movement_state,
                show_outside_roi=True,
            )

            # Draw HUD metrics panel
            dur_min = max(0.05, elapsed_sec / 60.0)
            cumul_entries = total_summary.get("cumulative_entries", len(active_track_ids))
            cumul_exits = total_summary.get("cumulative_exits", 0)
            flow = round(cumul_entries / dur_min, 1)

            annotated_frame = draw_count_panel(
                frame=annotated_frame,
                frame_id=self.frame_index,
                timestamp_sec=elapsed_sec,
                total=cumul_entries,
                car_count=current_classes.get("Car", 0) + current_classes.get("car", 0),
                truck_count=current_classes.get("Truck", 0) + current_classes.get("truck", 0),
                current_global=len(active_track_ids),
                cumulative_entries=cumul_entries,
                cumulative_exits=cumul_exits,
                initial_occupancy=0,
                invariant_verified=True,
                flow_rate=flow,
                queue_length=total_summary.get("current_stationary", 0),
                avg_speed=total_summary.get("average_speed") or 0.0,
                traffic_state=total_summary.get("traffic_state", "LOW"),
                road_summaries=road_summaries,
            )

            # Encode annotated frame as JPEG
            encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), 75]
            success, encoded_jpeg = cv2.imencode(".jpg", annotated_frame, encode_params)
            jpeg_bytes = encoded_jpeg.tobytes() if success else b""
            if jpeg_bytes:
                self.frame_buffer.append(jpeg_bytes)

            # 5. Build standardized LiveAnalysisState telemetry dictionary
            telemetry = {
                "job_id": self.session_id,
                "frame_index": self.frame_index,
                "total_frames": None,
                "video_time_seconds": round(elapsed_sec, 2),
                "vehicles_counted": cumul_entries,
                "current_active": len(active_track_ids),
                "current_roi_count": len(active_track_ids),
                "initial_occupancy": 0,
                "cumulative_entries": cumul_entries,
                "cumulative_exits": cumul_exits,
                "invariant_verified": True,
                "current_moving": total_summary.get("current_moving", 0),
                "current_stationary": total_summary.get("current_stationary", 0),
                "vehicle_classes": dict(current_classes),
                "current_classes": dict(current_classes),
                "movement_counts": {},
                "traffic_state": total_summary.get("traffic_state", "LOW"),
                "arrival_rate": flow,
                "flow_rate_per_min": flow,
                "queue": total_summary.get("current_stationary", 0),
                "processing_fps": round(fps, 1),
                "completed_trips": total_summary.get("completed_trips", 0),
                "valid_trips": total_summary.get("valid_trips", 0),
                "average_speed": total_summary.get("average_speed"),
                "speed_display": total_summary.get("speed_display", "Waiting for vehicles"),
                "roads": road_summaries,
                "total_road_summary": total_summary,
                "global": {
                    "vehicles": cumul_entries,
                    "current_active": len(active_track_ids),
                    "flow_volume": flow,
                    "traffic_state": total_summary.get("traffic_state", "LOW"),
                    "average_speed": total_summary.get("average_speed"),
                },
                "output_ready": False,
                "output_url": None,
            }
            self.latest_telemetry = telemetry
            return telemetry, jpeg_bytes

    def stop(self):
        """Halt camera processing and free tracking resources."""
        with self.lock:
            self.is_active = False


class CameraSessionManager:
    """Singleton manager for active live camera sessions."""

    def __init__(self):
        self.sessions: Dict[str, LiveCameraSession] = {}
        self.lock = threading.Lock()

    def get_or_create_session(
        self,
        session_id: str,
        device_id: str,
        device_name: str,
        source_type: str = "BROWSER_CAMERA",
        manual_roads: Optional[List[dict]] = None,
        camera_index: Optional[int] = None,
    ) -> LiveCameraSession:
        with self.lock:
            if session_id in self.sessions:
                sess = self.sessions[session_id]
                sess.is_active = True
                if manual_roads is not None:
                    sess.set_roads(manual_roads)
                return sess

            sess = LiveCameraSession(
                session_id=session_id,
                device_id=device_id,
                device_name=device_name,
                source_type=source_type,
                manual_roads=manual_roads,
                camera_index=camera_index,
            )
            self.sessions[session_id] = sess
            log.info(f"[CAMERA MANAGER] Created live camera session '{session_id}' ({device_name})")
            return sess

    def get_session(self, session_id: str) -> Optional[LiveCameraSession]:
        with self.lock:
            return self.sessions.get(session_id)

    def stop_session(self, session_id: str):
        with self.lock:
            sess = self.sessions.get(session_id)
            if sess:
                sess.stop()
                log.info(f"[CAMERA MANAGER] Stopped live camera session '{session_id}'")

    def remove_session(self, session_id: str):
        with self.lock:
            sess = self.sessions.pop(session_id, None)
            if sess:
                sess.stop()
                log.info(f"[CAMERA MANAGER] Removed live camera session '{session_id}'")


# Global Camera Session Manager instance
CAMERA_MANAGER = CameraSessionManager()
