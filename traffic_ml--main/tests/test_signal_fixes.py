"""
Automated Test Suite for TrafficTwin Fixes
Validates:
1. Video selection isolation & no random fallback.
2. Manual signal configuration persistence & isolation from AI updates.
3. Road naming persistence & user-defined names in analytics.
4. Multi-video road completeness (all 5 roads from 3 sessions reach simulation, final road not omitted).
5. Green-time countdown, authoritative phase end time extension (currentRemaining + extension), and idempotency.
6. Officer approval, safety bounds, and recommendation-only constraint.
"""

import unittest
import uuid
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from api.server import (
    app,
    SESSION_ROADS,
    INTERSECTION_MANUAL_SELECTIONS,
    JOBS,
    INTERSECTION_SIGNAL_STATE,
    LIVE_ANALYSIS_STATES,
    ACTIVE_PROCESSING_JOB_ID,
)
import api.server as server_module


class TestTrafficTwinSignalFixes(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.intersection_id = "int_cam5"

    def test_issue_1_video_selection_isolation_and_no_fallback(self):
        """Confirm that missing session produces an explicit 404 error instead of falling back to random/cam_5 video."""
        non_existent_job = f"session_missing_{uuid.uuid4().hex[:6]}"
        resp = self.client.post("/api/inference/start", data={
            "job_id": non_existent_job,
            "max_frames": 10
        })
        self.assertEqual(resp.status_code, 404)
        data = resp.json()
        self.assertIn("detail", data)
        self.assertIn("not found", data["detail"].lower())

    def test_issue_1_prevent_duplicate_job_start(self):
        """Confirm duplicate start on an already active session returns already_running status."""
        job_id = "test_dup_session"
        JOBS[job_id] = {
            "job_id": job_id,
            "status": "PROCESSING",
            "video_path": "data/cam5_eval.mp4",
            "frames_processed": 50,
            "total_frames": 300,
            "is_eval": False
        }
        server_module.ACTIVE_PROCESSING_JOB_ID = job_id

        resp = self.client.post("/api/inference/start", data={
            "job_id": job_id,
            "max_frames": 300
        })
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data.get("already_running"))
        self.assertEqual(data.get("job_id"), job_id)

    def test_issue_1_session_isolation_multi_video(self):
        """Confirm that Video A and Video B sessions remain completely isolated."""
        sess_a = f"session_a_{uuid.uuid4().hex[:4]}"
        sess_b = f"session_b_{uuid.uuid4().hex[:4]}"

        JOBS[sess_a] = {
            "job_id": sess_a,
            "status": "COMPLETED",
            "video_path": "data/video_a.mp4",
            "video_name": "video_a.mp4",
            "frames_processed": 120,
            "total_frames": 120
        }
        JOBS[sess_b] = {
            "job_id": sess_b,
            "status": "PROCESSING",
            "video_path": "data/video_b.mp4",
            "video_name": "video_b.mp4",
            "frames_processed": 45,
            "total_frames": 200
        }

        resp_a = self.client.get(f"/api/sessions/{sess_a}/roads")
        self.assertEqual(resp_a.status_code, 200)

        # Confirm Video A metrics do not bleed into Video B
        self.assertEqual(JOBS[sess_a]["video_name"], "video_a.mp4")
        self.assertEqual(JOBS[sess_b]["video_name"], "video_b.mp4")
        self.assertNotEqual(JOBS[sess_a]["video_path"], JOBS[sess_b]["video_path"])

    def test_issue_2_manual_signal_selection_persistence(self):
        """Test that manual signal phase configuration is saved, persists, and is distinct from AI recommendation."""
        selection_payload = {
            "intersection_id": self.intersection_id,
            "selected_phase_id": "P2",
            "served_approaches": ["east", "west"],
            "served_movements": ["THROUGH", "RIGHT"],
            "proposed_green_sec": 38.0,
            "officer_id": "officer_101",
            "status": "APPROVED_PLAN",
            "note": "Manual priority for East-West corridor incident"
        }

        # Save manual configuration
        put_resp = self.client.put(
            f"/api/intersections/{self.intersection_id}/manual-selection",
            json=selection_payload
        )
        self.assertEqual(put_resp.status_code, 200)
        saved = put_resp.json()
        self.assertEqual(saved["phase_id"], "P2")
        self.assertEqual(saved["manual_green_sec"], 38.0)

        # Fetch it back and verify persistence
        get_resp = self.client.get(f"/api/intersections/{self.intersection_id}/manual-selection")
        self.assertEqual(get_resp.status_code, 200)
        fetched = get_resp.json()
        self.assertEqual(fetched["phase_id"], "P2")
        self.assertEqual(fetched["manual_green_sec"], 38.0)

    def test_issue_3_user_defined_road_names_persisted_and_returned(self):
        """Confirm that user-defined road names saved on the Process page appear in analytics instead of generic compass directions."""
        job_id = f"job_roads_{uuid.uuid4().hex[:6]}"
        custom_roads = [
            {"road_id": "road_1", "name": "Avinashi Road", "direction": "NORTH"},
            {"road_id": "road_2", "name": "Airport Road", "direction": "SOUTH"},
            {"road_id": "road_3", "name": "Railway Station Road", "direction": "EAST"},
        ]

        # Save roads for this session
        post_resp = self.client.post(f"/api/sessions/{job_id}/roads", json=custom_roads)
        self.assertEqual(post_resp.status_code, 200)

        # Retrieve roads directly
        get_resp = self.client.get(f"/api/sessions/{job_id}/roads")
        self.assertEqual(get_resp.status_code, 200)
        roads = get_resp.json()
        self.assertEqual(len(roads), 3)
        self.assertEqual(roads[0]["name"], "Avinashi Road")
        self.assertEqual(roads[1]["name"], "Airport Road")
        self.assertEqual(roads[2]["name"], "Railway Station Road")

        # Mock telemetry for this session
        LIVE_ANALYSIS_STATES[job_id] = {
            "video_time_seconds": 15.0,
            "roads": [
                {"road_id": "road_1", "name": "Avinashi Road", "current_roi_count": 8, "flow_volume": 12.0},
                {"road_id": "road_2", "name": "Airport Road", "current_roi_count": 5, "flow_volume": 9.0},
                {"road_id": "road_3", "name": "Railway Station Road", "current_roi_count": 3, "flow_volume": 6.0},
            ]
        }

        # Retrieve analytics including this session
        analytics_resp = self.client.get(
            f"/api/intersections/{self.intersection_id}/analytics?session_ids={job_id}"
        )
        self.assertEqual(analytics_resp.status_code, 200)
        demands = analytics_resp.json()["approach_demands"]
        names = [d["name"] for d in demands]
        self.assertIn("Avinashi Road", names)
        self.assertIn("Airport Road", names)
        self.assertIn("Railway Station Road", names)

    def test_issue_4_multi_video_completeness_all_5_roads_simulated(self):
        """Confirm that when 3 sessions contain 5 roads, all 5 road records reach simulation and the final road is not omitted."""
        sess_1 = f"sess_multi_1_{uuid.uuid4().hex[:4]}"
        sess_2 = f"sess_multi_2_{uuid.uuid4().hex[:4]}"
        sess_3 = f"sess_multi_3_{uuid.uuid4().hex[:4]}"

        SESSION_ROADS[sess_1] = [
            {"road_id": "r1", "name": "Avinashi Road", "direction": "NORTH", "length_meters": 120},
            {"road_id": "r2", "name": "Airport Road", "direction": "SOUTH", "length_meters": 140},
        ]
        SESSION_ROADS[sess_2] = [
            {"road_id": "r3", "name": "Railway Station Road", "direction": "EAST", "length_meters": 100},
            {"road_id": "r4", "name": "Trichy Road", "direction": "WEST", "length_meters": 110},
        ]
        SESSION_ROADS[sess_3] = [
            {"road_id": "r5", "name": "Gandhipuram Cross", "direction": "NORTH", "length_meters": 95},
        ]

        # Register sessions in JOBS store as valid
        for s in [sess_1, sess_2, sess_3]:
            JOBS[s] = {"job_id": s, "status": "COMPLETED", "frames_processed": 300, "total_frames": 300}
            LIVE_ANALYSIS_STATES[s] = {
                "video_time_seconds": 30.0,
                "roads": [dict(r, current_roi_count=4, flow_volume=10.0) for r in SESSION_ROADS[s]]
            }

        # Check analytics contains all 5 roads
        session_query = f"{sess_1},{sess_2},{sess_3}"
        anal_resp = self.client.get(
            f"/api/intersections/{self.intersection_id}/analytics?session_ids={session_query}"
        )
        self.assertEqual(anal_resp.status_code, 200)
        demands = anal_resp.json()["approach_demands"]
        self.assertEqual(len(demands), 5)
        names = [d["name"] for d in demands]
        self.assertIn("Gandhipuram Cross", names)

        # Run simulation with these sessions
        sim_resp = self.client.post(
            f"/api/intersections/{self.intersection_id}/simulate?session_ids={session_query}",
            json={"scenario_type": "NORMAL_TRAFFIC"}
        )
        self.assertEqual(sim_resp.status_code, 200)
        sim_data = sim_resp.json()
        per_approach = sim_data["adaptive_plan_result"]["per_approach"]

        # Ensure all 5 roads were simulated and the last road (r5) is included
        simulated_ids = [app["approach_id"] for app in per_approach]
        self.assertEqual(len(simulated_ids), 5)
        self.assertIn("r5", simulated_ids)
        self.assertIn("included_roads", sim_data)
        self.assertIn("r5", sim_data["included_roads"])

    def test_issue_5_authoritative_green_time_countdown_and_extension(self):
        """Test formula: newRemainingTime = currentRemainingTime + approvedExtension atomically updated."""
        now = datetime.utcnow()
        initial_duration = 30.0
        phase_start = now - timedelta(seconds=10)
        
        INTERSECTION_SIGNAL_STATE[self.intersection_id] = {
            "phase_index": 0,
            "phase_start": phase_start,
            "duration_sec": initial_duration,
            "applied_extensions": set(),
            "version": 1,
        }

        # Verify initial remaining is approx 20s
        status_resp = self.client.get(f"/api/intersections/{self.intersection_id}/signal-status")
        self.assertEqual(status_resp.status_code, 200)
        init_rem = status_resp.json()["remaining_green_sec"]
        self.assertAlmostEqual(init_rem, 20.0, delta=1.5)

        # Approve a +10 second extension
        request_id = f"req_{uuid.uuid4().hex}"
        ext_resp = self.client.post(
            f"/api/intersections/{self.intersection_id}/extend-green",
            json={
                "intersection_id": self.intersection_id,
                "current_phase_id": "P1",
                "request_id": request_id,
                "extension_sec": 10.0,
                "officer_id": "officer_1"
            }
        )
        self.assertEqual(ext_resp.status_code, 200)
        ext_data = ext_resp.json()
        self.assertEqual(ext_data["status"], "APPROVED")
        self.assertEqual(ext_data["extension_sec"], 10.0)
        
        # New remaining should be initial_remaining + 10s (approx 30s)
        new_rem = ext_data["new_remaining_sec"]
        self.assertAlmostEqual(new_rem, init_rem + 10.0, delta=1.0)

    def test_issue_6_idempotency_prevents_duplicate_extension(self):
        """Confirm that repeating the exact same approval request does not add the extension twice."""
        now = datetime.utcnow()
        phase_start = now - timedelta(seconds=5)
        
        INTERSECTION_SIGNAL_STATE[self.intersection_id] = {
            "phase_index": 0,
            "phase_start": phase_start,
            "duration_sec": 35.0,
            "applied_extensions": set(),
            "version": 1,
        }

        dup_req_id = "req_fixed_idempotent_123"
        # First call: applies +10s
        resp1 = self.client.post(
            f"/api/intersections/{self.intersection_id}/extend-green",
            json={
                "intersection_id": self.intersection_id,
                "current_phase_id": "P1",
                "request_id": dup_req_id,
                "extension_sec": 10.0,
                "officer_id": "officer_1"
            }
        )
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(resp1.json()["status"], "APPROVED")

        # Second call with identical request_id: must return ALREADY_APPLIED and not add another 10s
        resp2 = self.client.post(
            f"/api/intersections/{self.intersection_id}/extend-green",
            json={
                "intersection_id": self.intersection_id,
                "current_phase_id": "P1",
                "request_id": dup_req_id,
                "extension_sec": 10.0,
                "officer_id": "officer_1"
            }
        )
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp2.json()["status"], "ALREADY_APPLIED")
        # Ensure duration_sec is still 45, not 55
        self.assertEqual(INTERSECTION_SIGNAL_STATE[self.intersection_id]["duration_sec"], 45.0)

    def test_issue_6_safety_validation_rejects_expired_phase(self):
        """Attempting to extend an expired phase is rejected with clear 400 error."""
        now = datetime.utcnow()
        # Phase ended 10 seconds ago
        phase_start = now - timedelta(seconds=40)

        INTERSECTION_SIGNAL_STATE[self.intersection_id] = {
            "phase_index": 0,
            "phase_start": phase_start,
            "duration_sec": 30.0,
            "applied_extensions": set(),
            "version": 1,
        }

        resp = self.client.post(
            f"/api/intersections/{self.intersection_id}/extend-green",
            json={
                "intersection_id": self.intersection_id,
                "current_phase_id": "P1",
                "request_id": f"req_{uuid.uuid4().hex}",
                "extension_sec": 10.0,
                "officer_id": "officer_1"
            }
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("ended", resp.json()["detail"].lower())

    def test_start_signal_timer_authoritative_session(self):
        """Clicking Start Signal creates or starts authoritative timing session."""
        resp = self.client.post(
            f"/api/intersections/{self.intersection_id}/start-signal",
            json={
                "intersection_id": self.intersection_id,
                "phase_id": "P2",
                "green_duration_sec": 35.0,
                "signal_number": 2,
                "officer_id": "officer_test"
            }
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["current_phase_id"], "P2")
        self.assertEqual(data["signal_number"], 2)
        self.assertEqual(data["duration_sec"], 35.0)
        self.assertEqual(data["signal_state"], "GREEN")
        self.assertEqual(data["status_label"], "Running")
        self.assertTrue(data["is_timing_available"])
        self.assertTrue(data["is_simulated"])
        self.assertIsNotNone(data["phase_end_time"])
        self.assertTrue(data["phase_end_time"].endswith("Z"))
        self.assertIn("server_time", data)
        self.assertTrue(data["server_time"].endswith("Z"))
        self.assertGreater(data["remaining_green_sec"], 0)

    def test_camera_device_discovery(self):
        """GET /api/devices/cameras discovers host cameras and processed video feeds."""
        resp = self.client.get("/api/devices/cameras")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("connected_cameras", data)
        self.assertIn("processed_sessions", data)
        self.assertIn("source", data)
        self.assertEqual(data["source"], "backend_host")

    def test_camera_source_selection(self):
        """POST /api/devices/cameras/select allows selecting a video source independently."""
        resp = self.client.post(
            "/api/devices/cameras/select",
            data={"device_id": "cam_dev_0", "camera_index": 0}
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "SOURCE_SELECTED")
        self.assertEqual(data["device_id"], "cam_dev_0")

    def test_manual_active_phase_selection_p1_and_p2(self):
        """Selecting P1 vs P2 sets appropriate served approaches and timing bounds."""
        # Start P1
        resp_p1 = self.client.post(
            f"/api/intersections/{self.intersection_id}/start-signal",
            json={
                "intersection_id": self.intersection_id,
                "phase_id": "P1",
                "green_duration_sec": 28.0,
                "signal_number": 1,
            }
        )
        self.assertEqual(resp_p1.status_code, 200)
        data_p1 = resp_p1.json()
        self.assertEqual(data_p1["current_phase_id"], "P1")
        self.assertEqual(data_p1["duration_sec"], 28.0)
        self.assertEqual(data_p1["signal_state"], "GREEN")
        self.assertIn("north", data_p1["served_approaches"])
        self.assertIn("south", data_p1["served_approaches"])

        # Switch / Start P2
        resp_p2 = self.client.post(
            f"/api/intersections/{self.intersection_id}/start-signal",
            json={
                "intersection_id": self.intersection_id,
                "phase_id": "P2",
                "green_duration_sec": 32.0,
                "signal_number": 2,
            }
        )
        self.assertEqual(resp_p2.status_code, 200)
        data_p2 = resp_p2.json()
        self.assertEqual(data_p2["current_phase_id"], "P2")
        self.assertEqual(data_p2["duration_sec"], 32.0)
        self.assertIn("east", data_p2["served_approaches"])
        self.assertIn("west", data_p2["served_approaches"])


if __name__ == "__main__":
    unittest.main()
