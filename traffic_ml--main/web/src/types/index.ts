// TrafficTwin Domain Models & API Types

export type TrafficState = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';

export type AnalysisStatus = 'IDLE' | 'UPLOADING' | 'PROCESSING' | 'ANALYZING' | 'SIMULATING' | 'READY' | 'ERROR';

export interface MovementCount {
  movement_id: number;
  movement_description: string;
  count: number;
  car_count: number;
  truck_count: number;
  flow_rate_per_min: number;
  state: TrafficState;
}

export interface TrafficMetrics {
  traffic_state: TrafficState;
  total_vehicle_count: number;
  car_count: number;
  truck_count: number;
  flow_rate_per_min: number;
  timestamp_sec: number;
  frames_processed: number;
  direction_imbalance_detected: boolean;
  direction_imbalance_ratio: number;
  dominant_movement?: number;
  average_speed?: number;
  by_movement: MovementCount[];
  current_roi_count?: number;
  initial_occupancy?: number;
  cumulative_entries?: number;
  cumulative_exits?: number;
  invariant_verified?: boolean;
}

export interface TrafficPrediction {
  future_queue_estimate: number;
  future_congestion_pct: number;
  time_horizon_sec: number;
  confidence: number;
}

export interface HistoryPoint {
  timestamp_sec: number;
  frame_id: number;
  total_count: number;
  flow_rate_per_min: number;
  state: TrafficState;
}

export interface SimulationStrategy {
  strategy_id: string; // 'current' | '+10sec' | '+20sec' | '+30sec'
  label: string;
  green_phase_extension_sec: number;
  predicted_queue: number;
  predicted_wait_sec: number;
  predicted_congestion_pct: number;
  score: number;
  is_recommended: boolean;
}

export interface SimulationResult {
  job_id: string;
  strategies: SimulationStrategy[];
  recommended_strategy_id: string;
  simulation_completed: boolean;
}

export interface RecommendationFactor {
  factor: string;
  value: string;
  direction: 'increasing' | 'decreasing' | 'stable';
  weight: 'high' | 'medium' | 'low';
}

export interface Recommendation {
  action: string;
  strategy_id: string;
  green_phase_extension_sec: number;
  reasoning: RecommendationFactor[];
  predicted_queue_change: number;
  predicted_queue_change_pct: number;
  predicted_wait_change_sec: number;
  predicted_congestion_change_pct: number;
  confidence: number;
}

export interface CurrentState {
  job_id?: string;
  status: AnalysisStatus;
  metrics?: TrafficMetrics;
  prediction?: TrafficPrediction;
  simulation?: SimulationResult;
  recommendation?: Recommendation;
  history: HistoryPoint[];
  camera_id?: string;
  video_name?: string;
  annotated_video_url?: string;
}

export interface CameraInfo {
  camera_id: string;
  name: string;
  type: string;
  fps: number;
  has_gt: boolean;
}

export interface RoadAnalytics {
  road_id: string;
  name: string;
  vehicles?: number;
  cumulative_vehicles?: number;
  cumulative_total?: number;
  current_active?: number;
  current_roi_count?: number;
  active_track_ids?: number[];
  current_moving?: number;
  current_stationary?: number;
  current_rest?: number;
  cumulative_entries?: number;
  cumulative_exits?: number;
  completed_trips?: number;
  valid_trips?: number;
  average_speed?: number | null;
  speed_display?: string;
  length_meters?: number;
  cars: number;
  trucks: number;
  buses?: number;
  motorcycles?: number;
  bicycles?: number;
  flow_volume?: number;
  queue?: number;
  traffic_state?: TrafficState;
}

export interface PerformanceMetrics {
  gpu_name: string;
  device: string;
  precision: string;
  vram_allocated_mb: number;
  vram_reserved_mb: number;
  vram_total_mb: number;
  cpu_percent: number;
  ram_used_gb: number;
  ram_total_gb: number;
  decode_ms: number;
  preprocess_ms?: number;
  inference_ms: number;
  postprocess_ms?: number;
  tracking_ms: number;
  analytics_ms: number;
  render_ms: number;
  write_ms: number;
  total_latency_ms: number;
  processed_fps: number;
  source_fps: number;
  frames_processed: number;
  frames_skipped: number;
  inference_imgsz: number;
  flow_window_seconds?: number;
}


