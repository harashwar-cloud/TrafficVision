import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrafficCone,
  CheckCircle2,
  Play,
  RefreshCw,
  Zap,
  XCircle,
  AlertCircle,
  SlidersHorizontal,
  Plus,
  ChevronDown,
  ChevronUp,
  Search,
  CheckCheck,
  Compass,
} from 'lucide-react';
import { api } from '../services/api';
import { useVideoProcessing } from '../context/VideoProcessingContext';
import type {
  IntersectionSummary,
  IntersectionConfig,
  IntersectionAnalytics,
  SignalRecommendation,
  SignalSimulationResult,
  PlanComparison,
  AuditLogEntry,
  SimulationScenarioType,
  ApproachDemand,
  VideoReadinessReport,
  SignalStatusResponse,
  ManualSignalSelection,
} from '../types';

export const AdaptiveSignalControl: React.FC = () => {
  const videoProc = useVideoProcessing();

  // Core Data States
  const [intersections, setIntersections] = useState<IntersectionSummary[]>([]);
  const [selectedIntersectionId, setSelectedIntersectionId] = useState<string>('int_cam5');
  const [config, setConfig] = useState<IntersectionConfig | null>(null);
  const [analytics, setAnalytics] = useState<IntersectionAnalytics | null>(null);
  const [recommendation, setRecommendation] = useState<SignalRecommendation | null>(null);
  const [signalStatus, setSignalStatus] = useState<SignalStatusResponse | null>(null);
  const [videoReadiness, setVideoReadiness] = useState<VideoReadinessReport | null>(null);
  const [manualSelection, setManualSelection] = useState<ManualSignalSelection | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);

  // Workflow Step 1 & 2 Configuration States
  const [configuredSignalNum, setConfiguredSignalNum] = useState<number>(1);
  const [configuredPhaseId, setConfiguredPhaseId] = useState<string>('P1');
  const [configuredGreenSec, setConfiguredGreenSec] = useState<number>(30);
  const [configuredApproaches, setConfiguredApproaches] = useState<string[]>(['north', 'south']);

  // Authoritative Live Clock Countdown
  const [liveRemainingSec, setLiveRemainingSec] = useState<number | null>(null);

  // Actions & Modals
  const [isStartingSignal, setIsStartingSignal] = useState<boolean>(false);
  const [isExtendingGreen, setIsExtendingGreen] = useState<boolean>(false);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [isRejecting, setIsRejecting] = useState<boolean>(false);
  const [rejectionModalOpen, setRejectionModalOpen] = useState<boolean>(false);
  const [rejectionReason, setRejectionReason] = useState<string>('Officer manual traffic override');
  const [deploySuccessMessage, setDeploySuccessMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRejectionDetails, setShowRejectionDetails] = useState<boolean>(false);

  // Search & Collapsible Sections
  const [historySearchQuery, setHistorySearchQuery] = useState<string>('');
  const [showAdvancedAnalytics, setShowAdvancedAnalytics] = useState<boolean>(false);

  // Advanced What-If Simulator
  const [selectedScenario, setSelectedScenario] = useState<SimulationScenarioType>('NORMAL_TRAFFIC');
  const [simulationResult, setSimulationResult] = useState<SignalSimulationResult | null>(null);
  const [planComparison, setPlanComparison] = useState<PlanComparison | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);

  // 1. Fetch available intersections on mount
  useEffect(() => {
    const fetchIntersections = async () => {
      try {
        const list = await api.getIntersections();
        setIntersections(list);
        if (list.length > 0 && !selectedIntersectionId) {
          setSelectedIntersectionId(list[0].intersection_id);
        }
      } catch (err) {
        console.error('Failed to load intersections', err);
      }
    };
    fetchIntersections();
  }, []);

  // 2. Fetch full intersection data
  const fetchIntersectionData = useCallback(async (intId: string) => {
    if (!intId) return;
    setActionError(null);
    try {
      const [conf, anal, rec, readiness, status, manSel, logData] = await Promise.allSettled([
        api.getIntersection(intId),
        api.getIntersectionAnalytics(intId),
        api.generateSignalRecommendation(intId),
        api.getVideoReadiness(intId),
        api.getSignalStatus(intId),
        api.getManualSignalSelection(intId),
        api.getIntersectionAuditLog(intId, 25),
      ]);

      if (conf.status === 'fulfilled') setConfig(conf.value);
      if (anal.status === 'fulfilled') setAnalytics(anal.value);
      if (rec.status === 'fulfilled') setRecommendation(rec.value);
      if (readiness.status === 'fulfilled') setVideoReadiness(readiness.value);
      if (status.status === 'fulfilled') {
        const st = status.value;
        setSignalStatus(st);
        if (st.signal_number) setConfiguredSignalNum(st.signal_number);
        if (st.current_phase_id) setConfiguredPhaseId(st.current_phase_id);
        if (st.duration_sec) setConfiguredGreenSec(st.duration_sec);
        if (st.served_approaches) setConfiguredApproaches(st.served_approaches);
      }
      if (manSel.status === 'fulfilled' && manSel.value) {
        setManualSelection(manSel.value);
      }
      if (logData.status === 'fulfilled') setAuditLog(logData.value);
    } catch (err) {
      console.error('Error fetching intersection details', err);
    }
  }, []);

  useEffect(() => {
    fetchIntersectionData(selectedIntersectionId);
  }, [selectedIntersectionId, fetchIntersectionData]);

  // 3. Authoritative Signal Clock Countdown Effect (strictly derived from backend phase timestamps)
  useEffect(() => {
    if (!signalStatus?.phase_end_time || !signalStatus?.is_timing_available) {
      setLiveRemainingSec(null);
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      const greenEnd = new Date(signalStatus.phase_end_time!).getTime();
      const amberEnd = signalStatus.amber_end_time
        ? new Date(signalStatus.amber_end_time).getTime()
        : greenEnd + (signalStatus.amber_sec || 3.0) * 1000;
      const allRedEnd = signalStatus.all_red_end_time
        ? new Date(signalStatus.all_red_end_time).getTime()
        : amberEnd + (signalStatus.all_red_sec || 2.0) * 1000;

      if (now < greenEnd) {
        setLiveRemainingSec(Math.max(0, (greenEnd - now) / 1000));
      } else if (now < amberEnd) {
        setLiveRemainingSec(Math.max(0, (amberEnd - now) / 1000));
      } else if (now < allRedEnd) {
        setLiveRemainingSec(Math.max(0, (allRedEnd - now) / 1000));
      } else {
        setLiveRemainingSec(0);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 100);
    return () => clearInterval(interval);
  }, [
    signalStatus?.phase_end_time,
    signalStatus?.amber_end_time,
    signalStatus?.all_red_end_time,
    signalStatus?.is_timing_available,
    signalStatus?.amber_sec,
    signalStatus?.all_red_sec,
  ]);

  // 4. Polling for Live Analytics and Authoritative Clock & 8s Recommendation Trigger
  useEffect(() => {
    if (!autoRefresh || !selectedIntersectionId) return;
    const pollInterval = videoProc.isAnalyzing ? 1500 : 3000;

    const interval = setInterval(async () => {
      try {
        const [anal, status, readiness] = await Promise.allSettled([
          api.getIntersectionAnalytics(selectedIntersectionId),
          api.getSignalStatus(selectedIntersectionId),
          api.getVideoReadiness(selectedIntersectionId),
        ]);

        if (anal.status === 'fulfilled') setAnalytics(anal.value);
        if (status.status === 'fulfilled') {
          const newStatus = status.value;
          setSignalStatus(newStatus);

          // Automated trigger: if at 8s remaining and recommendation not approved, fetch scheduled 8s recommendation
          if (
            newStatus.should_trigger_recommendation &&
            (!recommendation || recommendation.status !== 'APPROVED')
          ) {
            try {
              const rec = await api.generateSignalRecommendation(selectedIntersectionId, 'SCHEDULED_8S');
              setRecommendation(rec);
            } catch (e) {
              console.warn('8s auto-recommendation fetch failed', e);
            }
          }
        }
        if (readiness.status === 'fulfilled') setVideoReadiness(readiness.value);
      } catch (err) {
        console.warn('Live polling failed', err);
      }
    }, pollInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, selectedIntersectionId, videoProc.isAnalyzing, recommendation]);

  // List of configured roads & approach demands
  const approachDemands = useMemo<ApproachDemand[]>(() => {
    return analytics?.approach_demands || recommendation?.approach_demands || [];
  }, [analytics, recommendation]);

  // Phase lookup helper
  const availablePhases = useMemo(() => {
    return config?.phases || [
      {
        phase_id: 'P1',
        phase_name: 'North–South Through',
        served_approaches: ['north', 'south'],
        min_green_sec: 15,
        max_green_sec: 55,
        amber_sec: 3,
        all_red_sec: 2,
      },
      {
        phase_id: 'P2',
        phase_name: 'East–West Through',
        served_approaches: ['east', 'west'],
        min_green_sec: 10,
        max_green_sec: 45,
        amber_sec: 3,
        all_red_sec: 2,
      },
    ];
  }, [config]);

  // Current selected phase details for Step 1
  const activeConfigPhase = useMemo(() => {
    return availablePhases.find((p) => p.phase_id === configuredPhaseId) || availablePhases[0];
  }, [availablePhases, configuredPhaseId]);

  // Map approach ID to user-defined Road Name
  const getRoadName = useCallback(
    (approachId: string): string => {
      const matched = approachDemands.find(
        (a) =>
          a.approach_id?.toLowerCase() === approachId.toLowerCase() ||
          a.direction?.toLowerCase() === approachId.toLowerCase() ||
          a.road_id?.toLowerCase() === approachId.toLowerCase()
      );
      if (matched && matched.name && !matched.name.startsWith('Approach')) {
        return matched.name;
      }
      const cfgApp = config?.approaches.find(
        (a) =>
          a.approach_id?.toLowerCase() === approachId.toLowerCase() ||
          a.direction?.toLowerCase() === approachId.toLowerCase()
      );
      if (cfgApp && cfgApp.name && !cfgApp.name.startsWith('Approach')) {
        return cfgApp.name;
      }
      return approachId.charAt(0).toUpperCase() + approachId.slice(1) + ' Road';
    },
    [approachDemands, config]
  );

  // Active road names receiving green
  const activeRoadNames = useMemo<string[]>(() => {
    if (signalStatus?.served_road_names && signalStatus.served_road_names.length > 0) {
      return signalStatus.served_road_names;
    }
    const apps = signalStatus?.served_approaches || activeConfigPhase?.served_approaches || [];
    return apps.map((a) => getRoadName(a));
  }, [signalStatus, activeConfigPhase, getRoadName]);

  // Handlers for Step 2: Start Signal Timer
  const handleStartSignal = async () => {
    if (!selectedIntersectionId || !configuredPhaseId) return;
    setIsStartingSignal(true);
    setActionError(null);
    try {
      const updated = await api.startSignalTimer(selectedIntersectionId, {
        intersection_id: selectedIntersectionId,
        phase_id: configuredPhaseId,
        green_duration_sec: configuredGreenSec,
        signal_number: configuredSignalNum,
        served_approaches: configuredApproaches,
        officer_id: 'officer_1',
      });
      setSignalStatus(updated);
      setDeploySuccessMessage(
        `Signal ${configuredSignalNum} started. Phase ${updated.current_phase_name} active with ${configuredGreenSec}s green.`
      );
      const log = await api.getIntersectionAuditLog(selectedIntersectionId, 25);
      setAuditLog(log);
      setTimeout(() => setDeploySuccessMessage(null), 5000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to start signal timer');
      setTimeout(() => setActionError(null), 6000);
    } finally {
      setIsStartingSignal(false);
    }
  };

  // Handler for Green Extension (ISSUE 5 & 6)
  const handleExtendGreen = async (seconds: number) => {
    if (!signalStatus || isExtendingGreen) return;
    setIsExtendingGreen(true);
    setActionError(null);
    try {
      const requestId = `ext_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const result = await api.extendGreen(selectedIntersectionId, {
        intersection_id: selectedIntersectionId,
        current_phase_id: signalStatus.current_phase_id,
        recommendation_id: recommendation?.recommendation_id,
        request_id: requestId,
        extension_sec: seconds,
        expected_phase_end_time: signalStatus.phase_end_time,
        officer_id: 'officer_1',
      });
      if (result.signal_status) {
        setSignalStatus(result.signal_status);
      }
      setDeploySuccessMessage(
        `Green time extended by +${seconds}s. Authoritative countdown updated to ${result.new_remaining_sec?.toFixed(1) || ''}s.`
      );
      const log = await api.getIntersectionAuditLog(selectedIntersectionId, 25);
      setAuditLog(log);
      setTimeout(() => setDeploySuccessMessage(null), 5000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to extend green duration.');
      setTimeout(() => setActionError(null), 6000);
    } finally {
      setIsExtendingGreen(false);
    }
  };

  // Handler for Approving Suggestion
  const handleApproveSuggestion = async () => {
    if (!recommendation) return;
    setIsApproving(true);
    setActionError(null);
    try {
      const updated = await api.approveRecommendation(
        selectedIntersectionId,
        recommendation.recommendation_id,
        recommendation.recommended_phase.proposed_green_sec,
        'officer_1'
      );
      setRecommendation(updated);
      setDeploySuccessMessage('Suggestion approved. The next phase is ready.');
      const log = await api.getIntersectionAuditLog(selectedIntersectionId, 25);
      setAuditLog(log);
      setTimeout(() => setDeploySuccessMessage(null), 6000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to approve suggestion.');
      setTimeout(() => setActionError(null), 6000);
    } finally {
      setIsApproving(false);
    }
  };

  // Handler for Rejecting Suggestion
  const handleRejectSuggestion = async () => {
    if (!recommendation) return;
    setIsRejecting(true);
    setActionError(null);
    try {
      const updated = await api.rejectRecommendation(
        selectedIntersectionId,
        recommendation.recommendation_id,
        rejectionReason || 'Officer manual override',
        'officer_1'
      );
      setRecommendation(updated);
      setRejectionModalOpen(false);
      setDeploySuccessMessage(
        `Suggestion rejected. Reason: "${rejectionReason}". Baseline plan remains active.`
      );
      const log = await api.getIntersectionAuditLog(selectedIntersectionId, 25);
      setAuditLog(log);
      setTimeout(() => setDeploySuccessMessage(null), 6000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to reject suggestion.');
      setTimeout(() => setActionError(null), 6000);
    } finally {
      setIsRejecting(false);
    }
  };

  // Simulation handler for collapsible advanced section
  const handleRunSimulation = async (scenario: SimulationScenarioType = selectedScenario) => {
    setIsSimulating(true);
    try {
      const result = await api.runSignalSimulation(selectedIntersectionId, scenario);
      setSimulationResult(result);
      const comparison = await api.compareSignalPlans(selectedIntersectionId, scenario);
      setPlanComparison(comparison);
      const log = await api.getIntersectionAuditLog(selectedIntersectionId, 25);
      setAuditLog(log);
    } catch (err) {
      console.error('Simulation failed', err);
    } finally {
      setIsSimulating(false);
    }
  };

  // Helper formatting for countdown digits (e.g. 00:25)
  const formatCountdown = (seconds: number | null): string => {
    if (seconds === null || isNaN(seconds)) return '--:--';
    const totalSec = Math.max(0, Math.ceil(seconds));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Current Signal State Color and Progress
  const currentSignalState = signalStatus?.signal_state || 'GREEN';
  const totalPhaseSec = signalStatus?.duration_sec || 30;
  const elapsedSec = signalStatus?.elapsed_sec || 0;
  const progressPct = Math.min(100, Math.max(0, (elapsedSec / Math.max(1, totalPhaseSec)) * 100));

  // Filtered History Entries
  const filteredAuditLog = useMemo(() => {
    if (!historySearchQuery.trim()) return auditLog;
    const q = historySearchQuery.toLowerCase();
    return auditLog.filter(
      (entry) =>
        entry.event_type.toLowerCase().includes(q) ||
        JSON.stringify(entry.details).toLowerCase().includes(q) ||
        entry.actor.toLowerCase().includes(q)
    );
  }, [auditLog, historySearchQuery]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '48px', color: 'var(--text-primary)' }}>
      {/* Top Notification Alerts */}
      {deploySuccessMessage && (
        <div
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid #10b981',
            borderRadius: '10px',
            padding: '14px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: '#34d399',
            fontSize: '14px',
            fontWeight: 600,
            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.2)',
          }}
        >
          <CheckCircle2 size={20} />
          <span>{deploySuccessMessage}</span>
        </div>
      )}

      {actionError && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #ef4444',
            borderRadius: '10px',
            padding: '14px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: '#f87171',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          <AlertCircle size={20} />
          <span>{actionError}</span>
        </div>
      )}

      {/* Header Bar */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '14px',
          padding: '18px 24px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 0 16px rgba(56, 189, 248, 0.4)',
            }}
          >
            <TrafficCone size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                Traffic Signal Control
              </h1>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '3px 9px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Officer Dashboard
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
              Live authoritative signal controller & automated traffic-demand decision support.
            </p>
          </div>
        </div>

        {/* Intersection Selector & Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {videoReadiness && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                color: videoReadiness.is_ready ? '#10b981' : '#f59e0b',
                backgroundColor: videoReadiness.is_ready ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                padding: '4px 8px',
                borderRadius: '6px',
              }}
            >
              Feeds: {videoReadiness.coverage_status} ({videoReadiness.valid_session_count} active)
            </span>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)' }}>Intersection:</span>
            <select
              value={selectedIntersectionId}
              onChange={(e) => setSelectedIntersectionId(e.target.value)}
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '8px 12px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                fontWeight: 600,
                outline: 'none',
              }}
            >
              {intersections.map((it) => (
                <option key={it.intersection_id} value={it.intersection_id}>
                  {it.name} ({it.intersection_id})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            title="Toggle Live Telemetry Polling"
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: autoRefresh ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-elevated)',
              color: autoRefresh ? '#38bdf8' : 'var(--text-muted)',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {autoRefresh ? 'Live Sync: ON' : 'Live Sync: PAUSED'}
          </button>

          <button
            onClick={() => fetchIntersectionData(selectedIntersectionId)}
            title="Refresh Live Data"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          SECTION 2: THREE-STEP SIGNAL CONTROL WORKFLOW
         ========================================================================= */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '16px',
        }}
      >
        {/* Step 1 — Configure Signal */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                backgroundColor: '#0284c7',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              1
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700 }}>Step 1 — Configure Signal</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Choose signal, phase & green duration</div>
            </div>
          </div>

          {/* Signal Number & Phase Selection */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                SIGNAL NO.
              </label>
              <select
                value={configuredSignalNum}
                onChange={(e) => setConfiguredSignalNum(parseInt(e.target.value, 10))}
                style={{
                  width: '100%',
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                <option value={1}>Signal 1</option>
                <option value={2}>Signal 2</option>
                <option value={3}>Signal 3</option>
                <option value={4}>Signal 4</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
                ACTIVE PHASE
              </label>
              <select
                value={configuredPhaseId}
                onChange={(e) => {
                  const pid = e.target.value;
                  setConfiguredPhaseId(pid);
                  const p = availablePhases.find((ph) => ph.phase_id === pid);
                  if (p && p.served_approaches) {
                    setConfiguredApproaches(p.served_approaches);
                  }
                }}
                style={{
                  width: '100%',
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  fontWeight: 600,
                }}
              >
                {availablePhases.map((ph) => (
                  <option key={ph.phase_id} value={ph.phase_id}>
                    {ph.phase_id}: {ph.phase_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Road Approaches Served (Actual User-Defined Road Names) */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
              ROADS RECEIVING GREEN
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {(activeConfigPhase?.served_approaches || ['north', 'south']).map((appId) => (
                <span
                  key={appId}
                  style={{
                    backgroundColor: 'rgba(56, 189, 248, 0.12)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <Compass size={12} />
                  {getRoadName(appId)}
                </span>
              ))}
            </div>
          </div>

          {/* Green Duration in Seconds */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>GREEN DURATION (SEC)</label>
              <span style={{ fontSize: '13px', fontWeight: 800, color: '#38bdf8' }}>{configuredGreenSec}s</span>
            </div>
            <input
              type="range"
              min={activeConfigPhase?.min_green_sec || 15}
              max={activeConfigPhase?.max_green_sec || 60}
              value={configuredGreenSec}
              onChange={(e) => setConfiguredGreenSec(parseInt(e.target.value, 10))}
              style={{ width: '100%', accentColor: '#38bdf8' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
              <span>Min: {activeConfigPhase?.min_green_sec || 15}s</span>
              <span>Max: {activeConfigPhase?.max_green_sec || 60}s</span>
            </div>
          </div>
        </div>

        {/* Step 2 — Start Signal Timer */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '14px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: '#10b981',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                2
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700 }}>Step 2 — Start Signal Timer</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Review confirmation & launch authoritative timer</div>
              </div>
            </div>

            {/* Confirmation Summary Card */}
            <div
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '12px 14px',
                fontSize: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Target Intersection:</span>
                <span style={{ fontWeight: 700 }}>{config?.name || selectedIntersectionId}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Selected Signal:</span>
                <span style={{ fontWeight: 700, color: '#38bdf8' }}>Signal {configuredSignalNum}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Phase Plan:</span>
                <span style={{ fontWeight: 700 }}>{activeConfigPhase?.phase_name}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Approved Green:</span>
                <span style={{ fontWeight: 800, color: '#10b981' }}>{configuredGreenSec} seconds</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Clearance Stages:</span>
                <span style={{ color: 'var(--text-muted)' }}>Amber 3.0s | All-Red 2.0s</span>
              </div>
            </div>
          </div>

          <button
            onClick={handleStartSignal}
            disabled={isStartingSignal}
            style={{
              width: '100%',
              backgroundColor: '#10b981',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              padding: '12px',
              fontSize: '14px',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              cursor: isStartingSignal ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
              transition: 'background-color 0.2s',
            }}
          >
            {isStartingSignal ? <RefreshCw className="animate-spin" size={16} /> : <Play size={16} />}
            <span>Start Signal</span>
          </button>
        </div>

        {/* Step 3 — Monitor & Decide */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '14px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: '#a855f7',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                3
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700 }}>Step 3 — Monitor and Decide</div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Watch live countdown & respond to 8s suggestions</div>
              </div>
            </div>

            <div
              style={{
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Active Status:</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: currentSignalState === 'GREEN' ? '#10b981' : currentSignalState === 'AMBER' ? '#f59e0b' : '#ef4444',
                    boxShadow: `0 0 8px ${currentSignalState === 'GREEN' ? '#10b981' : currentSignalState === 'AMBER' ? '#f59e0b' : '#ef4444'}`,
                  }}
                />
                <span style={{ fontSize: '14px', fontWeight: 800 }}>
                  {signalStatus?.status_label || 'Signal Timer Running'}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                Automatic recommendation generates 8s before green ends. You can approve or extend below without leaving this view.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => handleExtendGreen(10)}
              disabled={isExtendingGreen}
              style={{
                flex: 1,
                backgroundColor: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '6px',
                padding: '8px 10px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <Plus size={14} />
              <span>Extend +10s</span>
            </button>
            <button
              onClick={() => handleExtendGreen(15)}
              disabled={isExtendingGreen}
              style={{
                flex: 1,
                backgroundColor: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '6px',
                padding: '8px 10px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <Plus size={14} />
              <span>Extend +15s</span>
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          SECTION 3: LARGE, CLEAR TRAFFIC SIGNAL PANEL
         ========================================================================= */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)',
          display: 'grid',
          gridTemplateColumns: 'minmax(120px, 140px) 1fr',
          gap: '24px',
          alignItems: 'center',
        }}
      >
        {/* Visual Traffic Light Lamps Housing */}
        <div
          style={{
            backgroundColor: '#0f172a',
            border: '3px solid #1e293b',
            borderRadius: '28px',
            padding: '16px 12px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px',
            boxShadow: 'inset 0 2px 10px rgba(0, 0, 0, 0.8), 0 6px 20px rgba(0, 0, 0, 0.6)',
          }}
        >
          {/* Red Lamp */}
          <div
            title="Red Lamp (Clearance / Stop)"
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: currentSignalState === 'RED' ? '#ef4444' : '#281114',
              boxShadow: currentSignalState === 'RED' ? '0 0 24px #ef4444, inset 0 0 8px #fca5a5' : 'inset 0 2px 6px rgba(0,0,0,0.8)',
              border: `2px solid ${currentSignalState === 'RED' ? '#f87171' : '#3d1a1e'}`,
              transition: 'all 0.3s ease',
            }}
          />

          {/* Amber Lamp */}
          <div
            title="Amber Lamp (Transitioning)"
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: currentSignalState === 'AMBER' ? '#f59e0b' : '#2d2208',
              boxShadow: currentSignalState === 'AMBER' ? '0 0 24px #f59e0b, inset 0 0 8px #fde68a' : 'inset 0 2px 6px rgba(0,0,0,0.8)',
              border: `2px solid ${currentSignalState === 'AMBER' ? '#fbbf24' : '#45340d'}`,
              transition: 'all 0.3s ease',
            }}
          />

          {/* Green Lamp */}
          <div
            title="Green Lamp (Active Green)"
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              backgroundColor: currentSignalState === 'GREEN' ? '#10b981' : '#09251a',
              boxShadow: currentSignalState === 'GREEN' ? '0 0 24px #10b981, inset 0 0 8px #6ee7b7' : 'inset 0 2px 6px rgba(0,0,0,0.8)',
              border: `2px solid ${currentSignalState === 'GREEN' ? '#34d399' : '#134e38'}`,
              transition: 'all 0.3s ease',
            }}
          />
        </div>

        {/* Signal Information, Big Digits & Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Top Identifier & Badges */}
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '18px', fontWeight: 900, letterSpacing: '0.02em', color: '#38bdf8' }}>
                SIGNAL {signalStatus?.signal_number || configuredSignalNum}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '16px' }}>—</span>
              <span style={{ fontSize: '16px', fontWeight: 800 }}>
                {config?.name || 'Intersection 5 (Fisheye 4-Leg)'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '3px 9px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(234, 179, 8, 0.15)',
                  color: '#eab308',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                }}
              >
                SIMULATION MODE
              </span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 800,
                  padding: '3px 9px',
                  borderRadius: '6px',
                  backgroundColor: currentSignalState === 'GREEN' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: currentSignalState === 'GREEN' ? '#10b981' : '#ef4444',
                  border: `1px solid ${currentSignalState === 'GREEN' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                }}
              >
                {currentSignalState} — {signalStatus?.status_label || 'RUNNING'}
              </span>
            </div>
          </div>

          {/* Current Phase & Roads Receiving Green */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', fontSize: '13px' }}>
            <div>
              <span style={{ color: 'var(--text-muted)' }}>Current Phase: </span>
              <strong style={{ color: 'var(--text-primary)' }}>
                {signalStatus?.current_phase_name || activeConfigPhase?.phase_name} ({signalStatus?.current_phase_id || configuredPhaseId})
              </strong>
            </div>

            <div>
              <span style={{ color: 'var(--text-muted)' }}>Roads Receiving Green: </span>
              <strong style={{ color: '#38bdf8' }}>
                {activeRoadNames.join(', ')}
              </strong>
            </div>
          </div>

          {/* Large Countdown Display */}
          <div
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '16px 24px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {currentSignalState === 'GREEN' ? 'REMAINING GREEN TIME' : currentSignalState === 'AMBER' ? 'AMBER CLEARANCE' : 'ALL-RED CLEARANCE'}
              </div>
              <div
                style={{
                  fontSize: '48px',
                  fontWeight: 900,
                  fontFamily: 'monospace',
                  letterSpacing: '0.04em',
                  color: currentSignalState === 'GREEN' ? '#10b981' : currentSignalState === 'AMBER' ? '#f59e0b' : '#ef4444',
                  lineHeight: 1.1,
                  marginTop: '4px',
                }}
              >
                {formatCountdown(liveRemainingSec)}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
                {liveRemainingSec !== null ? `${liveRemainingSec.toFixed(1)} seconds on authoritative clock` : 'Authoritative clock syncing...'}
              </div>
            </div>

            {/* In-Panel Green Extension Quick Controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '220px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>
                EXTEND GREEN TIME (ADDITIVE)
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[5, 10, 15].map((sec) => (
                  <button
                    key={sec}
                    onClick={() => handleExtendGreen(sec)}
                    disabled={isExtendingGreen || currentSignalState !== 'GREEN'}
                    style={{
                      flex: 1,
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: isExtendingGreen || currentSignalState !== 'GREEN' ? 'not-allowed' : 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    +{sec}s
                  </button>
                ))}
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                Formula: newRemaining = currentRemaining + approvedExtension
              </div>
            </div>
          </div>

          {/* Simple Cycle Progress Bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
              <span>Phase Progress</span>
              <span>{Math.round(progressPct)}% elapsed</span>
            </div>
            <div
              style={{
                width: '100%',
                height: '8px',
                backgroundColor: 'var(--bg-elevated)',
                borderRadius: '4px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progressPct}%`,
                  height: '100%',
                  backgroundColor: currentSignalState === 'GREEN' ? '#10b981' : currentSignalState === 'AMBER' ? '#f59e0b' : '#ef4444',
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          SECTION 4: NEXT SIGNAL SUGGESTION CARD (8s Pre-transition)
         ========================================================================= */}
      {recommendation ? (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '2px solid rgba(168, 85, 247, 0.4)',
            borderRadius: '16px',
            padding: '24px',
            boxShadow: '0 8px 32px rgba(168, 85, 247, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(168, 85, 247, 0.2)',
                  color: '#c084fc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Zap size={18} />
              </div>
              <h2 style={{ fontSize: '16px', fontWeight: 800, margin: 0, letterSpacing: '-0.01em', color: '#c084fc' }}>
                NEXT SIGNAL SUGGESTION
              </h2>
              {signalStatus?.should_trigger_recommendation && (
                <span
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                    color: '#f87171',
                    fontSize: '11px',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    animation: 'pulse 2s infinite',
                  }}
                >
                  8S DECISION WINDOW
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Data Freshness:</span>
              <span
                style={{
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  color: '#10b981',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontWeight: 700,
                }}
              >
                LIVE VALIDATED
              </span>
              <span style={{ color: 'var(--text-muted)' }}>Safety:</span>
              <span
                style={{
                  backgroundColor: recommendation.constraint_validation_passed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: recommendation.constraint_validation_passed ? '#10b981' : '#ef4444',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontWeight: 700,
                }}
              >
                {recommendation.constraint_validation_passed ? 'Passed Constraints' : 'Violations Detected'}
              </span>
            </div>
          </div>

          {/* Suggestion Highlights Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '14px',
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '16px',
            }}
          >
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>RECOMMENDED PHASE</div>
              <div style={{ fontSize: '15px', fontWeight: 800, marginTop: '4px', color: 'var(--text-primary)' }}>
                Signal 2 — {recommendation.recommended_phase?.phase_name} ({recommendation.recommended_phase?.phase_id})
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>ROADS TO RECEIVE GREEN</div>
              <div style={{ fontSize: '13px', fontWeight: 700, marginTop: '4px', color: '#38bdf8' }}>
                {(recommendation.recommended_phase?.served_approaches || []).map((a) => getRoadName(a)).join(', ')}
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>SUGGESTED GREEN DURATION</div>
              <div style={{ fontSize: '16px', fontWeight: 800, marginTop: '4px', color: '#10b981' }}>
                {recommendation.recommended_phase?.proposed_green_sec} seconds
              </div>
            </div>

            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>OFFICER STATUS</div>
              <div style={{ fontSize: '13px', fontWeight: 800, marginTop: '4px', color: recommendation.status === 'APPROVED' ? '#10b981' : recommendation.status === 'REJECTED' ? '#ef4444' : '#eab308' }}>
                {recommendation.status}
              </div>
            </div>
          </div>

          {/* Traffic Reason & Evidence */}
          <div
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '10px',
              padding: '14px',
              fontSize: '13px',
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: 'var(--text-primary)' }}>Traffic Decision Rationale: </strong>
            <span style={{ color: 'var(--text-muted)' }}>
              {recommendation.recommended_phase?.reason || 'Calculated higher demand score on conflicting approaches.'}
            </span>
            {recommendation.recommended_phase?.queue_evidence && (
              <div style={{ marginTop: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
                <strong>Evidence: </strong> {recommendation.recommended_phase.queue_evidence}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
            <button
              onClick={handleApproveSuggestion}
              disabled={isApproving || recommendation.status === 'APPROVED'}
              style={{
                backgroundColor: recommendation.status === 'APPROVED' ? '#047857' : '#10b981',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 20px',
                fontSize: '13px',
                fontWeight: 800,
                cursor: isApproving || recommendation.status === 'APPROVED' ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
              }}
            >
              {isApproving ? <RefreshCw className="animate-spin" size={16} /> : <CheckCheck size={16} />}
              <span>{recommendation.status === 'APPROVED' ? 'Approved Plan Ready' : 'Approve Suggestion'}</span>
            </button>

            <button
              onClick={() => setRejectionModalOpen(true)}
              disabled={isRejecting || recommendation.status === 'REJECTED'}
              style={{
                backgroundColor: 'transparent',
                color: '#f87171',
                border: '1px solid #ef4444',
                borderRadius: '8px',
                padding: '10px 18px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: isRejecting || recommendation.status === 'REJECTED' ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <XCircle size={16} />
              <span>Reject Suggestion</span>
            </button>

            <button
              onClick={() => setShowRejectionDetails(!showRejectionDetails)}
              style={{
                backgroundColor: 'transparent',
                color: 'var(--text-muted)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {showRejectionDetails ? 'Hide Details' : 'View Phase Scores'}
            </button>
          </div>

          {/* Collapsible Details */}
          {showRejectionDetails && (
            <div style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: '8px', padding: '12px', fontSize: '12px' }}>
              <div style={{ fontWeight: 700, marginBottom: '6px' }}>All Phase Demand Scores:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {(recommendation.all_phase_scores || []).map((ps) => (
                  <div key={ps.phase_id} style={{ padding: '6px 10px', backgroundColor: 'var(--bg-surface)', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                    <strong>{ps.phase_id}:</strong> {ps.phase_name} — Score: {(ps.demand_score * 100).toFixed(1)}%
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px dashed var(--border-subtle)',
            borderRadius: '12px',
            padding: '20px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '13px',
          }}
        >
          Signal timing and AI recommendation engine standing by. Next suggestion will appear automatically 8 seconds before green ends.
        </div>
      )}

      {/* Rejection Modal */}
      {rejectionModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '14px',
              padding: '24px',
              maxWidth: '460px',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800 }}>Reject Traffic Suggestion</h3>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)' }}>
              Please specify the operational reason for rejecting this AI recommendation. Baseline fixed-time plan will remain active.
            </p>
            <textarea
              rows={3}
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g. Officer manual override due to VIP convoy or sudden incident..."
              style={{
                width: '100%',
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '10px',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setRejectionModalOpen(false)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleRejectSuggestion}
                disabled={isRejecting}
                style={{
                  padding: '8px 18px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  fontWeight: 700,
                  cursor: isRejecting ? 'not-allowed' : 'pointer',
                  fontSize: '13px',
                }}
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          SECTION 5: SIMPLE SIGNAL STAGE TIMELINE
         ========================================================================= */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '14px',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ fontSize: '13px', fontWeight: 800, letterSpacing: '0.02em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          Signal Stage Sequence
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '12px',
          }}
        >
          {/* Green Stage */}
          <div
            style={{
              padding: '14px',
              borderRadius: '8px',
              backgroundColor: currentSignalState === 'GREEN' ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-elevated)',
              border: `1px solid ${currentSignalState === 'GREEN' ? '#10b981' : 'var(--border-subtle)'}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#10b981' }}>STAGE 1: GREEN</span>
              {currentSignalState === 'GREEN' && (
                <span style={{ fontSize: '10px', fontWeight: 800, color: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.2)', padding: '2px 6px', borderRadius: '4px' }}>
                  ACTIVE
                </span>
              )}
            </div>
            <div style={{ fontSize: '13px', fontWeight: 700 }}>
              {signalStatus?.current_phase_name || activeConfigPhase?.phase_name}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Duration: {signalStatus?.duration_sec || configuredGreenSec}s
            </div>
          </div>

          {/* Amber Stage */}
          <div
            style={{
              padding: '14px',
              borderRadius: '8px',
              backgroundColor: currentSignalState === 'AMBER' ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-elevated)',
              border: `1px solid ${currentSignalState === 'AMBER' ? '#f59e0b' : 'var(--border-subtle)'}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#f59e0b' }}>STAGE 2: AMBER</span>
              {currentSignalState === 'AMBER' && (
                <span style={{ fontSize: '10px', fontWeight: 800, color: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.2)', padding: '2px 6px', borderRadius: '4px' }}>
                  TRANSITION
                </span>
              )}
            </div>
            <div style={{ fontSize: '13px', fontWeight: 700 }}>Vehicle Clearance</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Duration: {signalStatus?.amber_sec || 3.0}s
            </div>
          </div>

          {/* All-Red Stage */}
          <div
            style={{
              padding: '14px',
              borderRadius: '8px',
              backgroundColor: currentSignalState === 'RED' ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg-elevated)',
              border: `1px solid ${currentSignalState === 'RED' ? '#ef4444' : 'var(--border-subtle)'}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 800, color: '#ef4444' }}>STAGE 3: ALL-RED</span>
              {currentSignalState === 'RED' && (
                <span style={{ fontSize: '10px', fontWeight: 800, color: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.2)', padding: '2px 6px', borderRadius: '4px' }}>
                  CLEARANCE
                </span>
              )}
            </div>
            <div style={{ fontSize: '13px', fontWeight: 700 }}>Intersection Clearance</div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Duration: {signalStatus?.all_red_sec || 2.0}s
            </div>
          </div>

          {/* Next Phase Stage */}
          <div
            style={{
              padding: '14px',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 800, color: '#c084fc' }}>STAGE 4: NEXT PHASE</span>
            <div style={{ fontSize: '13px', fontWeight: 700 }}>
              {recommendation?.recommended_phase?.phase_name || 'Waiting for Approval'}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {recommendation?.status === 'APPROVED' ? 'Approved & Queued' : 'Evaluating Traffic Demand'}
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          SECTION 6: COMPACT CONFIGURED ROADS TABLE
         ========================================================================= */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '14px',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 800, margin: 0 }}>Intersection Road Approaches & Live Demand</h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              User-configured road ROIs from Process page. Every mapped approach is tracked.
            </p>
          </div>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)' }}>
            Total Approaches: {approachDemands.length}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '10px 12px', fontWeight: 700 }}>ROAD NAME</th>
                <th style={{ padding: '10px 12px', fontWeight: 700 }}>CURRENT VEHICLES</th>
                <th style={{ padding: '10px 12px', fontWeight: 700 }}>QUEUE LENGTH</th>
                <th style={{ padding: '10px 12px', fontWeight: 700 }}>ARRIVAL RATE</th>
                <th style={{ padding: '10px 12px', fontWeight: 700 }}>AVG SPEED</th>
                <th style={{ padding: '10px 12px', fontWeight: 700 }}>DEMAND STATUS</th>
                <th style={{ padding: '10px 12px', fontWeight: 700 }}>FRESHNESS</th>
              </tr>
            </thead>
            <tbody>
              {approachDemands.map((app, idx) => (
                <tr
                  key={app.approach_id || idx}
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    backgroundColor: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)',
                  }}
                >
                  <td style={{ padding: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {getRoadName(app.approach_id)}
                    <span style={{ display: 'block', fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400 }}>
                      ID: {app.road_id || app.approach_id} ({app.direction || 'Approach'})
                    </span>
                  </td>

                  <td style={{ padding: '12px', fontWeight: 700 }}>
                    {((app.moving_count || 0) + (app.stationary_count || 0)) || (app as any).current_roi_count || 0} veh
                  </td>

                  <td style={{ padding: '12px' }}>
                    {app.queue_length_veh !== undefined && app.queue_length_veh !== null
                      ? `${app.queue_length_veh} veh`
                      : 'Unavailable'}
                  </td>

                  <td style={{ padding: '12px' }}>
                    {app.arrival_rate_veh_per_min !== undefined && app.arrival_rate_veh_per_min !== null
                      ? `${app.arrival_rate_veh_per_min.toFixed(1)} veh/min`
                      : 'Unavailable'}
                  </td>

                  <td style={{ padding: '12px' }}>
                    {app.avg_speed_kmh !== undefined && app.avg_speed_kmh !== null
                      ? `${Number(app.avg_speed_kmh).toFixed(1)} km/h`
                      : 'Unavailable'}
                  </td>

                  <td style={{ padding: '12px' }}>
                    <span
                      style={{
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 700,
                        backgroundColor:
                          app.traffic_state === 'HIGH'
                            ? 'rgba(239, 68, 68, 0.15)'
                            : app.traffic_state === 'MEDIUM'
                            ? 'rgba(234, 179, 8, 0.15)'
                            : 'rgba(16, 185, 129, 0.15)',
                        color:
                          app.traffic_state === 'HIGH'
                            ? '#ef4444'
                            : app.traffic_state === 'MEDIUM'
                            ? '#eab308'
                            : '#10b981',
                      }}
                    >
                      {app.traffic_state || 'NORMAL'}
                    </span>
                  </td>

                  <td style={{ padding: '12px' }}>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        fontWeight: 700,
                        backgroundColor: 'rgba(56, 189, 248, 0.12)',
                        color: '#38bdf8',
                      }}
                    >
                      {app.data_quality || 'LIVE'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* =========================================================================
          SECTION 7: OFFICER DECISION & RECOMMENDATION HISTORY
         ========================================================================= */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '14px',
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <div>
            <h3 style={{ fontSize: '15px', fontWeight: 800, margin: 0 }}>Signal Decision History</h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
              Audit trail of officer approvals, rejections, manual adjustments, and extensions.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '10px', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search history..."
                value={historySearchQuery}
                onChange={(e) => setHistorySearchQuery(e.target.value)}
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '7px 10px 7px 30px',
                  fontSize: '12px',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
            </div>
          </div>
        </div>

        <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>TIMESTAMP</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>EVENT TYPE</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>ACTOR</th>
                <th style={{ padding: '8px 10px', fontWeight: 700 }}>DETAILS</th>
              </tr>
            </thead>
            <tbody>
              {filteredAuditLog.slice(0, 15).map((entry) => (
                <tr key={entry.entry_id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : 'N/A'}
                  </td>
                  <td style={{ padding: '10px', fontWeight: 700 }}>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        backgroundColor:
                          entry.event_type.includes('APPROVED') || entry.event_type.includes('STARTED')
                            ? 'rgba(16, 185, 129, 0.15)'
                            : entry.event_type.includes('REJECTED')
                            ? 'rgba(239, 68, 68, 0.15)'
                            : 'rgba(56, 189, 248, 0.15)',
                        color:
                          entry.event_type.includes('APPROVED') || entry.event_type.includes('STARTED')
                            ? '#10b981'
                            : entry.event_type.includes('REJECTED')
                            ? '#ef4444'
                            : '#38bdf8',
                      }}
                    >
                      {entry.event_type}
                    </span>
                  </td>
                  <td style={{ padding: '10px', color: 'var(--text-muted)' }}>{entry.actor}</td>
                  <td style={{ padding: '10px', color: 'var(--text-muted)' }}>
                    {JSON.stringify(entry.details).replace(/[{}"]/g, '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* =========================================================================
          SECTION 8: COLLAPSIBLE ADVANCED TRAFFIC ANALYTICS
         ========================================================================= */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '14px',
          overflow: 'hidden',
        }}
      >
        <button
          onClick={() => setShowAdvancedAnalytics(!showAdvancedAnalytics)}
          style={{
            width: '100%',
            backgroundColor: 'transparent',
            border: 'none',
            padding: '18px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer',
            color: 'var(--text-primary)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <SlidersHorizontal size={18} style={{ color: '#38bdf8' }} />
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: '15px', fontWeight: 800 }}>Advanced Traffic Analytics</div>
              <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                What-If microsimulation, delay comparison charts, and raw mathematical models
              </div>
            </div>
          </div>
          {showAdvancedAnalytics ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </button>

        {showAdvancedAnalytics && (
          <div style={{ padding: '0 24px 24px 24px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* What-If Simulator Header */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '16px' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 800 }}>What-If Scenario Simulation</h4>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Test proposed signal plans against simulated traffic scenarios (Incident, Peak Demand, etc.)
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <select
                  value={selectedScenario}
                  onChange={(e) => setSelectedScenario(e.target.value as any)}
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    fontSize: '12px',
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value="NORMAL_TRAFFIC">Normal Traffic</option>
                  <option value="HEAVY_TRAFFIC">Heavy Rush Hour</option>
                  <option value="INCIDENT">Incident / Blockage</option>
                  <option value="EMERGENCY_VEHICLE">Emergency Corridor</option>
                </select>

                <button
                  onClick={() => handleRunSimulation()}
                  disabled={isSimulating}
                  style={{
                    backgroundColor: '#0284c7',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 14px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: isSimulating ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSimulating ? 'Simulating...' : 'Run Simulation'}
                </button>
              </div>
            </div>

            {/* Simulation Comparison Cards */}
            {planComparison && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '12px',
                }}
              >
                <div style={{ backgroundColor: 'var(--bg-elevated)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>AVG DELAY REDUCTION</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#10b981', marginTop: '4px' }}>
                    {planComparison.delay_improvement_pct && planComparison.delay_improvement_pct > 0
                      ? `-${planComparison.delay_improvement_pct.toFixed(1)}%`
                      : '0.0%'}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Fixed: {(planComparison.fixed_plan.avg_delay_sec ?? 0).toFixed(1)}s → Adaptive: {(planComparison.adaptive_plan.avg_delay_sec ?? 0).toFixed(1)}s
                  </div>
                </div>

                <div style={{ backgroundColor: 'var(--bg-elevated)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>THROUGHPUT GAIN</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#38bdf8', marginTop: '4px' }}>
                    +{((planComparison as any).throughput_improvement_pct ?? 0).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {(planComparison.adaptive_plan.throughput_veh_per_hour ?? 0).toFixed(0)} veh/hr served
                  </div>
                </div>

                <div style={{ backgroundColor: 'var(--bg-elevated)', padding: '14px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 700 }}>QUEUE REDUCTION</div>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: '#a855f7', marginTop: '4px' }}>
                    {((planComparison as any).queue_improvement_pct ?? 0).toFixed(1)}%
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Max queue: {planComparison.adaptive_plan.max_queue_veh ?? 0} vehicles
                  </div>
                </div>
              </div>
            )}

            {simulationResult && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                Note: {simulationResult.methodology_note}
              </div>
            )}
            {manualSelection && (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Active saved configuration: Phase {manualSelection.selected_phase_id || (manualSelection as any).phase_id || 'P1'} ({manualSelection.status || 'Active'})
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
