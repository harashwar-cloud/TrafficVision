import type {
  CurrentState, SimulationResult, Recommendation, CameraInfo,
  IntersectionSummary, IntersectionConfig, IntersectionAnalytics,
  SignalRecommendation, SignalSimulationResult, PlanComparison,
  SignalPhasesResponse, AuditLogEntry, SimulationScenarioType,
  VideoReadinessReport, SignalStatusResponse,
} from '../types';

// Support both VITE_API_BASE_URL (standard) and VITE_API_URL (backward-compat)
// Defaults to local backend during dev; production relies strictly on configured environment variable
const rawApiBase = (
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1'
    ? '' // In production, if unset, use relative origin
    : 'http://127.0.0.1:8000')
);
const API_BASE_URL = (rawApiBase || 'http://127.0.0.1:8000').replace(/\/+$/, '');

class TrafficApiService {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  get apiBaseUrl(): string {
    return this.baseUrl;
  }

  async checkHealth(): Promise<{ status: string; gpu_available: boolean; device?: string; gpu_name?: string; precision?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      if (!res.ok) throw new Error('Health check failed');
      return await res.json();
    } catch {
      return { status: 'offline', gpu_available: false };
    }
  }

  async getCurrentTraffic(): Promise<CurrentState> {
    const res = await fetch(`${this.baseUrl}/api/traffic/current`);
    if (!res.ok) throw new Error('Failed to fetch current traffic state from server');
    return await res.json();
  }

  async getCameras(): Promise<CameraInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/cameras`);
      if (!res.ok) throw new Error('Failed to fetch cameras');
      return await res.json();
    } catch {
      return [
        { camera_id: 'cam_5', name: 'Intersection 5 (Fisheye 4-Leg)', type: 'four-leg signalized', fps: 10.0, has_gt: true },
        { camera_id: 'cam_1', name: 'Intersection 1 (PTZ Angle)', type: 'three-leg signalized', fps: 10.0, has_gt: false },
        { camera_id: 'cam_7', name: 'Intersection 7 (Overhead Normal)', type: 'four-leg signalized', fps: 10.0, has_gt: false },
        { camera_id: 'cam_9', name: 'Camera 9 (Highway Ramp)', type: 'highway interchange', fps: 10.0, has_gt: false },
        { camera_id: 'cam_10', name: 'Camera 10 (Single Approach)', type: 'single-approach', fps: 10.0, has_gt: false }
      ];
    }
  }

  async startInference(cameraIdOrJobId: string = 'cam_5', maxFrames: number = 600, roadsConfig?: any[]): Promise<{ job_id: string; status: string }> {
    const formData = new FormData();
    formData.append('job_id', cameraIdOrJobId);
    formData.append('max_frames', maxFrames.toString());
    if (roadsConfig && roadsConfig.length > 0) {
      formData.append('roads_json', JSON.stringify(roadsConfig));
    }

    const res = await fetch(`${this.baseUrl}/api/inference/start`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Failed to start inference');
    return await res.json();
  }

  async stopInference(jobId: string): Promise<{ job_id: string; status: string; message: string }> {
    const res = await fetch(`${this.baseUrl}/api/inference/${jobId}/stop`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to stop inference');
    return await res.json();
  }

  async deleteSession(jobId: string): Promise<{ job_id: string; status: string }> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${jobId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete session');
    return await res.json();
  }

  async startAllInference(maxFrames: number = 600): Promise<{ status: string; message: string; jobs: Array<{ camera_id: string; job_id: string }> }> {
    const formData = new FormData();
    formData.append('max_frames', maxFrames.toString());

    const res = await fetch(`${this.baseUrl}/api/inference/start-all`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Failed to start simultaneous multi-camera inference');
    return await res.json();
  }

  async uploadVideo(file: File, cameraId: string = 'cam_5'): Promise<{ job_id: string; filename: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('camera_id', cameraId);

    const res = await fetch(`${this.baseUrl}/api/video/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error('Failed to upload video');
    return await res.json();
  }

  async getInferenceStatus(jobId: string) {
    const res = await fetch(`${this.baseUrl}/api/inference/${jobId}/status`);
    if (!res.ok) throw new Error('Failed to get job status');
    return await res.json();
  }

  async getActiveSession(): Promise<{
    active: boolean;
    job_id: string | null;
    status: string;
    camera_id?: string;
    video_name?: string;
    frames_processed?: number;
    total_frames?: number;
    current_fps?: number;
    video_time_seconds?: number;
    vehicles_counted?: number;
    current_active?: number;
    current_stationary?: number;
    current_moving?: number;
    traffic_state?: string;
    flow_rate_per_min?: number;
    average_speed?: number | null;
    roads?: any[];
    output_ready?: boolean;
    output_url?: string | null;
    error_message?: string | null;
  }> {
    const res = await fetch(`${this.baseUrl}/api/session/active`);
    if (!res.ok) throw new Error('Failed to get active session');
    return await res.json();
  }

  async getJobResults(jobId: string) {
    const res = await fetch(`${this.baseUrl}/api/results/${jobId}`);
    if (!res.ok) throw new Error(`Failed to get results for job ${jobId}`);
    return await res.json();
  }

  async getDebugResults(jobId: string) {
    const res = await fetch(`${this.baseUrl}/api/debug/results/${jobId}`);
    if (!res.ok) throw new Error(`Failed to get debug results for job ${jobId}`);
    return await res.json();
  }

  async runSimulation(jobId: string = 'demo-cam5', strategies: string[] = ['current', '+10sec', '+20sec', '+30sec']): Promise<SimulationResult> {
    const res = await fetch(`${this.baseUrl}/api/simulation/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, strategies }),
    });
    if (!res.ok) throw new Error('Failed to run simulation');
    return await res.json();
  }

  async getRecommendation(): Promise<Recommendation> {
    const res = await fetch(`${this.baseUrl}/api/recommendation`);
    if (!res.ok) throw new Error('Failed to fetch recommendation');
    return await res.json();
  }

  getVideoUrl(pathOrUrl?: string): string {
    if (!pathOrUrl) return '';
    if (pathOrUrl.startsWith('http')) return pathOrUrl;
    return `${this.baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }

  getLiveStreamUrl(jobId: string): string {
    return `${this.baseUrl}/api/stream/${jobId}`;
  }

  getWsUrl(jobId?: string): string {
    const wsProto = this.baseUrl.startsWith('https') ? 'wss' : 'ws';
    const host = this.baseUrl.replace(/^https?:\/\//, '');
    const endpoint = jobId ? `/ws/analysis/${jobId}` : '/ws/traffic';
    return `${wsProto}://${host}${endpoint}`;
  }

  async getLiveAnalysisState(jobId: string) {
    const res = await fetch(`${this.baseUrl}/api/analysis/${jobId}/live`);
    if (!res.ok) throw new Error('Failed to get live analysis state');
    return await res.json();
  }

  async getCamerasOverview(): Promise<{ network_summary: any; cameras: any[] }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/cameras/overview`);
      if (!res.ok) throw new Error('Failed to fetch cameras overview');
      return await res.json();
    } catch (err) {
      console.warn('Using fallback camera list:', err);
      return {
        network_summary: {
          total_cameras: 5,
          active_cameras: 5,
          analyzing_cameras: 1,
          monitoring_cameras: 4,
          total_vehicles: 137,
          critical_alerts: 2,
          avg_flow_rate: 26.8
        },
        cameras: [
          {
            camera_id: 'cam_5',
            cam_number: 'CAM 01',
            name: 'Intersection 5 (Fisheye 4-Leg) • (GT Verified)',
            subtitle: 'Fisheye 4-Leg',
            type: 'four-leg signalized',
            has_gt: true,
            status: 'LIVE',
            job_id: 'demo-cam5',
            vehicles_counted: 137,
            traffic_state: 'CRITICAL',
            flow_rate_per_min: 44.0,
            queue: 57,
            video_url: '/api/video/stream/cam5_eval_annotated.mp4',
            car_count: 135,
            truck_count: 2,
            fps: 10.0
          },
          {
            camera_id: 'cam_1',
            cam_number: 'CAM 02',
            name: 'Intersection 1 (PTZ Angle)',
            subtitle: 'PTZ Angle',
            type: 'three-leg signalized',
            has_gt: false,
            status: 'MONITORING',
            job_id: 'demo-cam_1',
            vehicles_counted: 3,
            traffic_state: 'MEDIUM',
            flow_rate_per_min: 3.0,
            queue: 8,
            video_url: '/api/video/stream/cam_1.mp4',
            car_count: 3,
            truck_count: 0,
            fps: 10.0
          },
          {
            camera_id: 'cam_7',
            cam_number: 'CAM 03',
            name: 'Intersection 7 (Overhead Normal)',
            subtitle: 'Overhead Normal',
            type: 'four-leg signalized',
            has_gt: false,
            status: 'MONITORING',
            job_id: 'demo-cam_7',
            vehicles_counted: 18,
            traffic_state: 'HIGH',
            flow_rate_per_min: 18.0,
            queue: 18,
            video_url: '/api/video/stream/cam_7.mp4',
            car_count: 18,
            truck_count: 0,
            fps: 10.0
          },
          {
            camera_id: 'cam_9',
            cam_number: 'CAM 04',
            name: 'Camera 9 (Highway Ramp)',
            subtitle: 'Highway Ramp',
            type: 'highway interchange',
            has_gt: false,
            status: 'MONITORING',
            job_id: 'demo-cam_9',
            vehicles_counted: 5,
            traffic_state: 'MEDIUM',
            flow_rate_per_min: 5.0,
            queue: 9,
            video_url: '/api/video/stream/cam_9.mp4',
            car_count: 5,
            truck_count: 0,
            fps: 10.0
          },
          {
            camera_id: 'cam_10',
            cam_number: 'CAM 05',
            name: 'Camera 10 (Single Approach)',
            subtitle: 'Single Approach',
            type: 'single-approach',
            has_gt: false,
            status: 'MONITORING',
            job_id: 'demo-cam_10',
            vehicles_counted: 64,
            traffic_state: 'CRITICAL',
            flow_rate_per_min: 64.0,
            queue: 52,
            video_url: '/api/video/stream/cam_10.mp4',
            car_count: 64,
            truck_count: 0,
            fps: 10.0
          }
        ]
      };
    }
  }

  async getCameraTraffic(cameraId: string): Promise<CurrentState> {
    const res = await fetch(`${this.baseUrl}/api/traffic/camera/${cameraId}`);
    if (!res.ok) throw new Error(`Failed to fetch traffic state for ${cameraId}`);
    return await res.json();
  }

  // ==========================================================================
  // ADAPTIVE SIGNAL CONTROL API METHODS
  // ==========================================================================

  async getIntersections(): Promise<IntersectionSummary[]> {
    try {
      const res = await fetch(`${this.baseUrl}/api/intersections`);
      if (!res.ok) throw new Error('Failed to fetch intersections');
      return await res.json();
    } catch {
      return [];
    }
  }

  async getIntersection(intersectionId: string): Promise<IntersectionConfig> {
    const res = await fetch(`${this.baseUrl}/api/intersections/${intersectionId}`);
    if (!res.ok) throw new Error(`Failed to fetch intersection ${intersectionId}`);
    return await res.json();
  }

  async getIntersectionAnalytics(intersectionId: string): Promise<IntersectionAnalytics> {
    const res = await fetch(`${this.baseUrl}/api/intersections/${intersectionId}/analytics`);
    if (!res.ok) throw new Error(`Failed to fetch analytics for intersection ${intersectionId}`);
    return await res.json();
  }

  async getSignalPhases(intersectionId: string): Promise<SignalPhasesResponse> {
    const res = await fetch(`${this.baseUrl}/api/intersections/${intersectionId}/signal-phases`);
    if (!res.ok) throw new Error(`Failed to fetch signal phases for ${intersectionId}`);
    return await res.json();
  }

  async getVideoReadiness(intersectionId: string, sessionIds?: string[]): Promise<VideoReadinessReport> {
    const query = sessionIds && sessionIds.length > 0 ? `?session_ids=${encodeURIComponent(sessionIds.join(','))}` : '';
    const res = await fetch(`${this.baseUrl}/api/intersections/${intersectionId}/video-readiness${query}`);
    if (!res.ok) throw new Error(`Failed to fetch video readiness for intersection ${intersectionId}`);
    return await res.json();
  }

  async getSignalStatus(intersectionId: string, triggerSec = 8.0): Promise<SignalStatusResponse> {
    const res = await fetch(`${this.baseUrl}/api/intersections/${intersectionId}/signal-status?trigger_threshold_sec=${triggerSec}`);
    if (!res.ok) throw new Error(`Failed to fetch signal status for ${intersectionId}`);
    return await res.json();
  }

  async generateSignalRecommendation(intersectionId: string, triggerSource: 'SCHEDULED_8S' | 'MANUAL' = 'MANUAL'): Promise<SignalRecommendation> {
    const res = await fetch(`${this.baseUrl}/api/intersections/${intersectionId}/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger_source: triggerSource }),
    });
    if (!res.ok) throw new Error(`Failed to generate recommendation for ${intersectionId}`);
    return await res.json();
  }

  async approveRecommendation(
    intersectionId: string,
    recommendationId: string,
    approvedGreenSec: number,
    officerId = 'officer_1'
  ): Promise<SignalRecommendation> {
    const res = await fetch(
      `${this.baseUrl}/api/intersections/${intersectionId}/recommendations/${recommendationId}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officer_id: officerId, approved_green_sec: approvedGreenSec }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any)?.detail || `Failed to approve recommendation ${recommendationId}`);
    }
    return await res.json();
  }

  async rejectRecommendation(
    intersectionId: string,
    recommendationId: string,
    rejectionReason?: string,
    officerId = 'officer_1'
  ): Promise<SignalRecommendation> {
    const res = await fetch(
      `${this.baseUrl}/api/intersections/${intersectionId}/recommendations/${recommendationId}/reject`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officer_id: officerId, rejection_reason: rejectionReason }),
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any)?.detail || `Failed to reject recommendation ${recommendationId}`);
    }
    return await res.json();
  }

  async getRecommendationHistory(intersectionId: string, limit = 20): Promise<SignalRecommendation[]> {
    const res = await fetch(
      `${this.baseUrl}/api/intersections/${intersectionId}/recommendations/history?limit=${limit}`
    );
    if (!res.ok) throw new Error(`Failed to fetch recommendation history for ${intersectionId}`);
    return await res.json();
  }

  async runSignalSimulation(
    intersectionId: string,
    scenarioType: SimulationScenarioType = 'NORMAL_TRAFFIC',
    durationSec = 3600,
    seed = 42,
    demandOverrides?: Record<string, Record<string, number>>,
  ): Promise<SignalSimulationResult> {
    const res = await fetch(`${this.baseUrl}/api/intersections/${intersectionId}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenario_type: scenarioType,
        simulation_duration_sec: durationSec,
        random_seed: seed,
        demand_overrides: demandOverrides || {},
      }),
    });
    if (!res.ok) throw new Error(`Failed to run simulation for ${intersectionId}`);
    return await res.json();
  }

  async compareSignalPlans(
    intersectionId: string,
    scenarioType: SimulationScenarioType = 'NORMAL_TRAFFIC',
  ): Promise<PlanComparison> {
    const res = await fetch(`${this.baseUrl}/api/intersections/${intersectionId}/compare-plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario_type: scenarioType }),
    });
    if (!res.ok) throw new Error(`Failed to compare plans for ${intersectionId}`);
    return await res.json();
  }

  async getIntersectionAuditLog(intersectionId: string, limit = 50): Promise<AuditLogEntry[]> {
    const res = await fetch(
      `${this.baseUrl}/api/intersections/${intersectionId}/audit-log?limit=${limit}`
    );
    if (!res.ok) throw new Error(`Failed to fetch audit log for ${intersectionId}`);
    return await res.json();
  }

  async updateIntersectionConfig(intersectionId: string, config: Partial<IntersectionConfig>): Promise<{ status: string; intersection_id: string }> {
    const res = await fetch(`${this.baseUrl}/api/intersections/${intersectionId}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any)?.detail?.message || `Failed to update config for ${intersectionId}`);
    }
    return await res.json();
  }

  async saveSessionRoads(jobId: string, roads: any[]): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${jobId}/roads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(roads),
    });
    if (!res.ok) throw new Error(`Failed to save roads for session ${jobId}`);
    return await res.json();
  }

  async getSessionRoads(jobId: string): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${jobId}/roads`);
    if (!res.ok) return [];
    return await res.json();
  }

  async getManualSignalSelection(intersectionId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/intersections/${intersectionId}/manual-selection`);
    if (!res.ok) throw new Error(`Failed to get manual selection for ${intersectionId}`);
    return await res.json();
  }

  async saveManualSignalSelection(intersectionId: string, selection: any): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/intersections/${intersectionId}/manual-selection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selection),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any)?.detail || `Failed to save manual selection for ${intersectionId}`);
    }
    return await res.json();
  }

  async extendGreen(
    intersectionId: string,
    requestOrPhase: any,
    extensionSec?: number,
    requestId?: string,
    officerId: string = 'officer_1'
  ): Promise<any> {
    const bodyData = typeof requestOrPhase === 'object' && requestOrPhase !== null
      ? requestOrPhase
      : {
          intersection_id: intersectionId,
          current_phase_id: requestOrPhase,
          extension_sec: extensionSec,
          request_id: requestId,
          officer_id: officerId,
        };

    const res = await fetch(`${this.baseUrl}/api/intersections/${intersectionId}/extend-green`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any)?.detail || `Failed to extend green for ${intersectionId}`);
    }
    return await res.json();
  }

  async startSignalTimer(intersectionId: string, payload: any): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/intersections/${intersectionId}/start-signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any)?.detail || `Failed to start signal timer for ${intersectionId}`);
    }
    return await res.json();
  }
}

export const api = new TrafficApiService();

