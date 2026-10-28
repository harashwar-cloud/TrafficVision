import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { CurrentState, LiveAnalysisState, RoadAnalytics } from '../types';
import { api } from '../services/api';
import { useVideoProcessing } from '../context/VideoProcessingContext';
import { MetricCard } from '../components/common/MetricCard';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import {
  Activity, Upload, RefreshCw, Zap,
  AlertTriangle, ChevronDown, Compass,
  TrendingUp, Car, Truck, Bus, Bike, Edit, Trash2, Check,
  Plus, Square, RotateCcw, X, Film, Layers, Camera
} from 'lucide-react';

interface LiveAnalysisProps {
  state: CurrentState;
  onRefresh: () => void;
}

const FEED_SOURCES = [
  { id: 'cam_5', name: 'Intersection 5 (Fisheye 4-Leg) • (GT Verified)', videoUrl: '/api/video/stream/cam5_eval_annotated.mp4', hasGt: true },
  { id: 'cam_1', name: 'Intersection 1 (PTZ Angle)', videoUrl: '/api/video/stream/cam_1.mp4', hasGt: false },
  { id: 'cam_7', name: 'Intersection 7 (Overhead Normal)', videoUrl: '/api/video/stream/cam_7.mp4', hasGt: false },
  { id: 'cam_9', name: 'Camera 9 (Highway Ramp)', videoUrl: '/api/video/stream/cam_9.mp4', hasGt: false },
  { id: 'cam_10', name: 'Camera 10 (Single Approach)', videoUrl: '/api/video/stream/cam_10.mp4', hasGt: false },
];

const TRAFFIC_STATE_COLORS: Record<string, string> = {
  LOW:      'text-emerald-400 border-emerald-800/60 bg-emerald-950/60',
  MEDIUM:   'text-amber-400 border-amber-700/60 bg-amber-950/60',
  HIGH:     'text-orange-400 border-orange-700/60 bg-orange-950/60',
  CRITICAL: 'text-red-400 border-red-700/60 bg-red-950/60',
  UNKNOWN:  'text-slate-400 border-slate-700/60 bg-slate-950/60',
};

const ROAD_ACCENT_COLORS = [
  'border-cyan-600/60 bg-cyan-950/30',
  'border-orange-600/60 bg-orange-950/30',
  'border-violet-600/60 bg-violet-950/30',
  'border-emerald-600/60 bg-emerald-950/30',
];
const ROAD_LABEL_COLORS = ['text-cyan-400', 'text-orange-400', 'text-violet-400', 'text-emerald-400'];

type Point = [number, number];
interface ManualRoad {
  road_id: string;
  name: string;
  polygon: Point[];
  length_meters?: number;
}

// ─── Safe number coercion helpers ─────────────────────────────────────────────
const safeFixed = (val: number | null | undefined, decimals: number): string => {
  const n = typeof val === 'number' && isFinite(val) ? val : 0;
  return n.toFixed(decimals);
};

const safeNum = (val: number | null | undefined, fallback: number = 0): number => {
  return typeof val === 'number' && isFinite(val) ? val : fallback;
};

// ─── RoadCard ─────────────────────────────────────────────────────────────────
const RoadCard: React.FC<{ road: RoadAnalytics; index?: number; isSingle?: boolean }> = ({ road, index = 0, isSingle = false }) => {
  const state = road?.traffic_state ?? 'UNKNOWN';
  const stateStyle = TRAFFIC_STATE_COLORS[state] ?? TRAFFIC_STATE_COLORS.UNKNOWN;
  const accent = ROAD_ACCENT_COLORS[index % ROAD_ACCENT_COLORS.length];
  const labelColor = ROAD_LABEL_COLORS[index % ROAD_LABEL_COLORS.length];

  const activeVehicles = safeNum(road?.current_active ?? road?.current_roi_count ?? road?.vehicles, 0);
  const entries = safeNum(road?.cumulative_entries, 0);
  const exits = safeNum(road?.cumulative_exits, 0);
  const cumulativeVehicles = safeNum(road?.cumulative_total ?? road?.cumulative_vehicles ?? road?.vehicles, 0);
  const moving = safeNum(road?.current_moving, 0);
  const stationary = safeNum(road?.current_stationary ?? road?.queue, 0);
  const completedTrips = safeNum(road?.completed_trips ?? road?.valid_trips, 0);
  const avgSpeed = typeof road?.average_speed === 'number' && isFinite(road.average_speed) ? road.average_speed : null;
  const speedDisplay = road?.speed_display || (avgSpeed !== null && completedTrips > 0 ? `${avgSpeed.toFixed(1)} km/h` : 'N/A — awaiting valid trips');
  const lengthMeters = road?.length_meters;

  const cars = safeNum(road?.cars, 0);
  const trucks = safeNum(road?.trucks, 0);
  const buses = safeNum(road?.buses, 0);
  const motorcycles = safeNum(road?.motorcycles, 0);

  return (
    <div className={`border rounded-2xl p-4 shadow-xl backdrop-blur-xl ${accent} transition-all duration-300 hover:border-slate-600 ${isSingle ? 'max-w-3xl mx-auto' : ''}`}>
      {/* Header */}
      <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-slate-800/80">
        <div className="flex items-center space-x-2">
          <div className={`flex items-center justify-center w-7 h-7 rounded-lg bg-slate-950 border border-slate-800 font-mono font-bold text-xs ${labelColor} shadow-inner`}>
            R{index + 1}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className={`text-sm font-bold font-mono tracking-wide ${labelColor}`}>{road?.name ?? 'Road'}</span>
              {lengthMeters ? (
                <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[9px] font-mono text-cyan-300">
                  {lengthMeters}m calibrated
                </span>
              ) : null}
            </div>
            <span className="text-[9px] font-mono text-slate-500 uppercase">{road?.road_id ?? ''}</span>
          </div>
        </div>
        <span className={`px-2 py-0.5 text-[10px] font-bold font-mono rounded-lg border shadow-sm ${stateStyle}`}>
          {state}
        </span>
      </div>

      {/* Main Metrics 3-Col Grid */}
      <div className="grid grid-cols-3 gap-2 mb-3 text-xs font-mono">
        {/* Active Vehicles Inside ROI */}
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 text-center">
          <div className="text-slate-400 text-[9px] uppercase tracking-wider mb-0.5">Current ROI Occupancy</div>
          <div className="text-xl font-bold font-mono text-emerald-300">{activeVehicles}</div>
          <div className="text-slate-500 text-[9px] mt-0.5">{moving} moving • {stationary} stopped</div>
        </div>

        {/* Entries & Exits */}
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 text-center">
          <div className="text-slate-400 text-[9px] uppercase tracking-wider mb-0.5">Entries / Exits</div>
          <div className="text-sm font-bold font-mono text-cyan-300 mt-0.5">
            <span className="text-emerald-400">+{entries}</span> / <span className="text-amber-400">-{exits}</span>
          </div>
          <div className="text-slate-500 text-[9px] mt-0.5">{cumulativeVehicles} unique total</div>
        </div>

        {/* Calibrated Speed */}
        <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 text-center">
          <div className="text-slate-400 text-[9px] uppercase tracking-wider mb-0.5">Average Road Speed</div>
          <div className="text-sm font-bold font-mono text-violet-300 mt-0.5">
            {avgSpeed !== null && completedTrips > 0 ? `${avgSpeed.toFixed(1)} km/h` : 'N/A'}
          </div>
          <div className="text-slate-400 text-[9px] mt-0.5">
            {completedTrips > 0 ? `${completedTrips} trip${completedTrips > 1 ? 's' : ''}` : 'awaiting trips'}
          </div>
        </div>
      </div>

      {/* Speed & Trips Detailed Status */}
      <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800/70 mb-2.5 flex items-center justify-between text-xs font-mono">
        <span className="text-slate-400 text-[10px] flex items-center space-x-1">
          <TrendingUp className="w-3 h-3 text-cyan-400" />
          <span>Speed Status:</span>
        </span>
        <span className={completedTrips > 0 ? "font-bold text-cyan-300 text-[11px]" : "italic text-slate-500 text-[11px]"}>
          {speedDisplay}
        </span>
      </div>

      {/* Classes Breakdown */}
      <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] font-mono text-slate-400 pt-2 border-t border-slate-800/60">
        <span className="flex items-center space-x-1">
          <Car className="w-3 h-3 text-emerald-400" />
          <span>Cars: <strong className="text-slate-200">{cars}</strong></span>
        </span>
        {buses > 0 && (
          <span className="flex items-center space-x-1">
            <Bus className="w-3 h-3 text-amber-400" />
            <span>Buses: <strong className="text-slate-200">{buses}</strong></span>
          </span>
        )}
        <span className="flex items-center space-x-1">
          <Truck className="w-3 h-3 text-orange-400" />
          <span>Trucks: <strong className="text-slate-200">{trucks}</strong></span>
        </span>
        {motorcycles > 0 && (
          <span className="flex items-center space-x-1">
            <Bike className="w-3 h-3 text-violet-400" />
            <span>Bikes: <strong className="text-slate-200">{motorcycles}</strong></span>
          </span>
        )}
      </div>
    </div>
  );
};

