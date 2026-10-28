"""
tests/test_live_camera_processing.py
------------------------------------
Unit and integration tests for Live Camera Processing in TrafficTwin:
1. Camera session initialization (browser and backend camera modes).
2. Frame ingestion via POST /api/camera/session/{id}/frame with YOLOv8 & ByteTrack tracking.
3. Multi-source isolation (camera sessions do not overwrite each other).
4. Adaptive Signals integration (live camera analytics feed intersection demand).
5. Safe stop and cleanup.
"""

import io
import json
import unittest
import numpy as np
import cv2
from fastapi.testclient import TestClient

from api.server import app, JOBS, LIVE_ANALYSIS_STATES, SESSION_ROADS
from api.camera_service import CAMERA_MANAGER


class TestLiveCameraProcessing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def _create_synthetic_frame_bytes(self, width=640, height=480) -> bytes:
        """Create a synthetic test frame encoded as JPEG bytes."""
        img = np.zeros((height, width, 3), dtype=np.uint8)
        # Draw simulated road and vehicle shapes
        cv2.rectangle(img, (100, 100), (540, 380), (40, 40, 40), -1)
        cv2.circle(img, (320, 240), 30, (0, 255, 0), -1)
        success, buf = cv2.imencode(".jpg", img)
        return buf.tobytes()

    def test_01_start_browser_camera_session(self):
        """Test starting a browser camera session with custom road ROI."""
        sess_id = "test_browser_cam_1"
        roads = [
            {"road_id": "road_north", "name": "North Approach", "polygon": [[50, 50], [200, 50], [200, 200], [50, 200]], "length_meters": 45.0},
            {"road_id": "road_south", "name": "South Approach", "polygon": [[250, 50], [400, 50], [400, 200], [250, 200]], "length_meters": 50.0},
        ]
        resp = self.client.post("/api/camera/session/start", data={
            "session_id": sess_id,
            "device_id": "browser_webcam_uuid_123",
            "device_name": "Logitech HD Pro C920",
            "source_type": "BROWSER_CAMERA",
            "roads_json": json.dumps(roads),
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "STARTED")
        self.assertEqual(data["session_id"], sess_id)
        self.assertEqual(data["source_type"], "BROWSER_CAMERA")

        # Verify registered in JOBS and CAMERA_MANAGER
        self.assertIn(sess_id, JOBS)
        self.assertEqual(JOBS[sess_id]["status"], "PROCESSING")
        self.assertIsNotNone(CAMERA_MANAGER.get_session(sess_id))

    def test_02_process_live_camera_frame(self):
        """Test sending a frame to the live camera session for inference and telemetry update."""
        sess_id = "test_browser_cam_1"
        frame_bytes = self._create_synthetic_frame_bytes()

        files = {"frame": ("frame.jpg", io.BytesIO(frame_bytes), "image/jpeg")}
        resp = self.client.post(f"/api/camera/session/{sess_id}/frame", files=files)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "OK")
        self.assertEqual(data["session_id"], sess_id)
        self.assertGreaterEqual(data["frame_index"], 1)

        # Telemetry verification
        telem = data["telemetry"]
        self.assertEqual(telem["job_id"], sess_id)
        self.assertIn("traffic_state", telem)
        self.assertIn("roads", telem)
        self.assertEqual(len(telem["roads"]), 2)
        self.assertEqual(telem["roads"][0]["name"], "North Approach")

        # Global analysis state verification
        self.assertIn(sess_id, LIVE_ANALYSIS_STATES)
        self.assertEqual(LIVE_ANALYSIS_STATES[sess_id]["job_id"], sess_id)

    def test_03_multi_camera_session_isolation(self):
        """Test that multiple camera sources run simultaneously without cross-contamination."""
        cam_a = "test_cam_alpha"
        cam_b = "test_cam_beta"

        # Start Camera A
        self.client.post("/api/camera/session/start", data={
            "session_id": cam_a,
            "device_id": "dev_laptop_front",
            "device_name": "Integrated Camera",
            "source_type": "BROWSER_CAMERA",
        })

        # Start Camera B
        self.client.post("/api/camera/session/start", data={
            "session_id": cam_b,
            "device_id": "dev_usb_external",
            "device_name": "External USB WideCam",
            "source_type": "BROWSER_CAMERA",
        })

        # Send frame to A
        files_a = {"frame": ("frame.jpg", io.BytesIO(self._create_synthetic_frame_bytes(800, 600)), "image/jpeg")}
        resp_a = self.client.post(f"/api/camera/session/{cam_a}/frame", files=files_a)
        self.assertEqual(resp_a.status_code, 200)

        # Send frame to B
        files_b = {"frame": ("frame.jpg", io.BytesIO(self._create_synthetic_frame_bytes(1280, 720)), "image/jpeg")}
        resp_b = self.client.post(f"/api/camera/session/{cam_b}/frame", files=files_b)
        self.assertEqual(resp_b.status_code, 200)

        # Ensure session states are completely independent
        sess_a = CAMERA_MANAGER.get_session(cam_a)
        sess_b = CAMERA_MANAGER.get_session(cam_b)
        self.assertNotEqual(sess_a.device_name, sess_b.device_name)
        self.assertEqual(sess_a.session_id, cam_a)
        self.assertEqual(sess_b.session_id, cam_b)

    def test_04_camera_analytics_in_adaptive_signals(self):
        """Verify that live camera telemetry is accessible to Adaptive Signals intersection analytics."""
        sess_id = "test_browser_cam_1"
        resp = self.client.get(f"/api/intersections/int_cam5/analytics?session_ids={sess_id}")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("approach_demands", data)
        self.assertIn("active_job_ids", data)
        self.assertIn(sess_id, data["active_job_ids"])

    def test_05_camera_discovery_includes_active_live_camera(self):
        """Verify that GET /api/devices/cameras lists active live camera sessions."""
        resp = self.client.get("/api/devices/cameras")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("processed_sessions", data)
        source_ids = [s["source_id"] for s in data["processed_sessions"]]
        self.assertIn("test_browser_cam_1", source_ids)

    def test_06_stop_camera_session(self):
        """Test stopping a camera session gracefully."""
        sess_id = "test_browser_cam_1"
        resp = self.client.post(f"/api/camera/session/{sess_id}/stop")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "STOPPED")

        sess = CAMERA_MANAGER.get_session(sess_id)
        self.assertFalse(sess.is_active)


if __name__ == "__main__":
    unittest.main()