export interface LiveAnalysisState {
  job_id: string;
  frame_index: number;
  total_frames: number;
  video_time_seconds: number;
  timestamp_sec?: number;
  // Distinct counts: current visible vs cumulative unique
  current_active?: number;
  current_roi_count?: number;
  initial_occupancy?: number;
  cumulative_entries?: number;
  cumulative_exits?: number;
  invariant_verified?: boolean;
  current_moving?: number;
  current_stationary?: number;
  active_vehicles?: number;
  moving_vehicles?: number;
  stationary_vehicles?: number;
  vehicles_counted: number;
  vehicle_classes: {
    Car?: number;
    Truck?: number;
    Bus?: number;
    Motorcycle?: number;
    Bicycle?: number;
  };
  current_classes?: Record<string, number>;
  class_counts?: Record<string, number>;
  movement_counts: Record<string, number>;
  traffic_state: TrafficState;
  arrival_rate: number;
  flow_rate_per_min?: number;
  queue: number;
  average_speed?: number | null;
  completed_trips?: number;
  valid_trips?: number;
  speed_display?: string;
  processing_fps: number;
  direction_imbalance?: {
    detected: boolean;
    ratio: number;
    dominant_movement?: number;
  };
  // Multi-road analytics
  roads?: RoadAnalytics[];
  total_road_summary?: RoadAnalytics;
  global?: {
    vehicles: number;
    current_active?: number;
    current_moving?: number;
    current_stationary?: number;
    flow_volume: number;
    traffic_state: TrafficState;
    queue?: number;
    average_speed?: number;
  };
  // Real-time GPU & pipeline telemetry
  perf?: PerformanceMetrics;
  // Output video availability
  output_ready?: boolean;
  output_url?: string;
}

export interface CameraOverviewItem {
  camera_id: string;
  cam_number: string; // 'CAM 01', 'CAM 02', ...
  name: string;
  subtitle: string;
  type: string;
  has_gt: boolean;
  status: 'LIVE' | 'ANALYZING' | 'MONITORING' | 'COMPLETED' | 'OFFLINE' | 'ERROR';
  job_id: string;
  vehicles_counted: number;
  traffic_state: TrafficState;
  flow_rate_per_min: number;
  queue: number;
  video_url: string;
  car_count: number;
  truck_count: number;
  dominant_movement?: number;
  movement_counts: Record<string, number>;
  fps: number;
}

export interface NetworkSummary {
  total_cameras: number;
  active_cameras: number;
  analyzing_cameras: number;
  monitoring_cameras: number;
  total_vehicles: number;
  critical_alerts: number;
  avg_flow_rate: number;
}

export interface NetworkOverview {
  network_summary: NetworkSummary;
  cameras: CameraOverviewItem[];
}

export interface VideoSession {
  videoId: string;
  sessionId?: string;
  file?: File | null;
  videoName?: string;
  videoStatus: AnalysisStatus;
  processingProgress: number;
  roiPolygons: any[];
  activeTrackIds?: number[];
  currentROICount?: number;
  cumulativeEntries?: number;
  cumulativeExits?: number;
  roadAnalytics?: RoadAnalytics[];
  averageSpeed?: number | null;
  error?: string | null;
}


// ============================================================================
// ADAPTIVE SIGNAL CONTROL — Types
// ============================================================================

export type DataQualityFlag = 'GOOD' | 'PARTIAL' | 'STALE' | 'MISSING';
export type MovementDirection = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST' |
  'NORTHEAST' | 'NORTHWEST' | 'SOUTHEAST' | 'SOUTHWEST' | 'UNKNOWN';
export type VehicleMovementType = 'THROUGH' | 'LEFT_TURN' | 'RIGHT_TURN' | 'U_TURN';
export type SimulationScenarioType =
  | 'LOW_TRAFFIC' | 'NORMAL_TRAFFIC' | 'PEAK_TRAFFIC'
  | 'UNEVEN_TRAFFIC' | 'INCREASED_TURNING' | 'APPROACH_BLOCKED' | 'HIGH_ARRIVAL_RATE';

export interface ApproachConfig {
  approach_id: string;
  direction: MovementDirection;
  name: string;
  road_id?: string;
  job_id?: string;
  permitted_movements: VehicleMovementType[];
  has_pedestrian_crossing: boolean;
  pedestrian_clearance_sec: number;
  lane_count: number;
}

export interface SignalPhase {
  phase_id: string;
  phase_name: string;
  served_approaches: string[];
  permitted_movements: VehicleMovementType[];
  conflicting_phases: string[];
  min_green_sec: number;
  max_green_sec: number;
  amber_sec: number;
  all_red_sec: number;
  pedestrian_walk_sec?: number | null;
  sequence_position: number;
}

