import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import type { LiveAnalysisState } from '../types';
import { api } from '../services/api';

export type Point = [number, number];

export interface ManualRoad {
  road_id: string;
  name: string;
  polygon: Point[];
  length_meters?: number;
}

export interface VideoProcessingContextType {
  activeJobId: string | null;
  status: string;
  isAnalyzing: boolean;
  inferenceComplete: boolean;
  selectedPreset: string;
  videoName: string;
  uploadedVideoUrl: string | null;
  videoDuration: number;
  framesProcessed: number;
  totalFrames: number;
  progressPct: number;
  currentFps: number;
  videoTimeSeconds: number;
  liveTelemetry: LiveAnalysisState | null;
  statusMessage: string;
  videoError: boolean;
  manualRoads: ManualRoad[];
  outputUrl: string | null;

  setSelectedPreset: (preset: string) => void;
  setActiveJobId: (id: string | null) => void;
  setUploadedVideoUrl: (url: string | null) => void;
  setVideoName: (name: string) => void;
  setVideoDuration: (dur: number) => void;
  setManualRoads: React.Dispatch<React.SetStateAction<ManualRoad[]>>;
  setStatusMessage: (msg: string) => void;
  setVideoError: (err: boolean) => void;

  startInference: (
    presetOrFile?: string | File,
    maxFrames?: number,
    roadsConfig?: any[]
  ) => Promise<{ job_id: string; status: string; already_running?: boolean }>;
  stopInference: () => Promise<void>;
  resetSession: () => void;
  refreshActiveSession: () => Promise<void>;
}

const VideoProcessingContext = createContext<VideoProcessingContextType | null>(null);