// ─── TotalRoadSummaryCard ─────────────────────────────────────────────────────
const TotalRoadSummaryCard: React.FC<{ totalSummary: RoadAnalytics; roadsCount: number }> = ({ totalSummary, roadsCount }) => {
  const activeVehicles = safeNum(totalSummary?.current_active ?? totalSummary?.current_roi_count, 0);
  const entries = safeNum(totalSummary?.cumulative_entries, 0);
  const exits = safeNum(totalSummary?.cumulative_exits, 0);
  const moving = safeNum(totalSummary?.current_moving, 0);
  const stationary = safeNum(totalSummary?.current_stationary ?? totalSummary?.queue, 0);
  const completedTrips = safeNum(totalSummary?.completed_trips ?? totalSummary?.valid_trips, 0);
  const avgSpeed = typeof totalSummary?.average_speed === 'number' && isFinite(totalSummary.average_speed) ? totalSummary.average_speed : null;
  const speedDisplay = totalSummary?.speed_display || (avgSpeed !== null && completedTrips > 0 ? `${avgSpeed.toFixed(1)} km/h` : 'N/A — awaiting valid trips');

  const cars = safeNum(totalSummary?.cars, 0);
  const trucks = safeNum(totalSummary?.trucks, 0);
  const buses = safeNum(totalSummary?.buses, 0);
  const motorcycles = safeNum(totalSummary?.motorcycles, 0);

  return (
    <div className="border border-cyan-500/40 bg-gradient-to-b from-cyan-950/40 via-slate-900/90 to-slate-950 rounded-2xl p-5 shadow-2xl backdrop-blur-2xl ring-1 ring-cyan-500/20">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 mb-4 border-b border-cyan-500/20 gap-2">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 bg-cyan-950 border border-cyan-500/40 rounded-xl text-cyan-300 shadow-lg shadow-cyan-950/50">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-base font-bold font-mono tracking-wider text-slate-100 uppercase">
                ALL ROADS SUMMARY
              </h3>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded-md bg-cyan-950 border border-cyan-500/60 text-cyan-300">
                {roadsCount} ROADS
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono">
              Corridor occupancy & trip-weighted average speed
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 font-mono text-xs">
          <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-cyan-500/30 text-cyan-300 text-[11px] font-semibold">
            {completedTrips > 0 ? `${completedTrips} Valid Trips` : 'Awaiting Completed Trips'}
          </span>
        </div>
      </div>

      {/* Main 4 Gauges Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
        {/* Active Occupancy (Deduplicated) */}
        <div className="bg-slate-950/80 border border-cyan-500/30 rounded-xl p-3 shadow-inner">
          <div className="text-slate-400 text-[9px] font-mono uppercase tracking-wider mb-0.5">
            Total Occupancy
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-300 mb-0.5">{activeVehicles}</div>
          <div className="text-[9px] font-mono text-slate-500">
            {moving} moving • {stationary} stopped
          </div>
        </div>

        {/* Entries */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 shadow-inner">
          <div className="text-slate-400 text-[9px] font-mono uppercase tracking-wider mb-0.5">
            Entries
          </div>
          <div className="text-2xl font-bold font-mono text-cyan-300 mb-0.5">+{entries}</div>
          <div className="text-[9px] font-mono text-slate-500">All road polygons</div>
        </div>

        {/* Exits */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 shadow-inner">
          <div className="text-slate-400 text-[9px] font-mono uppercase tracking-wider mb-0.5">
            Exits
          </div>
          <div className="text-2xl font-bold font-mono text-amber-300 mb-0.5">-{exits}</div>
          <div className="text-[9px] font-mono text-slate-500">Confirmed departures</div>
        </div>

        {/* Overall Trip-Weighted Speed */}
        <div className="bg-slate-950/80 border border-violet-500/30 rounded-xl p-3 shadow-inner">
          <div className="text-slate-400 text-[9px] font-mono uppercase tracking-wider mb-0.5">
            Weighted Avg Speed
          </div>
          <div className="text-xl font-bold font-mono text-violet-300 mb-0.5">
            {avgSpeed !== null && completedTrips > 0 ? `${avgSpeed.toFixed(1)} km/h` : 'N/A'}
          </div>
          <div className="text-[9px] font-mono text-slate-500 truncate" title={speedDisplay}>
            {speedDisplay}
          </div>
        </div>
      </div>

      {/* Aggregate Vehicle Class Breakdown */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2.5 border-t border-slate-800/80 font-mono text-xs">
        <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-[11px]">
          <Car className="w-3 h-3 text-emerald-400" />
          <span>Cars: <strong className="text-emerald-300">{cars}</strong></span>
        </span>
        <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-[11px]">
          <Truck className="w-3 h-3 text-orange-400" />
          <span>Trucks: <strong className="text-orange-300">{trucks}</strong></span>
        </span>
        <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-[11px]">
          <Bus className="w-3 h-3 text-amber-400" />
          <span>Buses: <strong className="text-amber-300">{buses}</strong></span>
        </span>
        <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 text-[11px]">
          <Bike className="w-3 h-3 text-violet-400" />
          <span>Bikes: <strong className="text-violet-300">{motorcycles}</strong></span>
        </span>
      </div>
    </div>
  );
};

// ─── Live Camera & Connected Device Types ─────────────────────────────────────
export interface CameraDeviceOption {
  deviceId: string;
  label: string;
  kind: 'browser' | 'backend';
  cameraIndex?: number;
}

interface ActiveCameraWorker {
  sessionId: string;
  stream: MediaStream | null;
  stopWorker: () => void;
  telemetry: LiveAnalysisState | null;
}

// Global active camera stream registry (persists streaming across route changes)
const GLOBAL_ACTIVE_CAMERAS = new Map<string, ActiveCameraWorker>();

// ─── Individual VideoSessionCard Component ─────────────────────────────────────
interface VideoSessionCardProps {
  videoId: string;
  index: number;
  totalCards: number;
  initialPreset?: string;
  initialInputMode?: 'UPLOAD' | 'CAMERA' | 'PRESET';
  onRemove: (videoId: string) => void;
}

const VideoSessionCard: React.FC<VideoSessionCardProps> = ({
  videoId,
  index,
  totalCards,
  initialPreset,
  initialInputMode,
  onRemove,
}) => {
  const proc = useVideoProcessing();
  const isPrimary = index === 0;

  // Input Mode: UPLOAD (File) | CAMERA (Live Webcam/USB) | PRESET (Traffic Cam)
  const [inputMode, setInputMode] = useState<'UPLOAD' | 'CAMERA' | 'PRESET'>(
    initialInputMode || (initialPreset ? 'PRESET' : 'UPLOAD')
  );

  // Live Camera states
  const [availableCameras, setAvailableCameras] = useState<CameraDeviceOption[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [isScanningCameras, setIsScanningCameras] = useState<boolean>(false);
  const [cameraPermissionError, setCameraPermissionError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraConnectionStatus, setCameraConnectionStatus] = useState<string>('Ready');

  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const isFrameInFlightRef = useRef<boolean>(false);
  const cameraFrameIntervalRef = useRef<number | null>(null);

  // Local states for secondary multi-video cards
  const [localPreset, setLocalPreset] = useState<string>(initialPreset || '');
  const [localVideoName, setLocalVideoName] = useState<string>('');
  const [localDuration, setLocalDuration] = useState<number>(0);
  const [localUploadedVideoUrl, setLocalUploadedVideoUrl] = useState<string | null>(null);
  const [localActiveJobId, setLocalActiveJobId] = useState<string | null>(null);
  const [localIsAnalyzing, setLocalIsAnalyzing] = useState<boolean>(false);
  const [localInferenceComplete, setLocalInferenceComplete] = useState<boolean>(false);
  const [localLiveTelemetry, setLocalLiveTelemetry] = useState<LiveAnalysisState | null>(null);
  const [localStatusMessage, setLocalStatusMessage] = useState<string>('');
  const [localVideoError, setLocalVideoError] = useState<boolean>(false);
  const [localManualRoads, setLocalManualRoads] = useState<ManualRoad[]>([]);

  // Primary card binds directly to application-level VideoProcessingContext
  const selectedPreset = isPrimary ? proc.selectedPreset : localPreset;
  const videoName = isPrimary ? proc.videoName : localVideoName;
  const videoDuration = isPrimary ? proc.videoDuration : localDuration;
  const setVideoDuration = isPrimary ? proc.setVideoDuration : setLocalDuration;
  const uploadedVideoUrl = isPrimary ? proc.uploadedVideoUrl : localUploadedVideoUrl;
  const activeJobId = isPrimary ? proc.activeJobId : localActiveJobId;
  const isAnalyzing = isPrimary ? proc.isAnalyzing : localIsAnalyzing;
  const inferenceComplete = isPrimary ? proc.inferenceComplete : localInferenceComplete;
  const liveTelemetry = isPrimary ? proc.liveTelemetry : localLiveTelemetry;
  const statusMessage = isPrimary ? proc.statusMessage : localStatusMessage;
  const videoError = isPrimary ? proc.videoError : localVideoError;
  const setVideoError = isPrimary ? proc.setVideoError : setLocalVideoError;
  const manualRoads = isPrimary ? proc.manualRoads : localManualRoads;
  const setManualRoads = isPrimary ? proc.setManualRoads : setLocalManualRoads;

  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Manual ROI Drawing State
  const [drawingMode, setDrawingMode] = useState<boolean>(false);
  const [currentPolygon, setCurrentPolygon] = useState<Point[]>([]);
  const [mousePos, setMousePos] = useState<Point | null>(null);
  const [roadNameInput, setRoadNameInput] = useState<string>('');
  const [roadLengthInput, setRoadLengthInput] = useState<string>('50');
  const [showNameDialog, setShowNameDialog] = useState<boolean>(false);

  const [videoMeta, setVideoMeta] = useState<{ width: number; height: number; fps: number }>({
    width: 1920,
    height: 1080,
    fps: 24,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoMetaRef = useRef(videoMeta);
  videoMetaRef.current = videoMeta;

  // Cleanup on unmount for secondary cards only (Primary card is persisted across route navigation)
  useEffect(() => {
    return () => {
      if (!isPrimary) {
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
        if (localUploadedVideoUrl && localUploadedVideoUrl.startsWith('blob:')) {
          URL.revokeObjectURL(localUploadedVideoUrl);
        }
      }
    };
  }, [isPrimary, localUploadedVideoUrl]);

  // Telemetry listener for secondary cards only (Primary card is tracked by VideoProcessingContext)
  useEffect(() => {
    if (isPrimary || !activeJobId) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }
    let isMounted = true;
    let lastWsUpdate = 0;
    try {
      const ws = new WebSocket(api.getWsUrl(activeJobId));
      wsRef.current = ws;
      ws.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const now = Date.now();
          const data = JSON.parse(event.data) as LiveAnalysisState;
          if (data && data.frame_index !== undefined) {
            lastWsUpdate = now;
            setLocalLiveTelemetry(data);
          }
        } catch {}
      };
    } catch {}

    const pollInterval = setInterval(async () => {
      if (!isMounted || !activeJobId) return;
      try {
        const timeSinceWs = Date.now() - lastWsUpdate;
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || timeSinceWs > 200) {
          const liveRes = await fetch(`${api.apiBaseUrl}/api/analysis/${activeJobId}/live`);
          if (liveRes.ok) {
            const liveData = await liveRes.json();
            if (liveData && liveData.frame_index !== undefined) {
              setLocalLiveTelemetry(liveData);
            }
          }
        }
        const res = await fetch(`${api.apiBaseUrl}/api/inference/${activeJobId}/status`);
        if (res.ok) {
          const statusData = await res.json();
          if (statusData.status === 'READY') {
            setLocalIsAnalyzing(false);
            setLocalInferenceComplete(true);
            setLocalStatusMessage('✓ Inference complete. Output video ready.');
            clearInterval(pollInterval);
          } else if (statusData.status === 'ERROR') {
            setLocalIsAnalyzing(false);
            setLocalStatusMessage(`✗ Processing failed: ${statusData.error_message || 'Unknown error'}`);
            clearInterval(pollInterval);
          } else if (statusData.status === 'IDLE' && localIsAnalyzing) {
            setLocalIsAnalyzing(false);
            setLocalStatusMessage('Analysis stopped by user.');
            clearInterval(pollInterval);
          }
        }
      } catch {}
    }, 150);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [isPrimary, activeJobId, localIsAnalyzing]);

  // Discover cameras connected to user browser or backend host
  const scanCameras = useCallback(async () => {
    setIsScanningCameras(true);
    setCameraPermissionError(null);
    const discovered: CameraDeviceOption[] = [];

    // 1. Browser MediaDevices API
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
        let devices = await navigator.mediaDevices.enumerateDevices();
        let videoDevs = devices.filter((d) => d.kind === 'videoinput');

        // If labels are empty (pre-permission state), request temporary stream to unlock labels
        const needPermission = videoDevs.some((d) => !d.label);
        if (needPermission) {
          try {
            const testStream = await navigator.mediaDevices.getUserMedia({ video: true });
            testStream.getTracks().forEach((t) => t.stop());
            devices = await navigator.mediaDevices.enumerateDevices();
            videoDevs = devices.filter((d) => d.kind === 'videoinput');
          } catch (permErr: any) {
            console.warn('Camera permission check prompt:', permErr);
            if (permErr.name === 'NotAllowedError' || permErr.name === 'PermissionDeniedError') {
              setCameraPermissionError('Camera permission was denied. Allow camera access in browser address bar to use webcams.');
            }
          }
        }

        videoDevs.forEach((d, i) => {
          discovered.push({
            deviceId: d.deviceId,
            label: d.label || `Integrated Webcam ${i + 1}`,
            kind: 'browser',
          });
        });
      }
    } catch (e: any) {
      console.warn('Browser enumerateDevices error:', e);
    }

    // 2. Backend host cameras (OpenCV)
    try {
      const backendRes = await api.getConnectedCameras(true);
      if (backendRes && Array.isArray(backendRes.connected_cameras)) {
        backendRes.connected_cameras.forEach((cam: any) => {
          if (cam.is_available) {
            discovered.push({
              deviceId: cam.device_id,
              label: `${cam.name} (Host OpenCV)`,
              kind: 'backend',
              cameraIndex: cam.index,
            });
          }
        });
      }
    } catch (e) {
      console.warn('Backend cameras query error:', e);
    }

    setAvailableCameras(discovered);
    if (discovered.length > 0 && !selectedCameraId) {
      setSelectedCameraId(discovered[0].deviceId);
    }
    setIsScanningCameras(false);
  }, [selectedCameraId]);

  // Start live camera stream preview
  const startCameraPreview = useCallback(async (devId: string) => {
    if (!devId) return;
    const targetDev = availableCameras.find((c) => c.deviceId === devId) || availableCameras[0];
    if (!targetDev) return;

    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }

    if (targetDev.kind === 'browser') {
      try {
        setCameraConnectionStatus('Connecting...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: devId ? { exact: devId } : undefined,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          cameraVideoRef.current.play().catch(() => {});
        }
        setIsCameraActive(true);
        setCameraConnectionStatus('Live Preview Ready');
        setCameraPermissionError(null);
        if (isPrimary) {
          proc.setVideoName(targetDev.label);
        } else {
          setLocalVideoName(targetDev.label);
        }
      } catch (err: any) {
        console.error('Camera stream access error:', err);
        setIsCameraActive(false);
        setCameraConnectionStatus('Offline / Permission Needed');
        if (err.name === 'NotAllowedError') {
          setCameraPermissionError('Camera permission denied by user.');
        } else if (err.name === 'NotReadableError') {
          setCameraPermissionError('Camera is already in use by another application.');
        } else {
          setCameraPermissionError(err.message || 'Could not connect to camera.');
        }
      }
    } else {
      setIsCameraActive(true);
      setCameraConnectionStatus('Backend OpenCV Camera Ready');
      if (isPrimary) {
        proc.setVideoName(targetDev.label);
      } else {
        setLocalVideoName(targetDev.label);
      }
    }
  }, [availableCameras, isPrimary, proc]);

  // Trigger camera scan when camera tab is selected
  useEffect(() => {
    if (inputMode === 'CAMERA') {
      scanCameras();
    }
  }, [inputMode, scanCameras]);

  // Start preview whenever selected camera changes in camera mode
  useEffect(() => {
    if (inputMode === 'CAMERA' && selectedCameraId && availableCameras.length > 0) {
      startCameraPreview(selectedCameraId);
    }
  }, [inputMode, selectedCameraId, availableCameras, startCameraPreview]);

  // Re-attach active camera worker if navigating back to this card
  useEffect(() => {
    const existing = GLOBAL_ACTIVE_CAMERAS.get(videoId) || (activeJobId ? GLOBAL_ACTIVE_CAMERAS.get(activeJobId) : undefined);
    if (existing && existing.stream) {
      cameraStreamRef.current = existing.stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = existing.stream;
        cameraVideoRef.current.play().catch(() => {});
      }
      setIsCameraActive(true);
      setCameraConnectionStatus('Live Camera Stream Active');
    }
  }, [videoId, activeJobId]);

  // Coordinate alignment helper for canvas
  const getVideoRenderBox = useCallback(() => {
    const video = inputMode === 'CAMERA' ? (cameraVideoRef.current || videoRef.current) : videoRef.current;
    const canvas = canvasRef.current;
    const displayW = video?.clientWidth || video?.offsetWidth || canvas?.width || 640;
    const displayH = video?.clientHeight || video?.offsetHeight || canvas?.height || 360;

    const meta = videoMetaRef.current;
    const srcW = meta.width > 0 ? meta.width : displayW;
    const srcH = meta.height > 0 ? meta.height : displayH;

    const videoAR = srcW / srcH;
    const elemAR = displayW / Math.max(1, displayH);

    let renderedW = displayW;
    let renderedH = displayH;
    let offsetX = 0;
    let offsetY = 0;

    if (elemAR > videoAR) {
      renderedW = displayH * videoAR;
      renderedH = displayH;
      offsetX = (displayW - renderedW) / 2;
    } else if (elemAR < videoAR) {
      renderedW = displayW;
      renderedH = displayW / videoAR;
      offsetY = (displayH - renderedH) / 2;
    }

    return { offsetX, offsetY, renderedW, renderedH, srcW, srcH, displayW, displayH };
  }, [inputMode]);

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const video = inputMode === 'CAMERA' ? (cameraVideoRef.current || videoRef.current) : videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { offsetX, offsetY, renderedW, renderedH, srcW, srcH, displayW, displayH } = getVideoRenderBox();

    if (displayW <= 0 || displayH <= 0) return;

    canvas.width = displayW;
    canvas.height = displayH;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const toCanvasX = (x: number) => offsetX + (x / srcW) * renderedW;
    const toCanvasY = (y: number) => offsetY + (y / srcH) * renderedH;

    // Draw saved roads
    manualRoads.forEach((road, idx) => {
      if (!road.polygon || road.polygon.length < 3) return;
      ctx.beginPath();
      road.polygon.forEach((p, i) => {
        if (!p || p.length < 2) return;
        const dx = toCanvasX(p[0]);
        const dy = toCanvasY(p[1]);
        if (i === 0) ctx.moveTo(dx, dy);
        else ctx.lineTo(dx, dy);
      });
      ctx.closePath();

      const colors = ['#06b6d4', '#f97316', '#8b5cf6', '#10b981'];
      const color = colors[idx % colors.length];

      ctx.fillStyle = color + '33';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      if (road.polygon[0] && road.polygon[0].length >= 2) {
        const textX = toCanvasX(road.polygon[0][0]);
        const textY = Math.max(20, toCanvasY(road.polygon[0][1]) - 10);
        ctx.font = 'bold 12px monospace';
        const label = `R${idx + 1} ${road.name}`;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(textX - 2, textY - 14, ctx.measureText(label).width + 16, 18);
        ctx.fillStyle = color;
        ctx.fillText(label, textX + 2, textY);
      }
    });

    // Draw current in-progress polygon
    if (currentPolygon.length > 0) {
      ctx.beginPath();
      currentPolygon.forEach((p, i) => {
        if (!p || p.length < 2) return;
        const dx = toCanvasX(p[0]);
        const dy = toCanvasY(p[1]);
        if (i === 0) ctx.moveTo(dx, dy);
        else ctx.lineTo(dx, dy);
      });

      if (mousePos && mousePos.length >= 2) {
        ctx.lineTo(toCanvasX(mousePos[0]), toCanvasY(mousePos[1]));
      }

      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      currentPolygon.forEach((p) => {
        if (!p || p.length < 2) return;
        const dx = toCanvasX(p[0]);
        const dy = toCanvasY(p[1]);
        ctx.beginPath();
        ctx.arc(dx, dy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#facc15';
        ctx.fill();
      });
    }
  }, [currentPolygon, mousePos, manualRoads, getVideoRenderBox]);

  useEffect(() => {
    if (drawingMode || currentPolygon.length > 0 || manualRoads.length > 0) {
      redrawCanvas();
    }
  }, [currentPolygon, mousePos, manualRoads, drawingMode, videoMeta, redrawCanvas]);

  const getScaledPoint = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const displayX = e.clientX - rect.left;
    const displayY = e.clientY - rect.top;

    const { offsetX, offsetY, renderedW, renderedH, srcW, srcH } = getVideoRenderBox();
    const relX = Math.max(0, Math.min(renderedW, displayX - offsetX));
    const relY = Math.max(0, Math.min(renderedH, displayY - offsetY));

    return [(relX / renderedW) * srcW, (relY / renderedH) * srcH];
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawingMode || showNameDialog) return;
    const point = getScaledPoint(e);
    setCurrentPolygon((prev) => [...prev, point]);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawingMode || currentPolygon.length === 0 || showNameDialog) return;
    setMousePos(getScaledPoint(e));
  };

  const finishPolygon = () => {
    if (currentPolygon.length < 3) {
      alert('A road must have at least 3 points.');
      setCurrentPolygon([]);
      return;
    }
    setRoadNameInput(`Road ${manualRoads.length + 1}`);
    setRoadLengthInput('50');
    setShowNameDialog(true);
  };

  const saveRoad = () => {
    const name = roadNameInput.trim();
    if (!name) return;
    if (currentPolygon.length < 3) {
      setShowNameDialog(false);
      setCurrentPolygon([]);
      return;
    }
    const parsedLength = roadLengthInput ? parseFloat(roadLengthInput) : undefined;
    const newRoad: ManualRoad = {
      road_id: `road_${manualRoads.length + 1}`,
      name,
      polygon: [...currentPolygon],
      length_meters: parsedLength && parsedLength > 0 ? parsedLength : undefined,
    };
    const updated = [...manualRoads, newRoad];
    setManualRoads(updated);
    if (activeJobId) {
      api.saveSessionRoads(activeJobId, updated).catch(() => {});
    }
    setCurrentPolygon([]);
    setMousePos(null);
    setShowNameDialog(false);
  };

  const cancelRoad = () => {
    setCurrentPolygon([]);
    setMousePos(null);
    setShowNameDialog(false);
  };

  const deleteRoad = (roadIdx: number) => {
    const updated = manualRoads.filter((_, i) => i !== roadIdx);
    setManualRoads(updated);
    if (activeJobId) {
      api.saveSessionRoads(activeJobId, updated).catch(() => {});
    }
  };

  const renameRoad = (roadIdx: number) => {
    const road = manualRoads[roadIdx];
    if (!road) return;
    const newName = prompt(`Enter custom road name:`, road.name);
    if (newName && newName.trim()) {
      const updated = manualRoads.map((r, i) => i === roadIdx ? { ...r, name: newName.trim() } : r);
      setManualRoads(updated);
      if (activeJobId) {
        api.saveSessionRoads(activeJobId, updated).catch(() => {});
      }
    }
  };

  // Process chosen File
  const processSelectedFile = (file: File) => {
    if (!isPrimary && wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setDrawingMode(true);
    setCurrentPolygon([]);
    setMousePos(null);
    setShowNameDialog(false);

    if (uploadedVideoUrl && uploadedVideoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(uploadedVideoUrl);
    }
    const localUrl = URL.createObjectURL(file);
    setVideoMeta({ width: 1920, height: 1080, fps: 24 });

    if (isPrimary) {
      proc.resetSession();
      proc.setVideoName(file.name);
      proc.setUploadedVideoUrl(localUrl);
      proc.setStatusMessage(`Uploading ${file.name}...`);
    } else {
      setLocalActiveJobId(null);
      setLocalIsAnalyzing(false);
      setLocalInferenceComplete(false);
      setLocalLiveTelemetry(null);
      setLocalVideoError(false);
      setLocalManualRoads([]);
      setLocalVideoName(file.name);
      setLocalUploadedVideoUrl(localUrl);
      setLocalStatusMessage(`Uploading ${file.name}...`);
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('camera_id', selectedPreset || 'cam_5');

    const fileSizeMb = (file.size / (1024 * 1024)).toFixed(1);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${api.apiBaseUrl}/api/video/upload`);

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        const percent = Math.round((evt.loaded / evt.total) * 100);
        const msg = `Uploading ${file.name} (${fileSizeMb} MB) — ${percent}%...`;
        if (isPrimary) proc.setStatusMessage(msg);
        else setLocalStatusMessage(msg);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          const msg = `✓ Upload complete: ${data.filename}. Draw roads on video, then click START ANALYSIS.`;
          if (isPrimary) {
            proc.setVideoName(data.filename);
            proc.setActiveJobId(data.job_id);
            proc.setStatusMessage(msg);
          } else {
            setLocalActiveJobId(data.job_id);
            setLocalStatusMessage(msg);
          }
        } catch {
          const msg = `✓ Video uploaded successfully. Draw road boundaries or click START.`;
          if (isPrimary) proc.setStatusMessage(msg);
          else setLocalStatusMessage(msg);
        }
      } else {
        let errMsg = `HTTP ${xhr.status}`;
        try {
          const errData = JSON.parse(xhr.responseText);
          if (errData.detail) errMsg = errData.detail;
        } catch {}
        const msg = `✗ Upload failed: ${errMsg}`;
        if (isPrimary) proc.setStatusMessage(msg);
        else setLocalStatusMessage(msg);
      }
    };

    xhr.onerror = () => {
      const msg = `✗ Network Error during upload. Ensure backend is running.`;
      if (isPrimary) proc.setStatusMessage(msg);
      else setLocalStatusMessage(msg);
    };

    xhr.send(formData);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
    e.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  const handleSelectPreset = (presetId: string) => {
    const source = FEED_SOURCES.find((s) => s.id === presetId);
    if (!source) return;

    if (isPrimary) {
      proc.resetSession();
      proc.setSelectedPreset(presetId);
      proc.setActiveJobId(presetId);
      proc.setVideoName(source.name);
      proc.setUploadedVideoUrl(api.getVideoUrl(source.videoUrl));
      proc.setStatusMessage(`Selected ${source.name}. Click START ANALYSIS or Draw ROI.`);
    } else {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setLocalPreset(presetId);
      setLocalActiveJobId(presetId);
      setLocalIsAnalyzing(false);
      setLocalInferenceComplete(false);
      setLocalLiveTelemetry(null);
      setLocalVideoError(false);
      setLocalVideoName(source.name);
      setLocalManualRoads([]);
      if (localUploadedVideoUrl && localUploadedVideoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(localUploadedVideoUrl);
      }
      setLocalUploadedVideoUrl(api.getVideoUrl(source.videoUrl));
      setLocalStatusMessage(`Selected ${source.name}. Click START ANALYSIS or Draw ROI.`);
    }
    setDrawingMode(false);
    setCurrentPolygon([]);
  };

  const handleSwitchMode = (mode: 'UPLOAD' | 'CAMERA' | 'PRESET') => {
    if (isAnalyzing) {
      if (!confirm('This source is actively being analyzed. Stop analysis and switch input mode?')) {
        return;
      }
      handleStopInference();
    }
    setInputMode(mode);
    setDrawingMode(false);
    setCurrentPolygon([]);
    if (mode === 'CAMERA') {
      scanCameras();
    }
  };

  const handleStartInference = async () => {
    // ── LIVE CAMERA PROCESSING ──
    if (inputMode === 'CAMERA') {
      if (manualRoads.length === 0 && drawingMode) {
        alert('Please finish drawing at least one road region before processing.');
        return;
      }
      const targetDev = availableCameras.find((c) => c.deviceId === selectedCameraId) || availableCameras[0];
      const devLabel = targetDev ? targetDev.label : 'Live Camera';
      const devId = targetDev ? targetDev.deviceId : videoId;
      const isBackend = targetDev?.kind === 'backend';
      const targetJobId = activeJobId || videoId;

      try {
        setDrawingMode(false);
        if (isPrimary) {
          proc.setActiveJobId(targetJobId);
          proc.setVideoName(devLabel);
          proc.setStatusMessage('Starting Live Camera GPU tracking...');
        } else {
          setLocalActiveJobId(targetJobId);
          setLocalVideoName(devLabel);
          setLocalIsAnalyzing(true);
          setLocalInferenceComplete(false);
          setLocalStatusMessage('Starting Live Camera GPU tracking...');
        }

        await api.startCameraSession(
          targetJobId,
          devId,
          devLabel,
          isBackend ? 'BACKEND_CAMERA' : 'BROWSER_CAMERA',
          manualRoads,
          targetDev?.cameraIndex
        );

        if (isPrimary) {
          proc.setStatusMessage('✓ Live Camera tracking running on GPU...');
        } else {
          setLocalStatusMessage('✓ Live Camera tracking running on GPU...');
        }

        // If browser camera, start canvas frame-pushing loop with backpressure protection
        if (!isBackend) {
          if (cameraFrameIntervalRef.current) {
            clearInterval(cameraFrameIntervalRef.current);
          }
          const offscreenCanvas = document.createElement('canvas');
          const offscreenCtx = offscreenCanvas.getContext('2d');

          const pushFrame = async () => {
            if (!cameraVideoRef.current || isFrameInFlightRef.current) return;
            const vid = cameraVideoRef.current;
            if (vid.readyState < 2 || vid.videoWidth === 0) return;

            isFrameInFlightRef.current = true;
            try {
              offscreenCanvas.width = vid.videoWidth;
              offscreenCanvas.height = vid.videoHeight;
              offscreenCtx?.drawImage(vid, 0, 0);

              offscreenCanvas.toBlob(async (blob) => {
                if (!blob) {
                  isFrameInFlightRef.current = false;
                  return;
                }
                try {
                  const res = await api.sendCameraFrame(targetJobId, blob);
                  if (res && res.telemetry) {
                    if (isPrimary) {
                      // Handled by telemetry update
                    } else {
                      setLocalLiveTelemetry(res.telemetry);
                    }
                  }
                } catch (e) {
                  console.warn('Frame push warning:', e);
                } finally {
                  isFrameInFlightRef.current = false;
                }
              }, 'image/jpeg', 0.75);
            } catch (e) {
              isFrameInFlightRef.current = false;
            }
          };

          const intervalId = window.setInterval(pushFrame, 150);
          cameraFrameIntervalRef.current = intervalId;

          GLOBAL_ACTIVE_CAMERAS.set(targetJobId, {
            sessionId: targetJobId,
            stream: cameraStreamRef.current,
            stopWorker: () => {
              clearInterval(intervalId);
              api.stopCameraSession(targetJobId).catch(() => {});
            },
            telemetry: null,
          });
        }
      } catch (err: any) {
        const msg = `✗ Camera start failed: ${err.message}`;
        if (isPrimary) proc.setStatusMessage(msg);
        else {
          setLocalIsAnalyzing(false);
          setLocalStatusMessage(msg);
        }
      }
      return;
    }

    // ── VIDEO FILE / PRESET PROCESSING ──
    if (uploadedVideoUrl && manualRoads.length === 0 && drawingMode) {
      alert('Please finish drawing at least one road region before processing.');
      return;
    }
    const targetId = activeJobId || selectedPreset;
    if (!targetId) {
      alert('Please select a video preset or upload a video file first.');
      return;
    }
    console.log(`[INFERENCE TRIGGER] session_id=${targetId} video=${videoName || 'uploaded'}`);
    if (isPrimary) {
      try {
        setDrawingMode(false);
        await proc.startInference(targetId, 600, manualRoads);
      } catch (err: any) {
        console.error('Failed to start inference:', err);
      }
      return;
    }
    try {
      setLocalIsAnalyzing(true);
      setLocalInferenceComplete(false);
      setLocalLiveTelemetry(null);
      setDrawingMode(false);
      setLocalVideoError(false);

      const res = await api.startInference(targetId, 600, manualRoads);
      setLocalActiveJobId(res.job_id);
      setLocalStatusMessage('✓ Inference started on GPU...');
    } catch (err: any) {
      setLocalIsAnalyzing(false);
      setLocalStatusMessage(`✗ Error: ${err.message}`);
    }
  };

  const handleStopInference = async () => {
    if (cameraFrameIntervalRef.current) {
      clearInterval(cameraFrameIntervalRef.current);
      cameraFrameIntervalRef.current = null;
    }
    const targetJobId = activeJobId || videoId;
    if (GLOBAL_ACTIVE_CAMERAS.has(targetJobId)) {
      GLOBAL_ACTIVE_CAMERAS.get(targetJobId)?.stopWorker();
      GLOBAL_ACTIVE_CAMERAS.delete(targetJobId);
    }
    if (inputMode === 'CAMERA') {
      try {
        await api.stopCameraSession(targetJobId);
      } catch {}
      if (isPrimary) {
        proc.setStatusMessage('Live Camera analysis stopped.');
      } else {
        setLocalIsAnalyzing(false);
        setLocalStatusMessage('Live Camera analysis stopped.');
      }
      return;
    }
    if (isPrimary) {
      await proc.stopInference();
      return;
    }
    if (!activeJobId) return;
    try {
      await api.stopInference(activeJobId);
      setLocalIsAnalyzing(false);
      setLocalStatusMessage('Analysis stopped.');
    } catch (e: any) {
      console.warn('Stop failed:', e);
    }
  };

  const handleRemoveCard = () => {
    if (isAnalyzing || (manualRoads.length > 0 && !inferenceComplete)) {
      if (!confirm('This source is actively being analyzed or has unsaved configurations. Are you sure you want to remove it?')) {
        return;
      }
    }
    if (cameraFrameIntervalRef.current) {
      clearInterval(cameraFrameIntervalRef.current);
      cameraFrameIntervalRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    const targetJobId = activeJobId || videoId;
    if (GLOBAL_ACTIVE_CAMERAS.has(targetJobId)) {
      GLOBAL_ACTIVE_CAMERAS.get(targetJobId)?.stopWorker();
      GLOBAL_ACTIVE_CAMERAS.delete(targetJobId);
    }
    if (activeJobId) {
      api.deleteSession(activeJobId).catch(() => {});
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (uploadedVideoUrl && uploadedVideoUrl.startsWith('blob:')) {
      URL.revokeObjectURL(uploadedVideoUrl);
    }
    onRemove(videoId);
  };

  // Video source determination
  let currentVideoSrc = '';
  if (isAnalyzing && activeJobId) {
    currentVideoSrc = api.getLiveStreamUrl(activeJobId);
  } else if (inferenceComplete && activeJobId) {
    currentVideoSrc = `${api.apiBaseUrl}/api/jobs/${activeJobId}/output`;
  } else if (uploadedVideoUrl) {
    currentVideoSrc = uploadedVideoUrl;
  }

  // Analytics derivation
  const currentRoiCount = safeNum(liveTelemetry?.current_roi_count ?? liveTelemetry?.current_active, 0);
  const initialOccupancy = safeNum(liveTelemetry?.initial_occupancy, 0);
  const cumulativeEntries = safeNum(liveTelemetry?.cumulative_entries ?? liveTelemetry?.vehicles_counted, 0);
  const cumulativeExits = safeNum(liveTelemetry?.cumulative_exits, 0);
  const invariantVerified = Boolean(liveTelemetry?.invariant_verified ?? true);
  const movingVehicles = safeNum(liveTelemetry?.moving_vehicles ?? liveTelemetry?.current_moving, 0);
  const queueLength = safeNum(liveTelemetry?.queue ?? liveTelemetry?.current_stationary ?? liveTelemetry?.stationary_vehicles, 0);
  const trafficState = liveTelemetry?.traffic_state ?? 'LOW';
  const flowRate = safeNum(liveTelemetry?.arrival_rate ?? liveTelemetry?.flow_rate_per_min, 0);

  const completedTrips = safeNum(
    liveTelemetry?.completed_trips ??
      liveTelemetry?.valid_trips ??
      liveTelemetry?.total_road_summary?.completed_trips ??
      liveTelemetry?.total_road_summary?.valid_trips,
    0
  );
  const rawAvgSpeed = liveTelemetry?.average_speed ?? liveTelemetry?.total_road_summary?.average_speed;
  const speedDisplay = liveTelemetry?.speed_display ?? liveTelemetry?.total_road_summary?.speed_display;

  let speedCardValue: string;
  let speedCardSubtext: string;
  let speedCardVariant: 'default' | 'highlight' | 'critical' | 'emerald' = 'highlight';

  if (speedDisplay === 'Calibration required') {
    speedCardValue = 'Calibration required';
    speedCardSubtext = 'Road length calibration needed';
    speedCardVariant = 'default';
  } else if (completedTrips === 0 || rawAvgSpeed === null || rawAvgSpeed === undefined || !isFinite(Number(rawAvgSpeed))) {
    speedCardValue = 'Waiting for vehicles';
    speedCardSubtext = '0 completed trips recorded';
    speedCardVariant = 'default';
  } else {
    speedCardValue = `${safeFixed(Number(rawAvgSpeed), 1)} km/h`;
    speedCardSubtext = `${completedTrips} valid trip${completedTrips > 1 ? 's' : ''} completed`;
    speedCardVariant = 'emerald';
  }

  const classCounts = liveTelemetry?.current_classes ?? liveTelemetry?.class_counts ?? {};
  const roadsData: RoadAnalytics[] = Array.isArray(liveTelemetry?.roads) ? liveTelemetry!.roads! : [];
  const totalSummary: RoadAnalytics | undefined = liveTelemetry?.total_road_summary;
  const processingFps = safeNum(liveTelemetry?.processing_fps, 0);

  const hasVideoSource =
    inputMode === 'CAMERA'
      ? Boolean(isCameraActive || activeJobId)
      : inputMode === 'PRESET'
      ? Boolean(selectedPreset || activeJobId)
      : Boolean(uploadedVideoUrl || activeJobId);

  return (
    <div className="bg-slate-900/90 border border-slate-800 hover:border-slate-700/80 rounded-3xl p-5 shadow-2xl backdrop-blur-xl transition-all duration-300 flex flex-col space-y-4">
      {/* ─── CARD HEADER & CONTROLS ───────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-3">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-xl font-mono text-xs font-bold border ${
            inputMode === 'CAMERA'
              ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-400'
              : inputMode === 'PRESET'
              ? 'bg-violet-950/80 border-violet-500/40 text-violet-400'
              : 'bg-cyan-950/80 border-cyan-500/40 text-cyan-400'
          }`}>
            {inputMode === 'CAMERA' ? `CAM ${index + 1}` : inputMode === 'PRESET' ? `PRE ${index + 1}` : `VID ${index + 1}`}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-bold font-mono text-slate-100 truncate max-w-[200px] sm:max-w-xs" title={videoName || `Feed ${index + 1}`}>
                {videoName || (inputMode === 'CAMERA' ? `Live Camera ${index + 1}` : `Video Source ${index + 1}`)}
              </h3>
              {videoDuration > 0 && inputMode !== 'CAMERA' && (
                <span className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[10px] font-mono text-slate-400">
                  {videoDuration.toFixed(1)}s
                </span>
              )}
              {inputMode === 'CAMERA' && isCameraActive && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-600/50 text-[10px] font-mono font-bold text-emerald-400 animate-pulse">
                  LIVE
                </span>
              )}
            </div>
            <span className="text-[10px] font-mono text-slate-500">ID: {videoId}</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {hasVideoSource && (
            <>
              {/* ROI Drawing Toggle */}
              <button
                onClick={() => setDrawingMode((prev) => !prev)}
                disabled={isAnalyzing}
                className={`flex items-center px-3 py-1.5 rounded-xl text-xs font-mono font-semibold transition-all border ${
                  drawingMode
                    ? 'bg-violet-950/90 text-violet-300 border-violet-500/60 shadow-lg'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-violet-500/50'
                }`}
                title="Draw Road ROIs"
              >
                <Edit className="w-3.5 h-3.5 mr-1 text-violet-400" />
                {drawingMode ? 'Done Drawing' : 'Draw ROI'}
              </button>

              {/* Start / Stop Analysis Button */}
              {isAnalyzing ? (
                <button
                  onClick={handleStopInference}
                  className="flex items-center px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono uppercase tracking-wider bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/50 transition-all active:scale-95"
                  title="Stop Analysis"
                >
                  <Square className="w-3.5 h-3.5 mr-1 fill-current" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleStartInference}
                  disabled={Boolean(manualRoads.length === 0 && drawingMode)}
                  className={`flex items-center px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono uppercase tracking-wider transition-all shadow-lg ${
                    manualRoads.length === 0 && drawingMode
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                      : inputMode === 'CAMERA'
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/25 active:scale-95'
                      : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-500/25 active:scale-95'
                  }`}
                  title="Run GPU Analysis"
                >
                  <Zap className="w-3.5 h-3.5 mr-1 fill-current" />
                  {inferenceComplete ? 'Re-Analyze' : 'Start'}
                </button>
              )}
            </>
          )}

          {/* Remove Video/Camera Card Button */}
          {totalCards > 1 && (
            <button
              onClick={handleRemoveCard}
              title="Remove Source Card"
              className="p-1.5 text-slate-500 hover:text-red-400 bg-slate-950 border border-slate-800 hover:border-red-900/50 rounded-xl transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ─── SOURCE INPUT TABS: Upload Video | Live Camera | Camera Presets ─── */}
      <div className="flex flex-wrap items-center justify-between bg-slate-950/80 p-1.5 rounded-2xl border border-slate-800 gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => handleSwitchMode('UPLOAD')}
            className={`flex items-center px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
              inputMode === 'UPLOAD'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            Upload Video
          </button>

          <button
            onClick={() => handleSwitchMode('CAMERA')}
            className={`flex items-center px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
              inputMode === 'CAMERA'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Camera className="w-3.5 h-3.5 mr-1.5" />
            Live Camera
          </button>

          <button
            onClick={() => handleSwitchMode('PRESET')}
            className={`flex items-center px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
              inputMode === 'PRESET'
                ? 'bg-violet-500 text-slate-950 shadow-md shadow-violet-500/25'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Film className="w-3.5 h-3.5 mr-1.5" />
            Camera Presets
          </button>
        </div>

        <span className="hidden sm:inline-flex px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-400">
          {inputMode === 'CAMERA'
            ? 'Webcam / USB Live'
            : inputMode === 'PRESET'
            ? 'Traffic Camera Preset'
            : 'Local Traffic Video'}
        </span>
      </div>

      {/* ─── LIVE CAMERA CONTROLS BAR (When Camera Mode Active) ─── */}
      {inputMode === 'CAMERA' && (
        <div className="bg-slate-950/80 border border-emerald-900/40 rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-inner">
          <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-[11px] font-mono uppercase text-slate-400 tracking-wider whitespace-nowrap flex items-center">
              <Camera className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
              Connected Camera:
            </span>
            <div className="relative flex-1 max-w-sm">
              <select
                value={selectedCameraId}
                onChange={(e) => {
                  setSelectedCameraId(e.target.value);
                  startCameraPreview(e.target.value);
                }}
                className="w-full appearance-none bg-slate-900 border border-slate-700 text-slate-200 text-xs font-mono rounded-xl px-3 py-1.5 pr-8 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
              >
                {availableCameras.length === 0 ? (
                  <option value="">No cameras detected — click Refresh</option>
                ) : (
                  availableCameras.map((cam) => (
                    <option key={cam.deviceId} value={cam.deviceId}>
                      {cam.label} {cam.kind === 'backend' ? '(Host OpenCV)' : '(Browser)'}
                    </option>
                  ))
                )}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
                <ChevronDown className="w-3.5 h-3.5" />
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={scanCameras}
              disabled={isScanningCameras}
              className="flex items-center px-3 py-1.5 rounded-xl text-xs font-mono font-bold bg-slate-900 border border-slate-700 hover:border-emerald-500/50 text-slate-300 transition-all shadow-inner"
              title="Refresh / Scan Cameras"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isScanningCameras ? 'animate-spin text-emerald-400' : 'text-slate-400'}`} />
              Refresh Cameras
            </button>

            <span className={`px-2.5 py-1 rounded-xl border text-[11px] font-mono font-semibold ${
              isCameraActive
                ? 'bg-emerald-950/70 border-emerald-600/50 text-emerald-300'
                : 'bg-slate-900 border-slate-700 text-slate-400'
            }`}>
              {cameraConnectionStatus}
            </span>
          </div>
        </div>
      )}

      {/* Permission / Device Error Banner */}
      {cameraPermissionError && (
        <div className="p-3 bg-red-950/70 border border-red-700/60 rounded-2xl flex items-center justify-between text-xs font-mono text-red-200">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span>{cameraPermissionError}</span>
          </div>
          <button
            onClick={scanCameras}
            className="px-2.5 py-1 rounded-lg bg-red-900/60 hover:bg-red-800 border border-red-700 text-[11px] font-bold text-white transition-all"
          >
            Retry Permission
          </button>
        </div>
      )}

      {/* ─── STATUS & PROGRESS BANNER ──────────────────────────────── */}
      {(statusMessage || isAnalyzing) && (
        <div className="flex flex-col space-y-1.5">
          <div
            className={`p-2.5 border rounded-xl flex items-center justify-between text-xs font-mono transition-all ${
              statusMessage.startsWith('✗')
                ? 'bg-red-950/60 border-red-600/50 text-red-300'
                : statusMessage.startsWith('✓')
                ? 'bg-emerald-950/60 border-emerald-600/50 text-emerald-300'
                : 'bg-cyan-950/70 border-cyan-600/50 text-cyan-300'
            }`}
          >
            <div className="flex items-center space-x-2 truncate">
              <Activity className={`w-3.5 h-3.5 flex-shrink-0 ${isAnalyzing ? 'animate-spin text-cyan-400' : ''}`} />
              <span className="truncate">{statusMessage || 'Inference actively processing in background...'}</span>
            </div>
            {isAnalyzing && (
              <span className="font-bold text-cyan-400 ml-2 whitespace-nowrap">
                F {(isPrimary ? proc.framesProcessed : liveTelemetry?.frame_index) || 0}/{(isPrimary ? proc.totalFrames : liveTelemetry?.total_frames) || (inputMode === 'CAMERA' ? 'LIVE' : 600)} • {safeFixed(processingFps || (isPrimary ? proc.currentFps : 0), 1)} FPS
              </span>
            )}
          </div>
          {isAnalyzing && inputMode !== 'CAMERA' && (
            <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden border border-slate-800 shadow-inner">
              <div
                className="bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 h-full transition-all duration-300"
                style={{ width: `${isPrimary ? proc.progressPct : Math.round((((liveTelemetry?.frame_index || 0) / (liveTelemetry?.total_frames || 600)) * 100))}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* ─── MAIN VIDEO / CAMERA VIEWPORT ───────────────────────────── */}
      {!hasVideoSource && inputMode === 'UPLOAD' ? (
        /* Empty Card: Drag-and-Drop & Video Selection Area */
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative aspect-video rounded-2xl border-2 border-dashed flex flex-col items-center justify-center p-6 text-center transition-all ${
            isDragging
              ? 'border-cyan-400 bg-cyan-950/30'
              : 'border-slate-700/80 bg-slate-950/60 hover:border-slate-600'
          }`}
        >
          <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl text-cyan-400 mb-3 shadow-inner">
            <Film className="w-8 h-8" />
          </div>
          <h4 className="text-sm font-bold text-slate-200 mb-1">Upload Traffic Video</h4>
          <p className="text-xs text-slate-500 font-mono mb-4">
            Drag & drop video file here, or click to browse (.mp4, .avi, .mov)
          </p>

          <label className="inline-flex items-center px-4 py-2 text-xs font-bold font-mono uppercase tracking-wider text-cyan-300 bg-cyan-950/80 border border-cyan-600/60 rounded-xl hover:bg-cyan-900/60 cursor-pointer transition-all shadow-md active:scale-95 mb-4">
            <Upload className="w-4 h-4 mr-1.5" />
            Select Video File
            <input type="file" accept="video/mp4,video/avi,video/mov,video/mkv" onChange={handleFileInput} className="hidden" />
          </label>
        </div>
      ) : !hasVideoSource && inputMode === 'PRESET' ? (
        /* Empty Preset Selection Area */
        <div className="relative aspect-video rounded-2xl border-2 border-dashed border-slate-700/80 bg-slate-950/60 flex flex-col items-center justify-center p-6 text-center">
          <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl text-violet-400 mb-3 shadow-inner">
            <Film className="w-8 h-8" />
          </div>
          <h4 className="text-sm font-bold text-slate-200 mb-1">Pick Traffic Camera Preset</h4>
          <p className="text-xs text-slate-500 font-mono mb-4">Select a pre-configured intersection camera feed</p>
          <div className="w-full max-w-sm relative">
            <select
              value={selectedPreset}
              onChange={(e) => handleSelectPreset(e.target.value)}
              className="w-full appearance-none bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs font-mono rounded-xl px-3 py-2 pr-8 focus:outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer"
            >
              <option value="" disabled>Choose Traffic Camera Preset...</option>
              {FEED_SOURCES.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
              <ChevronDown className="w-3.5 h-3.5" />
            </div>
          </div>
        </div>
      ) : (
        /* Video Player + Drawing Canvas */
        <div className="relative aspect-video bg-black rounded-2xl overflow-hidden border border-slate-800 shadow-xl flex items-center justify-center select-none group">
          {videoError ? (
            <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400">
              <AlertTriangle className="w-8 h-8 text-amber-400 mb-2" />
              <p className="text-sm font-semibold text-slate-200">Video Stream Offline</p>
              <button
                onClick={() => {
                  setVideoError(false);
                  if (inputMode === 'CAMERA') {
                    if (selectedCameraId) startCameraPreview(selectedCameraId);
                  } else if (videoRef.current) {
                    videoRef.current.load();
                  }
                }}
                className="mt-3 inline-flex items-center px-3 py-1 text-xs font-mono text-cyan-400 bg-cyan-950/70 border border-cyan-800 rounded-lg hover:bg-cyan-900"
              >
                <RotateCcw className="w-3 h-3 mr-1" /> Retry
              </button>
            </div>
          ) : isAnalyzing && activeJobId ? (
            <img
              src={api.getLiveStreamUrl(activeJobId)}
              alt="Live GPU Inference"
              className="w-full h-full object-contain"
              onError={() => setVideoError(true)}
            />
          ) : inputMode === 'CAMERA' ? (
            <video
              ref={cameraVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-contain"
              onLoadedMetadata={(e) => {
                const target = e.target as HTMLVideoElement;
                const w = target.videoWidth || 1280;
                const h = target.videoHeight || 720;
                setVideoMeta({ width: w, height: h, fps: 30 });
                videoMetaRef.current = { width: w, height: h, fps: 30 };
              }}
            />
          ) : (
            <video
              ref={videoRef}
              key={inferenceComplete ? `output-${activeJobId}` : `preview-${uploadedVideoUrl}`}
              src={inferenceComplete && activeJobId ? `${api.apiBaseUrl}/api/jobs/${activeJobId}/output` : currentVideoSrc}
              autoPlay
              loop
              muted
              controls={!drawingMode}
              playsInline
              className="w-full h-full object-contain"
              onLoadedMetadata={(e) => {
                const target = e.target as HTMLVideoElement;
                const w = target.videoWidth || 1920;
                const h = target.videoHeight || 1080;
                setVideoMeta({ width: w, height: h, fps: 24 });
                videoMetaRef.current = { width: w, height: h, fps: 24 };
                setVideoDuration(target.duration || 0);
              }}
              onError={() => {
                if (!uploadedVideoUrl?.startsWith('blob:')) setVideoError(true);
              }}
            />
          )}

          {/* Interactive Drawing Canvas Overlay */}
          {drawingMode && hasVideoSource && !isAnalyzing && !inferenceComplete && (
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasMouseMove}
              className="absolute inset-0 w-full h-full cursor-crosshair z-10"
            />
          )}

          {/* Drawing Mode Hint */}
          {drawingMode && hasVideoSource && !isAnalyzing && !inferenceComplete && manualRoads.length === 0 && currentPolygon.length === 0 && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none z-20">
              <div className="bg-slate-900/90 border border-slate-700 rounded-lg px-3 py-1.5 text-[11px] font-mono text-cyan-300 backdrop-blur-sm shadow-md">
                Click video to place road boundary points
              </div>
            </div>
          )}

          {/* Road Configuration Modal */}
          {showNameDialog && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-30 backdrop-blur-sm p-4">
              <div className="bg-slate-900 border border-slate-700 p-5 rounded-2xl shadow-2xl max-w-xs w-full">
                <h4 className="text-sm font-bold text-slate-100 mb-3">Configure Road Region</h4>
                <div className="mb-2.5">
                  <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1 block">Road Name</label>
                  <input
                    type="text"
                    value={roadNameInput}
                    onChange={(e) => setRoadNameInput(e.target.value)}
                    placeholder="e.g. Northbound"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-slate-200 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && saveRoad()}
                  />
                </div>
                <div className="mb-4">
                  <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1 block">
                    Calibrated Distance (m)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={roadLengthInput}
                    onChange={(e) => setRoadLengthInput(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-slate-200 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    onKeyDown={(e) => e.key === 'Enter' && saveRoad()}
                  />
                  <span className="text-[9px] text-slate-500 font-mono mt-0.5 block">Used for speed (km/h)</span>
                </div>
                <div className="flex justify-end space-x-2">
                  <button onClick={cancelRoad} className="px-3 py-1 text-xs font-mono text-slate-400 hover:text-slate-200">
                    Cancel
                  </button>
                  <button
                    onClick={saveRoad}
                    className="px-3 py-1 text-xs font-bold font-mono bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg flex items-center"
                  >
                    <Check className="w-3.5 h-3.5 mr-1" /> Save Road
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── DRAWING CONTROLS & ROAD CHIPS ───────────────────────── */}
      {drawingMode && hasVideoSource && !isAnalyzing && !inferenceComplete && (
        <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-2xl flex flex-col space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-slate-400">
              Points: {currentPolygon.length} • Saved Roads: {manualRoads.length}
            </span>
            <div className="flex items-center space-x-2">
              {currentPolygon.length > 0 && (
                <button
                  onClick={() => {
                    setCurrentPolygon([]);
                    setMousePos(null);
                  }}
                  className="px-2.5 py-1 text-xs font-mono text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg"
                >
                  Clear Points
                </button>
              )}
              {currentPolygon.length >= 3 && (
                <button
                  onClick={finishPolygon}
                  className="flex items-center px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold font-mono rounded-lg shadow-md"
                >
                  <Check className="w-3.5 h-3.5 mr-1" /> Finish Road
                </button>
              )}
            </div>
          </div>

          {/* Road Badges */}
          {manualRoads.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800/80">
              {manualRoads.map((road, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200"
                >
                  <span className="text-cyan-400 font-bold">R{idx + 1}</span>
                  <span className="font-semibold text-white">{road.name}</span>
                  {road.length_meters && <span className="text-[10px] text-slate-400">({road.length_meters}m)</span>}
                  <button
                    onClick={() => renameRoad(idx)}
                    title="Rename Road"
                    className="text-slate-400 hover:text-cyan-300 ml-1 p-0.5"
                  >
                    <Edit className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => deleteRoad(idx)}
                    title="Delete Road"
                    className="text-slate-400 hover:text-red-400 ml-0.5 p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── LIVE TRAFFIC METRICS & ROAD ANALYTICS (When Active) ───── */}
      {hasVideoSource && (
        <div className="space-y-4 pt-1">
          {/* Quick Metrics Row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            <MetricCard
              label="Current ROI Count"
              value={currentRoiCount}
              subtext={`Init: ${initialOccupancy} • In: +${cumulativeEntries} • Out: -${cumulativeExits}`}
              icon={<Car className="w-4 h-4 text-emerald-400" />}
              variant="emerald"
            />
            <MetricCard
              label="Cumulative In / Out"
              value={`+${cumulativeEntries} / -${cumulativeExits}`}
              subtext={invariantVerified ? '✓ Invariant Verified' : 'Verifying...'}
              icon={<Activity className="w-4 h-4 text-cyan-400" />}
              variant="default"
            />
            <MetricCard
              label="Average Speed"
              value={speedCardValue}
              subtext={speedCardSubtext}
              icon={<TrendingUp className="w-4 h-4 text-violet-400" />}
              variant={speedCardVariant}
            />
            <MetricCard
              label="Traffic State"
              value={trafficState}
              subtext={flowRate > 0 ? `Flow: ${safeFixed(flowRate, 1)}/min` : 'Monitoring density'}
              icon={<Compass className="w-4 h-4 text-orange-400" />}
              variant="highlight"
            />
            <MetricCard
              label="Est. Queue / Flow"
              value={`${queueLength} stopped`}
              subtext={`${movingVehicles} moving`}
              icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
              variant="critical"
            />
          </div>

          {/* Vehicle Class Breakdown */}
          <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
            <span className="text-slate-400 uppercase">ROI VEHICLES:</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-700/60 text-emerald-300 font-semibold flex items-center space-x-1">
                <Car className="w-3 h-3 mr-1 text-emerald-400" /> Cars: {classCounts.Car ?? classCounts.car ?? 0}
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-950/60 border border-amber-700/60 text-amber-300 font-semibold flex items-center space-x-1">
                <Bus className="w-3 h-3 mr-1 text-amber-400" /> Buses: {classCounts.Bus ?? classCounts.bus ?? 0}
              </span>
              <span className="px-2 py-0.5 rounded bg-orange-950/60 border border-orange-700/60 text-orange-300 font-semibold flex items-center space-x-1">
                <Truck className="w-3 h-3 mr-1 text-orange-400" /> Trucks: {classCounts.Truck ?? classCounts.truck ?? 0}
              </span>
              <span className="px-2 py-0.5 rounded bg-purple-950/60 border border-purple-700/60 text-purple-300 font-semibold flex items-center space-x-1">
                <Bike className="w-3 h-3 mr-1 text-purple-400" /> Bikes: {classCounts.Motorcycle ?? classCounts.motorcycle ?? classCounts.Bicycle ?? 0}
              </span>
            </div>
          </div>

          {/* ─── ROAD ANALYTICS (Single Road vs Multi-Road Inside Card) ─── */}
          {roadsData.length > 0 && (
            <div className="pt-2 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-mono font-bold text-slate-200 uppercase tracking-wide flex items-center">
                  <Layers className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />
                  Road Analytics ({roadsData.length} Road{roadsData.length > 1 ? 's' : ''})
                </span>
                <span className="text-[10px] font-mono text-slate-500">Isolated road tracking</span>
              </div>

              {roadsData.length === 1 ? (
                /* Exactly One Road: Render single road card without duplicate summary */
                <ErrorBoundary fallbackTitle="Road Analytics Error">
                  <RoadCard road={roadsData[0]} index={0} isSingle={true} />
                </ErrorBoundary>
              ) : (
                /* Multiple Roads: Render ALL ROADS Summary + Grid of Individual Roads */
                <div className="space-y-3">
                  <ErrorBoundary fallbackTitle="Total Roads Summary Error">
                    <TotalRoadSummaryCard
                      totalSummary={
                        totalSummary || {
                          road_id: 'total_network',
                          name: 'Total / All Roads Summary',
                          current_roi_count: roadsData.reduce((acc, r) => acc + safeNum(r.current_roi_count ?? r.current_active, 0), 0),
                          current_active: roadsData.reduce((acc, r) => acc + safeNum(r.current_active ?? r.current_roi_count, 0), 0),
                          cumulative_entries: roadsData.reduce((acc, r) => acc + safeNum(r.cumulative_entries, 0), 0),
                          cumulative_exits: roadsData.reduce((acc, r) => acc + safeNum(r.cumulative_exits, 0), 0),
                          current_moving: roadsData.reduce((acc, r) => acc + safeNum(r.current_moving, 0), 0),
                          current_stationary: roadsData.reduce((acc, r) => acc + safeNum(r.current_stationary ?? r.queue, 0), 0),
                          completed_trips: roadsData.reduce((acc, r) => acc + safeNum(r.completed_trips ?? r.valid_trips, 0), 0),
                          valid_trips: roadsData.reduce((acc, r) => acc + safeNum(r.valid_trips ?? r.completed_trips, 0), 0),
                          average_speed: null,
                          speed_display: 'N/A — awaiting valid trips',
                          cars: roadsData.reduce((acc, r) => acc + safeNum(r.cars, 0), 0),
                          trucks: roadsData.reduce((acc, r) => acc + safeNum(r.trucks, 0), 0),
                          buses: roadsData.reduce((acc, r) => acc + safeNum(r.buses, 0), 0),
                          motorcycles: roadsData.reduce((acc, r) => acc + safeNum(r.motorcycles, 0), 0),
                        }
                      }
                      roadsCount={roadsData.length}
                    />
                  </ErrorBoundary>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {roadsData.map((road, rIdx) => (
                      <ErrorBoundary key={road?.road_id ?? rIdx} fallbackTitle="Road Card Error">
                        <RoadCard road={road} index={rIdx} />
                      </ErrorBoundary>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Top-Level Multi-Video LiveAnalysis Workspace ──────────────────────────────
export const LiveAnalysis: React.FC<LiveAnalysisProps> = ({ state: _state, onRefresh }) => {
  // Collection of video/camera cards keyed by unique, stable videoId
  const [videoCards, setVideoCards] = useState<Array<{ id: string; preset?: string; inputMode?: 'UPLOAD' | 'CAMERA' | 'PRESET' }>>([
    { id: 'video_card_1', preset: 'cam_5', inputMode: 'PRESET' },
  ]);

  const handleAddVideo = () => {
    const newId = `video_card_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    setVideoCards((prev) => [...prev, { id: newId, inputMode: 'UPLOAD' }]);
  };

  const handleAddCamera = () => {
    const newId = `camera_card_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    setVideoCards((prev) => [...prev, { id: newId, inputMode: 'CAMERA' }]);
  };

  const handleRemoveVideo = (idToRemove: string) => {
    setVideoCards((prev) => prev.filter((card) => card.id !== idToRemove));
  };

  // Determine responsive grid layout based on number of active video cards
  const gridLayoutClass =
    videoCards.length === 1
      ? 'grid-cols-1 max-w-6xl mx-auto'
      : videoCards.length === 2
      ? 'grid-cols-1 xl:grid-cols-2'
      : 'grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3';

  return (
    <div className="space-y-6 max-w-[1700px] mx-auto pb-16 px-2 sm:px-4">
      {/* ─── WORKSPACE MASTER HEADER ───────────────────────────────── */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-5 shadow-2xl backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 bg-cyan-950/80 border border-cyan-500/40 rounded-2xl text-cyan-400 shadow-lg shadow-cyan-950/50">
            <Film className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2.5">
              <h2 className="text-xl font-bold font-mono tracking-wide text-slate-100">
                MULTI-VIDEO TRAFFIC DASHBOARD
              </h2>
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-950/90 border border-cyan-500/60 text-cyan-300 font-mono font-bold text-xs">
                {videoCards.length} {videoCards.length === 1 ? 'SOURCE FEED' : 'SOURCE FEEDS'}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5">
              Multi-source video uploads & live connected cameras with GPU vehicle detection, ByteTrack tracking & road polygon analytics
            </p>
          </div>
        </div>

        {/* Global Action: + Add Video & + Add Camera Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleAddVideo}
            className="flex items-center px-4 py-2.5 rounded-2xl text-xs font-bold font-mono uppercase tracking-wider bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-slate-950 shadow-lg shadow-cyan-500/25 active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4 mr-1.5 stroke-[2.5]" />
            + Add Video
          </button>

          <button
            onClick={handleAddCamera}
            className="flex items-center px-4 py-2.5 rounded-2xl text-xs font-bold font-mono uppercase tracking-wider bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-lg shadow-emerald-500/25 active:scale-95 transition-all"
          >
            <Camera className="w-4 h-4 mr-1.5 stroke-[2.5]" />
            + Add Camera
          </button>

          <button
            onClick={onRefresh}
            title="Refresh System"
            className="p-2.5 text-slate-400 hover:text-slate-200 bg-slate-950 border border-slate-800 rounded-2xl transition-colors shadow-inner"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ─── RESPONSIVE VIDEO CARDS GRID ───────────────────────────── */}
      <div className={`grid ${gridLayoutClass} gap-6`}>
        {videoCards.map((card, idx) => (
          <ErrorBoundary key={card.id} fallbackTitle={`Source Card ${idx + 1} Error`}>
            <VideoSessionCard
              videoId={card.id}
              index={idx}
              totalCards={videoCards.length}
              initialPreset={card.preset}
              initialInputMode={card.inputMode}
              onRemove={handleRemoveVideo}
            />
          </ErrorBoundary>
        ))}
      </div>
    </div>
  );
};