export interface IntersectionConfig {
  intersection_id: string;
  name: string;
  camera_id?: string;
  intersection_type: string;
  approaches: ApproachConfig[];
  phases: SignalPhase[];
  phase_constraints: Array<{ phase_a: string; phase_b: string; reason: string }>;
  cycle_length_sec: number;
  min_cycle_sec: number;
  max_cycle_sec: number;
  fixed_plan_name?: string;
  fixed_plan_green_times: Record<string, number>;
  demand_weight_queue: number;
  demand_weight_arrival: number;
  demand_weight_waiting: number;
  demand_weight_occupancy: number;
  max_queue_veh: number;
  max_arrival_veh_per_min: number;
  max_wait_sec: number;
  max_occupancy_pct: number;
  stale_data_threshold_sec: number;
}

export interface IntersectionSummary {
  intersection_id: string;
  name: string;
  camera_id?: string;
  intersection_type: string;
  n_approaches: number;
  n_phases: number;
  fixed_plan_name?: string;
}

export interface ApproachDemand {
  approach_id: string;
  direction: MovementDirection;
  name: string;
  road_id?: string;
  queue_length_veh?: number | null;
  arrival_rate_veh_per_min?: number | null;
  avg_wait_sec?: number | null;
  occupancy_pct?: number | null;
  avg_speed_kmh?: number | null;
  moving_count?: number | null;
  stationary_count?: number | null;
  traffic_state?: TrafficState | null;
  score_queue?: number | null;
  score_arrival?: number | null;
  score_waiting?: number | null;
  score_occupancy?: number | null;
  demand_score?: number | null;
  data_quality: DataQualityFlag;
  confidence: number;
  data_age_sec?: number | null;
  last_updated?: string | null;
  time_since_served_sec?: number | null;
  starvation_boost_applied: boolean;
}

export interface PhaseRecommendation {
  phase_id: string;
  phase_name: string;
  served_approaches: string[];
  proposed_green_sec: number;
  amber_sec: number;
  all_red_sec: number;
  aggregate_demand_score: number;
  per_approach_demand: ApproachDemand[];
  queue_evidence: string;
  wait_evidence: string;
  reason: string;
  min_green_respected: boolean;
  max_green_respected: boolean;
  conflicts_cleared: boolean;
  pedestrian_clearance_included: boolean;
}

export interface PhaseScore {
  phase_id: string;
  phase_name: string;
  demand_score: number;
  served_approaches: string[];
}

export type RecommendationStatus =
  | 'WAITING_FOR_DATA'
  | 'READY'
  | 'PENDING_OFFICER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'SUPERSEDED'
  | 'INVALIDATED'
  | 'GENERATED'
  | 'CONSTRAINT_FAILED';

export interface SignalRecommendation {
  recommendation_id: string;
  intersection_id: string;
  timestamp: string;
  source_job_ids: string[];
  recommended_phase: PhaseRecommendation;
  approach_demands: ApproachDemand[];
  fixed_plan_comparison?: {
    baseline_plan: string;
    baseline_green_sec?: number | null;
    proposed_green_sec: number;
    delta_sec?: number | null;
    note: string;
  } | null;
  data_quality: DataQualityFlag;
  status: RecommendationStatus | string;
  mode: string;
  confidence: number;
  fallback_to_baseline: boolean;
  fallback_reason?: string | null;
  constraint_validation_passed: boolean;
  constraint_violations: string[];
  all_phase_scores: PhaseScore[];
  officer_decision?: 'APPROVED' | 'REJECTED' | null;
  officer_id?: string | null;
  decision_timestamp?: string | null;
  rejection_reason?: string | null;
  approved_green_sec?: number | null;
  trigger_source?: 'SCHEDULED_8S' | 'MANUAL';
}

export interface SessionReadinessItem {
  session_id: string;
  camera_id: string;
  video_name: string;
  status: string;
  frames_processed: number;
  total_frames: number;
  progress_pct: number;
  latest_timestamp_sec?: number | null;
  roads_mapped: string[];
  is_valid: boolean;
  validation_note: string;
}

export interface VideoReadinessReport {
  intersection_id: string;
  is_ready: boolean;
  valid_session_count: number;
  required_min: number;
  allowed_max: number;
  coverage_status: 'COMPLETE' | 'PARTIAL' | 'MISSING' | 'INCOMPLETE' | 'CONFIG_ERROR' | string;
  uncovered_approaches: string[];
  recommendation_available: boolean;
  reasons: string[];
  sessions: SessionReadinessItem[];
}

export interface SignalStatusResponse {
  intersection_id: string;
  intersection_name?: string;
  signal_number?: number;
  current_phase_id: string;
  current_phase_name: string;
  served_approaches: string[];
  served_road_names?: string[];
  signal_state?: 'GREEN' | 'AMBER' | 'RED' | 'SIMULATED' | string;
  status_label?: 'Running' | 'Waiting for Approval' | 'Transitioning' | 'Completed' | 'Paused' | string;
  phase_start_time: string;
  phase_end_time?: string | null;
  duration_sec: number;
  elapsed_sec: number;
  remaining_green_sec?: number | null;
  amber_sec?: number;
  all_red_sec?: number;
  amber_end_time?: string | null;
  all_red_end_time?: string | null;
  server_time?: string | null;
  version?: number;
  is_timing_available: boolean;
  is_simulated: boolean;
  recommendation_trigger_sec: number;
  should_trigger_recommendation: boolean;
}