export const VideoProcessingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('IDLE');
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [inferenceComplete, setInferenceComplete] = useState<boolean>(false);
  const [selectedPreset, setSelectedPreset] = useState<string>('cam_5');
  const [videoName, setVideoName] = useState<string>('cam_5.mp4');
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [framesProcessed, setFramesProcessed] = useState<number>(0);
  const [totalFrames, setTotalFrames] = useState<number>(600);
  const [currentFps, setCurrentFps] = useState<number>(0);
  const [videoTimeSeconds, setVideoTimeSeconds] = useState<number>(0);
  const [liveTelemetry, setLiveTelemetry] = useState<LiveAnalysisState | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [videoError, setVideoError] = useState<boolean>(false);
  const [manualRoads, setManualRoads] = useState<ManualRoad[]>([]);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const activeJobIdRef = useRef<string | null>(null);
  activeJobIdRef.current = activeJobId;
  const isAnalyzingRef = useRef<boolean>(false);
  isAnalyzingRef.current = isAnalyzing;

  const progressPct = totalFrames > 0 ? Math.min(100, Math.round((framesProcessed / totalFrames) * 100)) : 0;

  // Sync state from backend active session
  const refreshActiveSession = useCallback(async () => {
    try {
      const activeData = await api.getActiveSession();
      if (activeData && activeData.job_id) {
        if (!activeJobIdRef.current || activeJobIdRef.current === activeData.job_id) {
          setActiveJobId(activeData.job_id);
          setStatus(activeData.status);
          if (activeData.camera_id) setSelectedPreset(activeData.camera_id);
          if (activeData.video_name) setVideoName(activeData.video_name);
          if (typeof activeData.frames_processed === 'number') setFramesProcessed(activeData.frames_processed);
          if (typeof activeData.total_frames === 'number') setTotalFrames(activeData.total_frames);
          if (typeof activeData.current_fps === 'number') setCurrentFps(activeData.current_fps);
          if (typeof activeData.video_time_seconds === 'number') setVideoTimeSeconds(activeData.video_time_seconds);
          if (activeData.output_url) setOutputUrl(activeData.output_url);

          if (activeData.status === 'PROCESSING' || activeData.status === 'ANALYZING' || activeData.active) {
            setIsAnalyzing(true);
            setInferenceComplete(false);
            setStatusMessage(`Inference running on GPU... (${activeData.frames_processed || 0}/${activeData.total_frames || 600} frames)`);
          } else if (activeData.status === 'READY' || activeData.status === 'COMPLETED') {
            setIsAnalyzing(false);
            setInferenceComplete(true);
            setStatusMessage('✓ Inference complete. Output video ready.');
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch active session:', e);
    }
  }, []);

  // Check active session on mount
  useEffect(() => {
    refreshActiveSession();
  }, [refreshActiveSession]);

  // Connect WebSocket and polling loop at provider level to ensure persistence across route changes
  useEffect(() => {
    if (!activeJobId) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      return;
    }

    let isMounted = true;
    let lastWsUpdate = 0;

    // Connect WebSocket
    try {
      const wsUrl = api.getWsUrl(activeJobId);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const now = Date.now();
          const data = JSON.parse(event.data) as LiveAnalysisState;
          if (data && data.frame_index !== undefined) {
            lastWsUpdate = now;
            setLiveTelemetry(data);
            setFramesProcessed(data.frame_index);
            if (data.total_frames) setTotalFrames(data.total_frames);
            if (data.video_time_seconds !== undefined) setVideoTimeSeconds(data.video_time_seconds);
            if (data.traffic_state) setStatus(data.traffic_state);
          }
        } catch {}
      };

      ws.onerror = () => {
        // Will seamlessly fallback to HTTP polling
      };
    } catch {}

    // Polling fallback / status monitor
    const pollInterval = setInterval(async () => {
      if (!isMounted || !activeJobId) return;
      try {
        const timeSinceWs = Date.now() - lastWsUpdate;
        // Fallback polling for live telemetry if WebSocket has not fired recently
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN || timeSinceWs > 250) {
          try {
            const liveRes = await fetch(`${api.apiBaseUrl}/api/analysis/${activeJobId}/live`);
            if (liveRes.ok) {
              const liveData = await liveRes.json();
              if (liveData && liveData.frame_index !== undefined) {
                setLiveTelemetry(liveData);
                setFramesProcessed(liveData.frame_index);
                if (liveData.total_frames) setTotalFrames(liveData.total_frames);
                if (liveData.video_time_seconds !== undefined) setVideoTimeSeconds(liveData.video_time_seconds);
              }
            }
          } catch {}
        }

        // Check overall inference status
        const res = await fetch(`${api.apiBaseUrl}/api/inference/${activeJobId}/status`);
        if (res.ok) {
          const statusData = await res.json();
          if (typeof statusData.frames_processed === 'number') {
            setFramesProcessed(statusData.frames_processed);
          }
          if (typeof statusData.total_frames === 'number') {
            setTotalFrames(statusData.total_frames);
          }
          if (typeof statusData.current_fps === 'number') {
            setCurrentFps(statusData.current_fps);
          }

          if (statusData.status === 'READY' || statusData.status === 'COMPLETED') {
            setIsAnalyzing(false);
            setInferenceComplete(true);
            setStatus('READY');
            setStatusMessage('✓ Inference complete. Output video ready.');
            setOutputUrl(`/api/jobs/${activeJobId}/output`);
            // Fetch final summary
            try {
              const liveRes = await fetch(`${api.apiBaseUrl}/api/analysis/${activeJobId}/live`);
              if (liveRes.ok) {
                const liveData = await liveRes.json();
                if (liveData && liveData.frame_index !== undefined) {
                  setLiveTelemetry(liveData);
                }
              }
            } catch {}
            clearInterval(pollInterval);
          } else if (statusData.status === 'ERROR') {
            setIsAnalyzing(false);
            setStatus('ERROR');
            setStatusMessage(`✗ Processing failed: ${statusData.error_message || 'Unknown error'}`);
            clearInterval(pollInterval);
          } else if (statusData.status === 'CANCELLED' || statusData.status === 'IDLE') {
            if (isAnalyzingRef.current) {
              setIsAnalyzing(false);
              setStatus(statusData.status);
              setStatusMessage('Analysis stopped.');
              clearInterval(pollInterval);
            }
          }
        }
      } catch (err) {
        console.warn('Polling error:', err);
      }
    }, 200);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [activeJobId]);

  // Start inference action
  const startInference = useCallback(async (
    presetOrFile?: string | File,
    maxFrames: number = 600,
    roadsConfig?: any[]
  ) => {
    try {
      setIsAnalyzing(true);
      setInferenceComplete(false);
      setVideoError(false);
      setStatusMessage('Initializing video pipeline & GPU model...');

      let targetId = (typeof presetOrFile === 'string' && presetOrFile) ? presetOrFile : (activeJobId || selectedPreset);

      if (presetOrFile instanceof File) {
        setStatusMessage('Uploading video to server...');
        const uploadRes = await api.uploadVideo(presetOrFile, selectedPreset || 'cam_5');
        targetId = uploadRes.job_id;
        setActiveJobId(uploadRes.job_id);
        setVideoName(presetOrFile.name);
      } else if (typeof presetOrFile === 'string' && presetOrFile) {
        targetId = presetOrFile;
      }

      if (!targetId) {
        throw new Error('No video selected or uploaded. Please select a video preset or upload a video file first.');
      }

      setStatusMessage('Running YOLOv8 vehicle detection & ByteTrack on GPU...');
      const response = await api.startInference(targetId, maxFrames, roadsConfig || (manualRoads.length > 0 ? manualRoads : undefined));

      setActiveJobId(response.job_id);
      setStatus('PROCESSING');

      if ((response as any).already_running) {
        setStatusMessage(`Reattached to existing background job ${response.job_id}`);
      }

      return response;
    } catch (err: any) {
      setIsAnalyzing(false);
      setVideoError(true);
      setStatusMessage(`Failed to start inference: ${err?.message || 'Network error'}`);
      throw err;
    }
  }, [selectedPreset, manualRoads]);

  // Stop inference action
  const stopInference = useCallback(async () => {
    if (!activeJobId) return;
    try {
      setStatusMessage('Stopping pipeline...');
      await api.stopInference(activeJobId);
      setIsAnalyzing(false);
      setStatus('CANCELLED');
      setStatusMessage('Inference stopped by user.');
    } catch (err: any) {
      console.error('Failed to stop inference', err);
      setStatusMessage(`Stop error: ${err?.message || 'Failed to stop'}`);
    }
  }, [activeJobId]);

  // Reset session
  const resetSession = useCallback(() => {
    if (activeJobId && isAnalyzing) {
      api.stopInference(activeJobId).catch(() => {});
    }
    setActiveJobId(null);
    setStatus('IDLE');
    setIsAnalyzing(false);
    setInferenceComplete(false);
    setFramesProcessed(0);
    setLiveTelemetry(null);
    setStatusMessage('');
    setOutputUrl(null);
  }, [activeJobId, isAnalyzing]);

  return (
    <VideoProcessingContext.Provider
      value={{
        activeJobId,
        status,
        isAnalyzing,
        inferenceComplete,
        selectedPreset,
        videoName,
        uploadedVideoUrl,
        videoDuration,
        framesProcessed,
        totalFrames,
        progressPct,
        currentFps,
        videoTimeSeconds,
        liveTelemetry,
        statusMessage,
        videoError,
        manualRoads,
        outputUrl,

        setSelectedPreset,
        setActiveJobId,
        setUploadedVideoUrl,
        setVideoName,
        setVideoDuration,
        setManualRoads,
        setStatusMessage,
        setVideoError,

        startInference,
        stopInference,
        resetSession,
        refreshActiveSession,
      }}
    >
      {children}
    </VideoProcessingContext.Provider>
  );
};

export const useVideoProcessing = (): VideoProcessingContextType => {
  const context = useContext(VideoProcessingContext);
  if (!context) {
    throw new Error('useVideoProcessing must be used within a VideoProcessingProvider');
  }
  return context;
};