export interface CameraDeviceItem {
  device_id: string;
  index: number;
  name: string;
  device_type: string;
  is_available: boolean;
  resolution?: string | null;
  source: string;
  status_text: string;
}

export interface CameraDiscoveryResponse {
  connected_cameras: CameraDeviceItem[];
  processed_sessions: Array<{
    source_id: string;
    name: string;
    device_type: string;
    is_available: boolean;
    job_id?: string;
    source: string;
    status_text: string;
  }>;
  scan_count: number;
  source: string;
  timestamp: string;
}

export interface StartSignalPayload {
  intersection_id: string;
  phase_id: string;
  green_duration_sec: number;
  signal_number?: number;
  served_approaches?: string[];
  officer_id?: string;
}

export interface IntersectionAnalytics {
  intersection_id: string;
  timestamp: string;
  approach_demands: ApproachDemand[];
  overall_data_quality: DataQualityFlag;
  active_job_ids: string[];
}

export interface ApproachSimResult {
  approach_id: string;
  direction: string;
  avg_delay_sec: number;
  avg_wait_sec: number;
  max_queue_veh: number;
  throughput_veh_per_hour: number;
  max_wait_sec: number;
  vehicles_served: number;
  pedestrian_compliance?: boolean | null;
  degree_of_saturation?: number;
  green_sec?: number;
}

export interface PlanSimResult {
  plan_name: string;
  plan_type: string;
  avg_delay_sec: number;
  avg_wait_sec: number;
  max_queue_veh: number;
  throughput_veh_per_hour: number;
  max_wait_sec: number;
  vehicles_served: number;
  pedestrian_compliance: boolean;
  per_approach: ApproachSimResult[];
  invalid_recommendations: number;
  notes: string;
}

export interface SignalSimulationResult {
  simulation_id: string;
  intersection_id: string;
  scenario_type: SimulationScenarioType;
  simulation_duration_sec: number;
  fixed_plan_result?: PlanSimResult | null;
  adaptive_plan_result?: PlanSimResult | null;
  delay_improvement_pct?: number | null;
  queue_improvement_pct?: number | null;
  throughput_improvement_pct?: number | null;
  methodology_note: string;
  simulation_mode: string;
}

export interface PlanComparison {
  intersection_id: string;
  scenario_type: SimulationScenarioType;
  fixed_plan: {
    name?: string;
    avg_delay_sec?: number;
    avg_wait_sec?: number;
    max_queue_veh?: number;
    throughput_veh_per_hour?: number;
    vehicles_served?: number;
    pedestrian_compliance?: boolean;
  };
  adaptive_plan: {
    name?: string;
    avg_delay_sec?: number;
    avg_wait_sec?: number;
    max_queue_veh?: number;
    throughput_veh_per_hour?: number;
    vehicles_served?: number;
    pedestrian_compliance?: boolean;
  };
  delay_improvement_pct?: number | null;
  queue_improvement_pct?: number | null;
  throughput_improvement_pct?: number | null;
  methodology_note: string;
  simulation_mode: string;
}

export interface SignalPhasesResponse {
  intersection_id: string;
  phases: SignalPhase[];
  phase_constraints: Array<{ phase_a: string; phase_b: string; reason: string }>;
  fixed_plan_green_times: Record<string, number>;
  fixed_plan_name?: string;
  validation_errors: string[];
  configuration_valid: boolean;
}

export interface AuditLogEntry {
  entry_id: string;
  timestamp: string;
  event_type: string;
  intersection_id: string;
  actor: string;
  details: Record<string, unknown>;
  recommendation_id?: string | null;
  simulation_id?: string | null;
}

export interface ManualSignalSelection {
  intersection_id: string;
  selected_phase_id: string;
  served_approaches: string[];
  served_movements: string[];
  proposed_green_sec: number;
  officer_id?: string;
  note?: string;
  created_at?: string;
  status: 'MANUAL_SELECTION' | 'PENDING_OFFICER_APPROVAL' | 'APPROVED_PLAN';
}

export interface GreenExtensionRequest {
  intersection_id: string;
  current_phase_id: string;
  recommendation_id?: string | null;
  request_id: string;
  extension_sec: number;
  expected_phase_end_time?: string | null;
  officer_id?: string;
}
