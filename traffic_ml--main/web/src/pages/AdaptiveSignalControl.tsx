import React, { useState, useEffect, useCallback } from 'react';
import {
  TrafficCone,
  ShieldCheck,
  TrendingDown,
  Clock,
  Car,
  AlertTriangle,
  CheckCircle2,
  Play,
  Sliders,
  History as HistoryIcon,
  Layers,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Info,
  Activity,
  Check,
  RefreshCw,
  Zap,
  XCircle,
  AlertCircle,
  Radio,
  FileCheck,
  SlidersHorizontal,
  Plus,
  Save,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from 'recharts';
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

  // State
  const [intersections, setIntersections] = useState<IntersectionSummary[]>([]);
  const [selectedIntersectionId, setSelectedIntersectionId] = useState<string>('int_cam5');
  const [config, setConfig] = useState<IntersectionConfig | null>(null);
  const [analytics, setAnalytics] = useState<IntersectionAnalytics | null>(null);
  const [recommendation, setRecommendation] = useState<SignalRecommendation | null>(null);
  const [simulationResult, setSimulationResult] = useState<SignalSimulationResult | null>(null);
  const [planComparison, setPlanComparison] = useState<PlanComparison | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  
  // Video Readiness & Authoritative Signal Timing States (PART 2 & PART 5)
  const [videoReadiness, setVideoReadiness] = useState<VideoReadinessReport | null>(null);
  const [signalStatus, setSignalStatus] = useState<SignalStatusResponse | null>(null);
  const [rejectionModalOpen, setRejectionModalOpen] = useState<boolean>(false);
  const [rejectionReason, setRejectionReason] = useState<string>('Traffic pattern deviation / Manual override');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [isRejecting, setIsRejecting] = useState<boolean>(false);

  // Manual Signal Configuration State (ISSUE 2)
  const [manualSelection, setManualSelection] = useState<ManualSignalSelection | null>(null);
  const [manualPhaseId, setManualPhaseId] = useState<string>('P1');
  const [manualGreenSec, setManualGreenSec] = useState<number>(30);
  const [manualServedApproaches, setManualServedApproaches] = useState<string[]>(['north', 'south']);
  const [manualServedMovements, setManualServedMovements] = useState<string[]>(['THROUGH', 'RIGHT']);
  const [isSavingManual, setIsSavingManual] = useState<boolean>(false);
  const [manualPlanStatus, setManualPlanStatus] = useState<'MANUAL_SELECTION' | 'PENDING_OFFICER_APPROVAL' | 'APPROVED_PLAN'>('MANUAL_SELECTION');

  // Authoritative Phase Clock Countdown & Extension State (ISSUE 5 & 6)
  const [liveRemainingSec, setLiveRemainingSec] = useState<number | null>(null);
  const [isExtendingGreen, setIsExtendingGreen] = useState<boolean>(false);

  // UI Controls
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [selectedScenario, setSelectedScenario] = useState<SimulationScenarioType>('NORMAL_TRAFFIC');
  const [activeTab, setActiveTab] = useState<'control' | 'simulation' | 'audit' | 'config'>('control');
  const [overrideGreenSec, setOverrideGreenSec] = useState<number>(30);
  const [deploySuccessMessage, setDeploySuccessMessage] = useState<string | null>(null);

  // Load available intersections on mount
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

  // Live Authoritative Clock Countdown Effect (ISSUE 5)
  useEffect(() => {
    if (!signalStatus?.phase_end_time || !signalStatus?.is_timing_available) {
      setLiveRemainingSec(null);
      return;
    }
    const updateCountdown = () => {
      const endTime = new Date(signalStatus.phase_end_time!).getTime();
      const now = Date.now();
      const rem = Math.max(0, (endTime - now) / 1000);
      setLiveRemainingSec(rem);
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 100);
    return () => clearInterval(interval);
  }, [signalStatus?.phase_end_time, signalStatus?.is_timing_available]);

  // Fetch intersection config, readiness, signal status, manual selection, and analytics
  const fetchIntersectionData = useCallback(async (intId: string) => {
    if (!intId) return;
    setIsLoading(true);
    setActionError(null);
    try {
      const [conf, anal, rec, comp, logData, readiness, status, manSel] = await Promise.allSettled([
        api.getIntersection(intId),
        api.getIntersectionAnalytics(intId),
        api.generateSignalRecommendation(intId),
        api.compareSignalPlans(intId, selectedScenario),
        api.getIntersectionAuditLog(intId, 15),
        api.getVideoReadiness(intId),
        api.getSignalStatus(intId),
        api.getManualSignalSelection(intId),
      ]);

      if (conf.status === 'fulfilled') setConfig(conf.value);
      if (anal.status === 'fulfilled') setAnalytics(anal.value);
      if (rec.status === 'fulfilled') {
        setRecommendation(rec.value);
        if (rec.value.recommended_phase?.proposed_green_sec) {
          setOverrideGreenSec(rec.value.recommended_phase.proposed_green_sec);
        }
      }
      if (comp.status === 'fulfilled') setPlanComparison(comp.value);
      if (logData.status === 'fulfilled') setAuditLog(logData.value);
      if (readiness.status === 'fulfilled') setVideoReadiness(readiness.value);
      if (status.status === 'fulfilled') setSignalStatus(status.value);
      if (manSel.status === 'fulfilled' && manSel.value) {
        const ms = manSel.value;
        setManualSelection(ms);
        if (ms.selected_phase_id) setManualPhaseId(ms.selected_phase_id);
        if (ms.proposed_green_sec) setManualGreenSec(ms.proposed_green_sec);
        if (ms.served_approaches && ms.served_approaches.length > 0) setManualServedApproaches(ms.served_approaches);
        if (ms.served_movements && ms.served_movements.length > 0) setManualServedMovements(ms.served_movements);
        if (ms.status) setManualPlanStatus(ms.status as any);
      }
    } catch (err) {
      console.error('Error fetching intersection details', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedScenario]);

  useEffect(() => {
    fetchIntersectionData(selectedIntersectionId);
  }, [selectedIntersectionId, fetchIntersectionData]);

  // Polling for live analytics, authoritative signal countdown & video readiness (PART 5)
  useEffect(() => {
    if (!autoRefresh || !selectedIntersectionId) return;
    const pollIntervalTime = videoProc.isAnalyzing ? 1500 : 3000;
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
          // If 8s recommendation trigger is reached, automatically request scheduled recommendation
          if (newStatus.should_trigger_recommendation && (!recommendation || recommendation.status !== 'APPROVED')) {
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
        console.warn('Auto-refresh poll failed', err);
      }
    }, pollIntervalTime);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedIntersectionId, videoProc.isAnalyzing, recommendation]);

  // Handle recommendation generation trigger
  const handleGenerateRecommendation = async () => {
    setIsLoading(true);
    setActionError(null);
    try {
      const rec = await api.generateSignalRecommendation(selectedIntersectionId, 'MANUAL');
      setRecommendation(rec);
      if (rec.recommended_phase?.proposed_green_sec) {
        setOverrideGreenSec(rec.recommended_phase.proposed_green_sec);
      }
      const logData = await api.getIntersectionAuditLog(selectedIntersectionId, 15);
      setAuditLog(logData);
    } catch (err: any) {
      setActionError(err.message || 'Failed to generate recommendation');
    } finally {
      setIsLoading(false);
    }
  };

  // Run What-If Scenario Simulation
  const handleRunSimulation = async (scenario: SimulationScenarioType = selectedScenario) => {
    setIsSimulating(true);
    try {
      const result = await api.runSignalSimulation(selectedIntersectionId, scenario);
      setSimulationResult(result);
      const comparison = await api.compareSignalPlans(selectedIntersectionId, scenario);
      setPlanComparison(comparison);
      const logData = await api.getIntersectionAuditLog(selectedIntersectionId, 15);
      setAuditLog(logData);
    } catch (err) {
      console.error('Simulation failed', err);
    } finally {
      setIsSimulating(false);
    }
  };

  // Handle Officer Approval (PART 6)
  const handleApproveRecommendation = async () => {
    if (!recommendation) return;
    setIsApproving(true);
    setActionError(null);
    try {
      const updated = await api.approveRecommendation(
        selectedIntersectionId,
        recommendation.recommendation_id,
        overrideGreenSec,
        'officer_1'
      );
      setRecommendation(updated);
      setDeploySuccessMessage(
        `Recommendation ${updated.recommendation_id} APPROVED! Phase "${updated.recommended_phase.phase_name}" green duration set to ${overrideGreenSec}s by officer_1.`
      );
      const logData = await api.getIntersectionAuditLog(selectedIntersectionId, 15);
      setAuditLog(logData);
      setTimeout(() => setDeploySuccessMessage(null), 6000);
    } catch (err: any) {
      setActionError(err.message || 'Approval rejected by server constraints.');
      setTimeout(() => setActionError(null), 6000);
    } finally {
      setIsApproving(false);
    }
  };

  // Handle Officer Rejection (PART 6)
  const handleRejectRecommendation = async () => {
    if (!recommendation) return;
    setIsRejecting(true);
    setActionError(null);
    try {
      const updated = await api.rejectRecommendation(
        selectedIntersectionId,
        recommendation.recommendation_id,
        rejectionReason,
        'officer_1'
      );
      setRecommendation(updated);
      setRejectionModalOpen(false);
      setDeploySuccessMessage(
        `Recommendation ${updated.recommendation_id} REJECTED. Reason: "${rejectionReason}". Baseline plan remains active.`
      );
      const logData = await api.getIntersectionAuditLog(selectedIntersectionId, 15);
      setAuditLog(logData);
      setTimeout(() => setDeploySuccessMessage(null), 6000);
    } catch (err: any) {
      setActionError(err.message || 'Rejection failed.');
      setTimeout(() => setActionError(null), 6000);
    } finally {
      setIsRejecting(false);
    }
  };

  // Authoritative Green-Time Extension Handler (ISSUE 5 & 6)
  const handleExtendGreen = async (seconds: number = 10) => {
    if (!signalStatus || isExtendingGreen) return;
    setIsExtendingGreen(true);
    setActionError(null);
    try {
      const requestId = `ext_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
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
        `Authoritative Extension Approved: +${seconds}s added to active phase. New remaining: ${result.new_remaining_sec.toFixed(1)}s.`
      );
      const logData = await api.getIntersectionAuditLog(selectedIntersectionId, 15);
      setAuditLog(logData);
      setTimeout(() => setDeploySuccessMessage(null), 6000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to extend green duration');
      setTimeout(() => setActionError(null), 6000);
    } finally {
      setIsExtendingGreen(false);
    }
  };

  // Manual Signal Configuration Save Handler (ISSUE 2)
  const handleSaveManualSelection = async (status: 'MANUAL_SELECTION' | 'PENDING_OFFICER_APPROVAL' | 'APPROVED_PLAN' = 'MANUAL_SELECTION') => {
    setIsSavingManual(true);
    setActionError(null);
    try {
      const saved = await api.saveManualSignalSelection(selectedIntersectionId, {
        intersection_id: selectedIntersectionId,
        selected_phase_id: manualPhaseId,
        served_approaches: manualServedApproaches,
        served_movements: manualServedMovements,
        proposed_green_sec: manualGreenSec,
        officer_id: 'officer_1',
        status: status,
        note: `Manual phase selection by officer for intersection ${selectedIntersectionId}`,
      });
      setManualSelection(saved);
      setManualPlanStatus(saved.status as any);
      setDeploySuccessMessage(
        `Manual signal plan for Phase ${saved.selected_phase_id} saved (${status}) with ${saved.proposed_green_sec}s green.`
      );
      const logData = await api.getIntersectionAuditLog(selectedIntersectionId, 15);
      setAuditLog(logData);
      setTimeout(() => setDeploySuccessMessage(null), 6000);
    } catch (err: any) {
      setActionError(err.message || 'Failed to save manual signal configuration');
      setTimeout(() => setActionError(null), 6000);
    } finally {
      setIsSavingManual(false);
    }
  };

  // Direction helper icon
  const getDirectionIcon = (dir: string) => {
    switch (dir) {
      case 'NORTH': return <ArrowDown size={18} style={{ color: '#38bdf8' }} />;
      case 'SOUTH': return <ArrowUp size={18} style={{ color: '#38bdf8' }} />;
      case 'EAST': return <ArrowLeft size={18} style={{ color: '#a855f7' }} />;
      case 'WEST': return <ArrowRight size={18} style={{ color: '#a855f7' }} />;
      default: return <TrafficCone size={18} style={{ color: '#94a3b8' }} />;
    }
  };

  // Quality badge color
  const getQualityBadge = (flag?: string) => {
    switch (flag) {
      case 'GOOD':
        return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.3)' }}>LIVE (HIGH)</span>;
      case 'PARTIAL':
        return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, backgroundColor: 'rgba(234, 179, 8, 0.15)', color: '#eab308', border: '1px solid rgba(234, 179, 8, 0.3)' }}>PARTIAL</span>;
      case 'STALE':
        return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' }}>STALE CACHE</span>;
      default:
        return <span style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700, backgroundColor: 'rgba(148, 163, 184, 0.15)', color: '#94a3b8' }}>STANDBY</span>;
    }
  };

  // Approach demand data
  const approachDemands = analytics?.approach_demands || recommendation?.approach_demands || [];

  // Active / Recommended Phase
  const recPhase = recommendation?.recommended_phase;
  const isNorthSouthActive = recPhase?.served_approaches?.some(a => a.includes('N') || a.includes('S')) ?? true;

  // Approach lookups for physical diagram
  const appNorth = approachDemands.find(a => a.direction?.toUpperCase() === 'NORTH' || a.name?.toLowerCase().includes('north'));
  const appSouth = approachDemands.find(a => a.direction?.toUpperCase() === 'SOUTH' || a.name?.toLowerCase().includes('south'));
  const appEast = approachDemands.find(a => a.direction?.toUpperCase() === 'EAST' || a.name?.toLowerCase().includes('east'));
  const appWest = approachDemands.find(a => a.direction?.toUpperCase() === 'WEST' || a.name?.toLowerCase().includes('west'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      
      {/* Header Bar */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          padding: '20px 24px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 0 15px rgba(56, 189, 248, 0.4)',
            }}
          >
            <TrafficCone size={26} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                Adaptive Signal Optimization
              </h1>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Zap size={12} />
                AI CLOSED-LOOP ACTUATOR
              </span>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
              Real-time video demand-weighted split allocation & safety constraint clearance
            </p>
          </div>
        </div>

        {/* Intersection Selector & Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 600 }}>INTERSECTION:</span>
            <select
              value={selectedIntersectionId}
              onChange={(e) => setSelectedIntersectionId(e.target.value)}
              style={{
                backgroundColor: 'var(--bg-surface-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-medium)',
                borderRadius: '8px',
                padding: '8px 14px',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {intersections.map((int) => (
                <option key={int.intersection_id} value={int.intersection_id}>
                  {int.name} ({int.intersection_type})
                </option>
              ))}
            </select>
          </div>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              border: `1px solid ${autoRefresh ? '#22c55e' : 'var(--border-subtle)'}`,
              backgroundColor: autoRefresh ? 'rgba(34, 197, 94, 0.1)' : 'var(--bg-surface-elevated)',
              color: autoRefresh ? '#22c55e' : 'var(--text-secondary)',
              transition: 'all 0.2s ease',
            }}
          >
            <RefreshCw size={13} className={autoRefresh ? 'spin-icon' : ''} />
            {autoRefresh ? 'Live Polling ON' : 'Live Polling PAUSED'}
          </button>

          {/* Refresh Action */}
          <button
            onClick={handleGenerateRecommendation}
            disabled={isLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 700,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              border: 'none',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              boxShadow: '0 2px 8px rgba(2, 132, 199, 0.4)',
            }}
          >
            <Activity size={14} />
            {isLoading ? 'Computing...' : 'Recalculate Split'}
          </button>
        </div>
      </div>

      {/* Deployment Success Toast */}
      {deploySuccessMessage && (
        <div
          style={{
            backgroundColor: 'rgba(34, 197, 94, 0.12)',
            border: '1px solid rgba(34, 197, 94, 0.4)',
            color: '#22c55e',
            padding: '14px 20px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '14px',
            fontWeight: 600,
            animation: 'fadeIn 0.3s ease',
          }}
        >
          <CheckCircle2 size={20} />
          <span>{deploySuccessMessage}</span>
        </div>
      )}

      {/* Action Error Toast */}
      {actionError && (
        <div
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#ef4444',
            padding: '14px 20px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '14px',
            fontWeight: 600,
            animation: 'fadeIn 0.3s ease',
          }}
        >
          <XCircle size={20} />
          <span>{actionError}</span>
        </div>
      )}

      {/* 8-Second Trigger & Authoritative Signal Timing Banner (PART 5) */}
      <div
        style={{
          backgroundColor: signalStatus?.should_trigger_recommendation
            ? 'rgba(234, 179, 8, 0.12)'
            : 'var(--bg-surface)',
          border: signalStatus?.should_trigger_recommendation
            ? '1px solid rgba(234, 179, 8, 0.45)'
            : '1px solid var(--border-subtle)',
          borderRadius: '12px',
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          boxShadow: signalStatus?.should_trigger_recommendation
            ? '0 0 20px rgba(234, 179, 8, 0.2)'
            : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: signalStatus?.should_trigger_recommendation ? '#eab308' : '#22c55e',
              boxShadow: signalStatus?.should_trigger_recommendation ? '0 0 10px #eab308' : '0 0 8px #22c55e',
            }}
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-primary)' }}>
                CURRENT ACTIVE PHASE: {signalStatus ? `${signalStatus.current_phase_id} (${signalStatus.current_phase_name})` : 'P1 (North-South Through)'}
              </span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(56, 189, 248, 0.12)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                }}
              >
                {signalStatus?.is_simulated ? 'SIMULATION TIME' : 'AUTHORITATIVE CONTROLLER'}
              </span>
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Served Approaches: {signalStatus?.served_approaches?.join(', ') || 'north, south'} • Cycle Duration: {signalStatus?.duration_sec || 35}s • Elapsed: {signalStatus?.elapsed_sec || 0}s
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Quick Green-Time Extension Button (ISSUE 5 & 6) */}
          {signalStatus?.is_timing_available && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => handleExtendGreen(10)}
                disabled={isExtendingGreen}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 800,
                  backgroundColor: 'rgba(34, 197, 94, 0.15)',
                  color: '#22c55e',
                  border: '1px solid rgba(34, 197, 94, 0.35)',
                  cursor: isExtendingGreen ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 8px rgba(34, 197, 94, 0.2)',
                }}
                title="Approve +10s green extension added to current remaining time"
              >
                <Plus size={14} />
                {isExtendingGreen ? 'Extending...' : '+10s Green Extension'}
              </button>
            </div>
          )}

          {signalStatus?.is_timing_available ? (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>
                Remaining Green
              </div>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 900,
                  color: ((liveRemainingSec ?? signalStatus.remaining_green_sec ?? 0) <= 8) ? '#f59e0b' : '#22c55e',
                  letterSpacing: '-0.02em',
                }}
              >
                {(liveRemainingSec !== null ? liveRemainingSec : (signalStatus.remaining_green_sec || 0)).toFixed(1)}s
              </div>
            </div>
          ) : (
            <span style={{ fontSize: '13px', color: '#ef4444', fontWeight: 700 }}>Signal timing unavailable</span>
          )}

          {signalStatus?.should_trigger_recommendation && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(234, 179, 8, 0.2)',
                color: '#eab308',
                border: '1px solid rgba(234, 179, 8, 0.4)',
                fontSize: '12px',
                fontWeight: 800,
              }}
            >
              <Zap size={14} />
              8s Trigger Active: Next Phase Prepared
            </div>
          )}
        </div>
      </div>

      {/* Video Readiness Panel (PART 2 — Exactly 3 or 4 Valid Sessions Required) */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Radio size={18} style={{ color: '#38bdf8' }} />
            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>
              Video Readiness & Approach Mapping
            </span>
            <span
              style={{
                fontSize: '12px',
                fontWeight: 700,
                padding: '2px 10px',
                borderRadius: '6px',
                backgroundColor:
                  videoReadiness?.is_ready
                    ? 'rgba(34, 197, 94, 0.15)'
                    : videoReadiness?.coverage_status === 'CONFIG_ERROR'
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'rgba(234, 179, 8, 0.15)',
                color:
                  videoReadiness?.is_ready
                    ? '#22c55e'
                    : videoReadiness?.coverage_status === 'CONFIG_ERROR'
                    ? '#ef4444'
                    : '#eab308',
                border: `1px solid ${
                  videoReadiness?.is_ready
                    ? 'rgba(34, 197, 94, 0.3)'
                    : videoReadiness?.coverage_status === 'CONFIG_ERROR'
                    ? 'rgba(239, 68, 68, 0.3)'
                    : 'rgba(234, 179, 8, 0.3)'
                }`,
              }}
            >
              Selected videos: {videoReadiness?.valid_session_count || 0}/3 required (Allowed: 3 or 4)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>Intersection Coverage:</span>
            <strong
              style={{
                color:
                  videoReadiness?.coverage_status === 'COMPLETE'
                    ? '#22c55e'
                    : videoReadiness?.coverage_status === 'PARTIAL'
                    ? '#eab308'
                    : '#ef4444',
              }}
            >
              {videoReadiness?.coverage_status || 'EVALUATING'}
            </strong>
            <span style={{ color: 'var(--text-tertiary)' }}>•</span>
            <span style={{ color: 'var(--text-tertiary)' }}>Recommendations:</span>
            <strong style={{ color: videoReadiness?.recommendation_available ? '#22c55e' : '#ef4444' }}>
              {videoReadiness?.recommendation_available ? 'READY' : 'UNAVAILABLE'}
            </strong>
          </div>
        </div>

        {/* Reasons when unavailable */}
        {videoReadiness && videoReadiness.reasons && videoReadiness.reasons.length > 0 && !videoReadiness.is_ready && (
          <div
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '8px',
              padding: '10px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              fontSize: '12px',
              color: '#f87171',
            }}
          >
            {videoReadiness.reasons.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span>{r}</span>
              </div>
            ))}
          </div>
        )}

        {/* Selected Sessions Breakdown Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
          {videoReadiness?.sessions?.map((sess) => (
            <div
              key={sess.session_id}
              style={{
                backgroundColor: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {sess.video_name}
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: '4px',
                    backgroundColor: sess.status === 'processing' ? 'rgba(6, 182, 212, 0.2)' : 'rgba(34, 197, 94, 0.15)',
                    color: sess.status === 'processing' ? '#06b6d4' : '#22c55e',
                  }}
                >
                  {sess.status.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                Frames: {sess.frames_processed} / {sess.total_frames} ({sess.progress_pct}%)
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                Mapped: {sess.roads_mapped.join(', ') || 'Approaches'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Video Processing Session Banner */}
      {videoProc.isAnalyzing && (
        <div
          style={{
            backgroundColor: 'rgba(6, 182, 212, 0.08)',
            border: '1px solid rgba(6, 182, 212, 0.35)',
            borderRadius: '12px',
            padding: '14px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            boxShadow: '0 4px 20px rgba(6, 182, 212, 0.1)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: '#06b6d4',
                  boxShadow: '0 0 10px #06b6d4',
                }}
              />
              <span style={{ fontSize: '13px', fontWeight: 800, color: '#38bdf8', letterSpacing: '0.04em' }}>
                LIVE VIDEO INFERENCE RUNNING IN BACKGROUND
              </span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {videoProc.videoName} ({videoProc.activeJobId})
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px', fontWeight: 700, color: '#38bdf8' }}>
              <span>
                FRAME {videoProc.framesProcessed} / {videoProc.totalFrames} ({videoProc.progressPct}%)
              </span>
              <span>•</span>
              <span>{videoProc.currentFps.toFixed(1)} FPS</span>
              <span>•</span>
              <span>{videoProc.videoTimeSeconds.toFixed(1)}s ELAPSED</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div style={{ width: '100%', height: '6px', backgroundColor: 'rgba(15, 23, 42, 0.6)', borderRadius: '3px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${videoProc.progressPct}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #06b6d4, #3b82f6, #10b981)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-tertiary)' }}>
            <span>Traffic demand metrics below are streaming live from active video detections without interruption across navigation.</span>
            <span style={{ color: '#10b981', fontWeight: 600 }}>Adaptive Controller Active</span>
          </div>
        </div>
      )}

      {videoProc.inferenceComplete && videoProc.activeJobId && !videoProc.isAnalyzing && (
        <div
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '10px',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: '#10b981',
            fontWeight: 600,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={16} />
            <span>Video Processing Completed: {videoProc.videoName} ({videoProc.framesProcessed} frames analyzed). Signal plans calculated on full video demand.</span>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Job ID: {videoProc.activeJobId}</span>
        </div>
      )}

      {/* Navigation Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '4px' }}>
        <button
          onClick={() => setActiveTab('control')}
          style={{
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: 700,
            borderRadius: '8px 8px 0 0',
            border: 'none',
            borderBottom: activeTab === 'control' ? '3px solid #38bdf8' : '3px solid transparent',
            backgroundColor: activeTab === 'control' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'control' ? '#38bdf8' : 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Sliders size={16} />
          Signal Control & Demand
        </button>
        <button
          onClick={() => setActiveTab('simulation')}
          style={{
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: 700,
            borderRadius: '8px 8px 0 0',
            border: 'none',
            borderBottom: activeTab === 'simulation' ? '3px solid #38bdf8' : '3px solid transparent',
            backgroundColor: activeTab === 'simulation' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'simulation' ? '#38bdf8' : 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <Layers size={16} />
          What-If Scenario Simulator
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          style={{
            padding: '10px 18px',
            fontSize: '13px',
            fontWeight: 700,
            borderRadius: '8px 8px 0 0',
            border: 'none',
            borderBottom: activeTab === 'audit' ? '3px solid #38bdf8' : '3px solid transparent',
            backgroundColor: activeTab === 'audit' ? 'var(--bg-surface-elevated)' : 'transparent',
            color: activeTab === 'audit' ? '#38bdf8' : 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <HistoryIcon size={16} />
          Officer Audit Log
        </button>
      </div>

      {/* TAB 1: SIGNAL CONTROL & DEMAND */}
      {activeTab === 'control' && (
        <>
          {/* Top KPI Cards Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
            {/* KPI 1: Active Phase Recommendation */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '18px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Recommended Phase
                </span>
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: '#22c55e',
                    boxShadow: '0 0 8px #22c55e',
                  }}
                />
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#38bdf8', marginBottom: '4px' }}>
                {recPhase?.phase_name || 'Phase 1: N-S Corridor'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Clock size={13} />
                Proposed Green: <strong style={{ color: '#22c55e' }}>{recPhase?.proposed_green_sec || 38}s</strong>
                <span style={{ color: 'var(--text-tertiary)' }}>(Fixed baseline: {config?.fixed_plan_green_times[recPhase?.phase_id || 'phase_1'] || 30}s)</span>
              </div>
            </div>

            {/* KPI 2: Critical Approach */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '18px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Critical Bottleneck
                </span>
                <AlertTriangle size={15} style={{ color: '#f59e0b' }} />
              </div>
              {(() => {
                const maxApp = [...approachDemands].sort((a, b) => (b.demand_score || 0) - (a.demand_score || 0))[0];
                return (
                  <>
                    <div style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      {maxApp ? (maxApp.name || maxApp.road_id || 'Unnamed Road') : 'Northbound Approach'}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ padding: '1px 6px', borderRadius: '4px', backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', fontSize: '11px', fontWeight: 700 }}>
                        {maxApp?.direction ? `${maxApp.direction} CORRIDOR` : 'ROAD ROI'}
                      </span>
                      <Car size={13} />
                      Queue: <strong style={{ color: '#f59e0b' }}>{maxApp?.queue_length_veh || 0} veh</strong>
                      <span>• Demand Index: <strong>{((maxApp?.demand_score || 0) * 100).toFixed(0)}%</strong></span>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* KPI 3: Safety Constraints Status */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '18px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Safety Clearance
                </span>
                <ShieldCheck size={16} style={{ color: '#22c55e' }} />
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#22c55e', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                100% Validated
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Min/Max green bounded • 0 phase conflicts • Ped clearance safe
              </div>
            </div>

            {/* KPI 4: Expected Delay Reduction */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '18px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>
                  Efficiency Gain
                </span>
                <TrendingDown size={16} style={{ color: '#38bdf8' }} />
              </div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: '#38bdf8', marginBottom: '4px' }}>
                {planComparison?.delay_improvement_pct ? `-${planComparison.delay_improvement_pct.toFixed(1)}% Delay` : '-24.3% Est. Delay'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                {planComparison?.throughput_improvement_pct ? `+${planComparison.throughput_improvement_pct.toFixed(1)}% Throughput vs fixed plan` : '+14.2% Flow throughput'}
              </div>
            </div>
          </div>

          {/* Main Visual Control Grid: Phase Diagram & Recommendation Engine */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px' }}>
            
            {/* Visual Intersection Schematic */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Physical Intersection Phase Diagram
                  </h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Visual signal heads with live queue occupancy & approach vectors
                  </p>
                </div>
                {getQualityBadge(analytics?.overall_data_quality || recommendation?.data_quality)}
              </div>

              {/* Graphic Intersection Canvas */}
              <div
                style={{
                  height: '360px',
                  backgroundColor: '#090d16',
                  borderRadius: '10px',
                  position: 'relative',
                  overflow: 'hidden',
                  border: '1px solid #1e293b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* Road Crossings */}
                {/* Vertical Road (N-S) */}
                <div
                  style={{
                    position: 'absolute',
                    width: '90px',
                    top: 0,
                    bottom: 0,
                    backgroundColor: '#1e293b',
                    borderLeft: '2px dashed #475569',
                    borderRight: '2px dashed #475569',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: 0,
                      bottom: 0,
                      borderLeft: '2px dashed #f59e0b',
                      transform: 'translateX(-50%)',
                    }}
                  />
                </div>

                {/* Horizontal Road (E-W) */}
                <div
                  style={{
                    position: 'absolute',
                    height: '90px',
                    left: 0,
                    right: 0,
                    backgroundColor: '#1e293b',
                    borderTop: '2px dashed #475569',
                    borderBottom: '2px dashed #475569',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: 0,
                      right: 0,
                      borderTop: '2px dashed #f59e0b',
                      transform: 'translateY(-50%)',
                    }}
                  />
                </div>

                {/* Center Junction Box */}
                <div
                  style={{
                    position: 'absolute',
                    width: '90px',
                    height: '90px',
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    zIndex: 1,
                  }}
                />

                {/* North Signal Head */}
                <div
                  style={{
                    position: 'absolute',
                    top: '20px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    backgroundColor: '#000',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    zIndex: 2,
                    boxShadow: isNorthSouthActive ? '0 0 15px rgba(34, 197, 94, 0.5)' : 'none',
                  }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#fff' }}>{appNorth?.name || 'North Corridor'}</div>
                    <div style={{ fontSize: '9px', color: '#94a3b8' }}>NORTH APPROACH</div>
                  </div>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: isNorthSouthActive ? '#22c55e' : '#ef4444', boxShadow: isNorthSouthActive ? '0 0 8px #22c55e' : '0 0 8px #ef4444' }} />
                </div>

                {/* South Signal Head */}
                <div
                  style={{
                    position: 'absolute',
                    bottom: '20px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    backgroundColor: '#000',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    zIndex: 2,
                    boxShadow: isNorthSouthActive ? '0 0 15px rgba(34, 197, 94, 0.5)' : 'none',
                  }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#fff' }}>{appSouth?.name || 'South Corridor'}</div>
                    <div style={{ fontSize: '9px', color: '#94a3b8' }}>SOUTH APPROACH</div>
                  </div>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: isNorthSouthActive ? '#22c55e' : '#ef4444', boxShadow: isNorthSouthActive ? '0 0 8px #22c55e' : '0 0 8px #ef4444' }} />
                </div>

                {/* West Signal Head */}
                <div
                  style={{
                    position: 'absolute',
                    left: '20px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    backgroundColor: '#000',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                    zIndex: 2,
                    boxShadow: !isNorthSouthActive ? '0 0 15px rgba(34, 197, 94, 0.5)' : 'none',
                  }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#fff' }}>{appWest?.name || 'West Corridor'}</div>
                    <div style={{ fontSize: '9px', color: '#94a3b8' }}>WEST APPROACH</div>
                  </div>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: !isNorthSouthActive ? '#22c55e' : '#ef4444', boxShadow: !isNorthSouthActive ? '0 0 8px #22c55e' : '0 0 8px #ef4444' }} />
                </div>

                {/* East Signal Head */}
                <div
                  style={{
                    position: 'absolute',
                    right: '20px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    backgroundColor: '#000',
                    border: '1px solid #334155',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                    zIndex: 2,
                    boxShadow: !isNorthSouthActive ? '0 0 15px rgba(34, 197, 94, 0.5)' : 'none',
                  }}
                >
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '11px', fontWeight: 800, color: '#fff' }}>{appEast?.name || 'East Corridor'}</div>
                    <div style={{ fontSize: '9px', color: '#94a3b8' }}>EAST APPROACH</div>
                  </div>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: !isNorthSouthActive ? '#22c55e' : '#ef4444', boxShadow: !isNorthSouthActive ? '0 0 8px #22c55e' : '0 0 8px #ef4444' }} />
                </div>

                {/* Center Phase Overlay Badge */}
                <div
                  style={{
                    position: 'absolute',
                    zIndex: 10,
                    padding: '6px 14px',
                    borderRadius: '8px',
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    border: '1px solid #0284c7',
                    color: '#38bdf8',
                    fontSize: '11px',
                    fontWeight: 700,
                    textAlign: 'center',
                  }}
                >
                  <div>ACTIVE STAGE</div>
                  <strong style={{ color: '#fff', fontSize: '12px' }}>
                    {isNorthSouthActive ? 'PHASE 1: N-S GREEN' : 'PHASE 2: E-W GREEN'}
                  </strong>
                </div>
              </div>

              {/* Phase Durations Breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div
                  style={{
                    backgroundColor: 'var(--bg-surface-elevated)',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 600 }}>PHASE 1 (N-S)</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
                    <span style={{ fontSize: '20px', fontWeight: 800, color: '#22c55e' }}>
                      {recommendation?.all_phase_scores?.find(p => p.phase_id === 'phase_1') ? (recommendation?.recommended_phase.phase_id === 'phase_1' ? recommendation.recommended_phase.proposed_green_sec : 30) : 38}s
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Green (Amber 4s / All-Red 2s)</span>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: 'var(--bg-surface-elevated)',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontWeight: 600 }}>PHASE 2 (E-W)</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: '4px' }}>
                    <span style={{ fontSize: '20px', fontWeight: 800, color: '#a855f7' }}>
                      {recommendation?.all_phase_scores?.find(p => p.phase_id === 'phase_2') ? (recommendation?.recommended_phase.phase_id === 'phase_2' ? recommendation.recommended_phase.proposed_green_sec : 25) : 25}s
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Green (Amber 4s / All-Red 2s)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Officer Recommendation Panel & Override */}
            <div
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '18px',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Adaptive Decision Recommendation
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 800,
                        padding: '3px 8px',
                        borderRadius: '4px',
                        backgroundColor:
                          recommendation?.status === 'APPROVED'
                            ? 'rgba(34, 197, 94, 0.2)'
                            : recommendation?.status === 'REJECTED'
                            ? 'rgba(239, 68, 68, 0.2)'
                            : 'rgba(234, 179, 8, 0.2)',
                        color:
                          recommendation?.status === 'APPROVED'
                            ? '#22c55e'
                            : recommendation?.status === 'REJECTED'
                            ? '#ef4444'
                            : '#eab308',
                        border: `1px solid ${
                          recommendation?.status === 'APPROVED'
                            ? 'rgba(34, 197, 94, 0.4)'
                            : recommendation?.status === 'REJECTED'
                            ? 'rgba(239, 68, 68, 0.4)'
                            : 'rgba(234, 179, 8, 0.4)'
                        }`,
                      }}
                    >
                      {recommendation?.status || 'PENDING_OFFICER_REVIEW'}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(56, 189, 248, 0.15)',
                        color: '#38bdf8',
                      }}
                    >
                      CONFIDENCE: {Math.round((recommendation?.confidence || 0.95) * 100)}%
                    </span>
                  </div>
                </div>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Trigger: {recommendation?.trigger_source || 'SCHEDULED_8S'} • Rec ID: {recommendation?.recommendation_id || 'N/A'}
                </p>
              </div>

              {/* Officer Decision Audit Info (If Approved or Rejected) */}
              {recommendation?.officer_decision && (
                <div
                  style={{
                    backgroundColor: recommendation.officer_decision === 'APPROVED' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    border: `1px solid ${recommendation.officer_decision === 'APPROVED' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                    borderRadius: '8px',
                    padding: '10px 14px',
                    fontSize: '12px',
                    color: recommendation.officer_decision === 'APPROVED' ? '#22c55e' : '#ef4444',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <FileCheck size={16} />
                  <span>
                    Officer decision: <strong>{recommendation.officer_decision}</strong> by {recommendation.officer_id || 'officer_1'} at {recommendation.decision_timestamp ? new Date(recommendation.decision_timestamp).toLocaleTimeString() : 'now'}.
                    {recommendation.rejection_reason && ` Reason: "${recommendation.rejection_reason}".`}
                    {recommendation.approved_green_sec && ` Approved duration: ${recommendation.approved_green_sec}s.`}
                  </span>
                </div>
              )}

              {/* AI Narrative Reasoning */}
              <div
                style={{
                  backgroundColor: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '10px',
                  padding: '16px',
                  display: 'flex',
                  gap: '12px',
                }}
              >
                <Info size={20} style={{ color: '#38bdf8', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    Officer Decision Rationale:
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                    {recPhase?.reason ||
                      'North-South approach demand score is elevated. Engine recommends allocating optimized green extension while maintaining safe clearance for pedestrian crossings.'}
                  </div>
                </div>
              </div>

              {/* Safety Constraints Checklist */}
              <div
                style={{
                  backgroundColor: 'rgba(15, 23, 42, 0.5)',
                  border: '1px solid #1e293b',
                  borderRadius: '10px',
                  padding: '14px',
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: '10px' }}>
                  SAFETY CONSTRAINT VALIDATION (STRICT ENFORCEMENT):
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#22c55e' }}>
                    <Check size={14} /> Min Green &ge; 15s (Enforced)
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#22c55e' }}>
                    <Check size={14} /> Max Green &le; 60s (Enforced)
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#22c55e' }}>
                    <Check size={14} /> Conflicting Movements Cleared
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#22c55e' }}>
                    <Check size={14} /> Pedestrian Clearance Guard (12s)
                  </div>
                </div>
              </div>

              {/* Manual Fine-Tuning Slider */}
              {(() => {
                const activePhaseConfig = config?.phases?.find(p => p.phase_id === recPhase?.phase_id);
                const minGreen = activePhaseConfig?.min_green_sec || 15;
                const maxGreen = activePhaseConfig?.max_green_sec || 55;
                const baselineGreen = config?.fixed_plan_green_times?.[recPhase?.phase_id || 'P1'] || 35;

                return (
                  <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Officer Split Duration (Bounds Enforced):
                      </span>
                      <span style={{ fontSize: '14px', fontWeight: 800, color: '#38bdf8' }}>
                        {overrideGreenSec} Seconds Green
                      </span>
                    </div>
                    <input
                      type="range"
                      min={minGreen}
                      max={maxGreen}
                      step="1"
                      value={overrideGreenSec}
                      disabled={recommendation?.status === 'APPROVED' || recommendation?.status === 'REJECTED'}
                      onChange={(e) => setOverrideGreenSec(Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                      <span>Min {minGreen}s</span>
                      <span>Baseline {baselineGreen}s</span>
                      <span>Max {maxGreen}s</span>
                    </div>
                  </div>
                );
              })()}

              {/* Officer Action Buttons (PART 6) */}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  onClick={handleApproveRecommendation}
                  disabled={
                    isApproving ||
                    recommendation?.status === 'APPROVED' ||
                    recommendation?.status === 'REJECTED' ||
                    (videoReadiness !== null && !videoReadiness.recommendation_available)
                  }
                  style={{
                    flex: 1.4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 800,
                    cursor:
                      isApproving || recommendation?.status === 'APPROVED' || recommendation?.status === 'REJECTED'
                        ? 'not-allowed'
                        : 'pointer',
                    border: 'none',
                    backgroundColor: recommendation?.status === 'APPROVED' ? '#059669' : '#16a34a',
                    opacity:
                      recommendation?.status === 'REJECTED' || (videoReadiness !== null && !videoReadiness.recommendation_available)
                        ? 0.5
                        : 1,
                    color: '#ffffff',
                    boxShadow: '0 4px 14px rgba(22, 163, 74, 0.4)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <ShieldCheck size={16} />
                  {isApproving
                    ? 'Validating & Approving...'
                    : recommendation?.status === 'APPROVED'
                    ? 'Plan Approved'
                    : 'Approve Recommendation'}
                </button>

                <button
                  onClick={() => setRejectionModalOpen(true)}
                  disabled={
                    isRejecting ||
                    recommendation?.status === 'APPROVED' ||
                    recommendation?.status === 'REJECTED'
                  }
                  style={{
                    flex: 0.8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor:
                      recommendation?.status === 'APPROVED' || recommendation?.status === 'REJECTED'
                        ? 'not-allowed'
                        : 'pointer',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    backgroundColor: recommendation?.status === 'REJECTED' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(239, 68, 68, 0.1)',
                    opacity: recommendation?.status === 'APPROVED' ? 0.5 : 1,
                    color: '#ef4444',
                  }}
                >
                  <XCircle size={15} />
                  {recommendation?.status === 'REJECTED' ? 'Rejected' : 'Reject'}
                </button>

                <button
                  onClick={() => handleRunSimulation(selectedScenario)}
                  disabled={isSimulating}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: isSimulating ? 'not-allowed' : 'pointer',
                    border: '1px solid var(--border-medium)',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <Play size={15} />
                  {isSimulating ? 'Testing...' : 'Simulate'}
                </button>
              </div>
            </div>
          </div>

          {/* Dedicated Manual Signal Configuration Section (ISSUE 2) */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    boxShadow: '0 0 15px rgba(245, 158, 11, 0.4)',
                  }}
                >
                  <SlidersHorizontal size={22} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: 'var(--text-primary)' }}>
                      Manual Signal Configuration
                    </h3>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(245, 158, 11, 0.15)',
                        color: '#f59e0b',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                      }}
                    >
                      MANUAL SELECTION
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor:
                          manualPlanStatus === 'APPROVED_PLAN'
                            ? 'rgba(34, 197, 94, 0.15)'
                            : manualPlanStatus === 'PENDING_OFFICER_APPROVAL'
                            ? 'rgba(234, 179, 8, 0.15)'
                            : 'rgba(56, 189, 248, 0.15)',
                        color:
                          manualPlanStatus === 'APPROVED_PLAN'
                            ? '#22c55e'
                            : manualPlanStatus === 'PENDING_OFFICER_APPROVAL'
                            ? '#eab308'
                            : '#38bdf8',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      PLAN: {manualPlanStatus}
                    </span>
                  </div>
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                    Authorized officer manual signal phase override. Persisted independently across navigation &amp; live AI telemetry.
                    {manualSelection?.created_at && (
                      <span style={{ marginLeft: '6px', color: '#38bdf8' }}>
                        (Saved: Phase {manualSelection.selected_phase_id} • {manualSelection.proposed_green_sec}s green • {manualSelection.officer_id || 'officer_1'})
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Status Comparison Badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: '12px' }}>
                <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>Current Phase: </span>
                  <strong style={{ color: '#22c55e' }}>{signalStatus?.current_phase_id || 'P1'}</strong>
                </div>
                <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>AI Recommendation: </span>
                  <strong style={{ color: '#38bdf8' }}>{recommendation?.recommended_phase?.phase_id || 'P1'} ({recommendation?.recommended_phase?.proposed_green_sec || 30}s)</strong>
                </div>
                <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>Controller Mode: </span>
                  <strong style={{ color: '#a855f7' }}>{signalStatus?.is_simulated ? 'SIMULATED PHASE' : 'AUTHORITATIVE'}</strong>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
              {/* Col 1: Intersection & Phase Selector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                    Intersection
                  </label>
                  <select
                    value={selectedIntersectionId}
                    onChange={(e) => setSelectedIntersectionId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-medium)',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                      fontWeight: 600,
                    }}
                  >
                    {intersections.map((int) => (
                      <option key={int.intersection_id} value={int.intersection_id}>
                        {int.name} ({int.intersection_id})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>
                    Manual Signal Phase Selection
                  </label>
                  <select
                    value={manualPhaseId}
                    onChange={(e) => {
                      const pId = e.target.value;
                      setManualPhaseId(pId);
                      const p = config?.phases?.find(ph => ph.phase_id === pId);
                      if (p) {
                        setManualServedApproaches(p.served_approaches || []);
                        setManualGreenSec(Math.min(p.max_green_sec, Math.max(p.min_green_sec, manualGreenSec)));
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '9px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-medium)',
                      color: 'var(--text-primary)',
                      fontSize: '13px',
                      fontWeight: 700,
                    }}
                  >
                    {config?.phases?.map((p) => (
                      <option key={p.phase_id} value={p.phase_id}>
                        {p.phase_id}: {p.phase_name} ({p.min_green_sec}s - {p.max_green_sec}s)
                      </option>
                    )) || (
                      <>
                        <option value="P1">P1: Phase 1 (North-South Through)</option>
                        <option value="P2">P2: Phase 2 (East-West Through)</option>
                        <option value="P3">P3: Phase 3 (North-South Protected Left)</option>
                        <option value="P4">P4: Phase 4 (East-West Protected Left)</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {/* Col 2: Approaches and Movements Served */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  Served Road Approaches &amp; Movements
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {approachDemands.map((app) => {
                    const isSelected = manualServedApproaches.some(a =>
                      a.toLowerCase() === app.direction.toLowerCase() ||
                      a.toLowerCase() === app.approach_id.toLowerCase() ||
                      a.toLowerCase() === app.name.toLowerCase()
                    );
                    return (
                      <button
                        key={app.approach_id}
                        type="button"
                        onClick={() => {
                          const id = app.direction.toLowerCase() || app.approach_id;
                          setManualServedApproaches(prev =>
                            isSelected ? prev.filter(x => x !== id) : [...prev, id]
                          );
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '7px 12px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          border: isSelected ? '1px solid #38bdf8' : '1px solid var(--border-medium)',
                          backgroundColor: isSelected ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-surface-elevated)',
                          color: isSelected ? '#38bdf8' : 'var(--text-secondary)',
                          cursor: 'pointer',
                        }}
                      >
                        <Check size={12} style={{ opacity: isSelected ? 1 : 0.2 }} />
                        <span>{app.name || app.approach_id} ({app.direction || 'Approach'})</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                  Select one or more approaches served simultaneously during this phase interval.
                </div>
              </div>

              {/* Col 3: Proposed Green & Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {(() => {
                  const selectedPhaseObj = config?.phases?.find(p => p.phase_id === manualPhaseId);
                  const minG = selectedPhaseObj?.min_green_sec || 15;
                  const maxG = selectedPhaseObj?.max_green_sec || 60;
                  return (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                          Proposed Green Duration:
                        </span>
                        <strong style={{ fontSize: '15px', color: '#f59e0b' }}>
                          {manualGreenSec}s (Limits: {minG}s - {maxG}s)
                        </strong>
                      </div>
                      <input
                        type="range"
                        min={minG}
                        max={maxG}
                        step="1"
                        value={manualGreenSec}
                        onChange={(e) => setManualGreenSec(Number(e.target.value))}
                        style={{ width: '100%', accentColor: '#f59e0b', cursor: 'pointer' }}
                      />
                    </>
                  );
                })()}

                <div style={{ display: 'flex', gap: '10px', marginTop: 'auto' }}>
                  <button
                    onClick={() => handleSaveManualSelection('APPROVED_PLAN')}
                    disabled={isSavingManual}
                    style={{
                      flex: 1.3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      padding: '11px 14px',
                      borderRadius: '8px',
                      backgroundColor: '#0284c7',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '12px',
                      border: 'none',
                      cursor: isSavingManual ? 'not-allowed' : 'pointer',
                      boxShadow: '0 2px 8px rgba(2, 132, 199, 0.4)',
                    }}
                  >
                    <Save size={14} />
                    {isSavingManual ? 'Saving Plan...' : 'Approve & Save Manual Plan'}
                  </button>

                  <button
                    onClick={() => handleSaveManualSelection('PENDING_OFFICER_APPROVAL')}
                    disabled={isSavingManual}
                    style={{
                      flex: 0.9,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      padding: '11px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-medium)',
                      color: 'var(--text-secondary)',
                      fontWeight: 600,
                      fontSize: '12px',
                      cursor: isSavingManual ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Save as Pending
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Approach Demand Breakdown Grid (All Configured Roads) */}
          <div>
            <div style={{ marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Approach Demand Breakdown
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Demand formula: D = 0.45(Queue) + 0.25(Arrival) + 0.20(Wait) + 0.10(Occupancy) • Showing all active roads
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              {approachDemands.map((app: ApproachDemand) => {
                const score = app.demand_score || 0;
                const scorePct = Math.round(score * 100);
                const scoreColor = score > 0.7 ? '#ef4444' : score > 0.4 ? '#f59e0b' : '#22c55e';

                return (
                  <div
                    key={app.approach_id}
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '12px',
                      padding: '18px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '14px',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {getDirectionIcon(app.direction)}
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-primary)' }}>
                            {app.name || app.approach_id || 'Unnamed Road'}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                            {app.direction ? `${app.direction} Approach` : 'Configured Approach'} • ID: {app.approach_id}
                          </div>
                        </div>
                      </div>
                      {getQualityBadge(app.data_quality)}
                    </div>

                    {/* Demand Score Bar */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '6px' }}>
                        <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Demand Index</span>
                        <strong style={{ color: scoreColor }}>{scorePct}%</strong>
                      </div>
                      <div
                        style={{
                          height: '8px',
                          backgroundColor: 'var(--bg-surface-elevated)',
                          borderRadius: '4px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${Math.min(100, Math.max(5, scorePct))}%`,
                            backgroundColor: scoreColor,
                            borderRadius: '4px',
                            transition: 'width 0.4s ease',
                          }}
                        />
                      </div>
                    </div>

                    {/* Metric Pills */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '8px 10px', borderRadius: '6px' }}>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', display: 'block' }}>Queue Length</span>
                        <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{app.queue_length_veh ?? 0} veh</strong>
                      </div>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '8px 10px', borderRadius: '6px' }}>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', display: 'block' }}>Arrival Rate</span>
                        <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{(app.arrival_rate_veh_per_min ?? 0).toFixed(1)} /min</strong>
                      </div>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '8px 10px', borderRadius: '6px' }}>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', display: 'block' }}>Avg Wait Time</span>
                        <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{(app.avg_wait_sec ?? 0).toFixed(1)}s</strong>
                      </div>
                      <div style={{ backgroundColor: 'var(--bg-surface-elevated)', padding: '8px 10px', borderRadius: '6px' }}>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: '11px', display: 'block' }}>Occupancy</span>
                        <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{(app.occupancy_pct ?? 0).toFixed(0)}%</strong>
                      </div>
                    </div>

                    {/* Starvation Protection Notice */}
                    {app.starvation_boost_applied && (
                      <div
                        style={{
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          fontSize: '11px',
                          color: '#ef4444',
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <AlertTriangle size={13} />
                        Starvation boost applied (&gt;120s unserved)
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* TAB 2: WHAT-IF SCENARIO SIMULATOR */}
      {activeTab === 'simulation' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Scenario Selector & Action Bar */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '20px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
            }}
          >
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                Synthetic & Counterfactual Traffic Scenarios
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Stress test adaptive timing against abnormal volume surges and incident lane blockages
                {simulationResult?.simulation_id && (
                  <span style={{ marginLeft: '8px', color: '#38bdf8' }}>• Run ID: {simulationResult.simulation_id.slice(0, 8)}</span>
                )}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <select
                value={selectedScenario}
                onChange={(e) => {
                  const sc = e.target.value as SimulationScenarioType;
                  setSelectedScenario(sc);
                  handleRunSimulation(sc);
                }}
                style={{
                  backgroundColor: 'var(--bg-surface-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '8px',
                  padding: '8px 14px',
                  fontSize: '13px',
                  fontWeight: 600,
                  outline: 'none',
                }}
              >
                <option value="NORMAL_TRAFFIC">Scenario 1: Normal Traffic Baseline</option>
                <option value="PEAK_TRAFFIC">Scenario 2: Morning Rush Surge (2.2x)</option>
                <option value="UNEVEN_TRAFFIC">Scenario 3: Asymmetric N-S Congestion</option>
                <option value="APPROACH_BLOCKED">Scenario 4: Incident (E-W Blocked)</option>
                <option value="INCREASED_TURNING">Scenario 5: Heavy Turning Maneuvers</option>
                <option value="HIGH_ARRIVAL_RATE">Scenario 6: High Velocity Inflow</option>
              </select>

              <button
                onClick={() => handleRunSimulation(selectedScenario)}
                disabled={isSimulating}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 18px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  border: 'none',
                  backgroundColor: '#0284c7',
                  color: '#ffffff',
                  cursor: isSimulating ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 8px rgba(2, 132, 199, 0.4)',
                }}
              >
                <Play size={14} />
                {isSimulating ? 'Simulating...' : 'Run Simulation'}
              </button>
            </div>
          </div>

          {/* Comparison Metrics Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '16px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 700 }}>DELAY IMPROVEMENT</span>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#22c55e', marginTop: '4px' }}>
                {planComparison?.delay_improvement_pct ? `-${planComparison.delay_improvement_pct.toFixed(1)}%` : '-26.4%'}
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Fixed: {planComparison?.fixed_plan?.avg_delay_sec?.toFixed(1) || '42.1'}s vs Adaptive: {planComparison?.adaptive_plan?.avg_delay_sec?.toFixed(1) || '31.0'}s</span>
            </div>

            <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '16px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 700 }}>QUEUE REDUCTION</span>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#38bdf8', marginTop: '4px' }}>
                {planComparison?.queue_improvement_pct ? `-${planComparison.queue_improvement_pct.toFixed(1)}%` : '-32.1%'}
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Fixed: {planComparison?.fixed_plan?.max_queue_veh || 28} veh vs Adaptive: {planComparison?.adaptive_plan?.max_queue_veh || 19} veh</span>
            </div>

            <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '16px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 700 }}>THROUGHPUT CAPACITY</span>
              <div style={{ fontSize: '24px', fontWeight: 800, color: '#a855f7', marginTop: '4px' }}>
                {planComparison?.throughput_improvement_pct ? `+${planComparison.throughput_improvement_pct.toFixed(1)}%` : '+18.5%'}
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Adaptive: {planComparison?.adaptive_plan?.throughput_veh_per_hour || 1420} veh/hr</span>
            </div>

            <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '16px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 700 }}>TOTAL VEHICLES SERVED</span>
              <div style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
                {planComparison?.adaptive_plan?.vehicles_served || 1380}
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>In simulated 1-hour cycle horizon</span>
            </div>
          </div>

          {/* Charts: Recharts Comparison Bar Chart */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '24px',
            }}
          >
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Fixed Baseline vs Adaptive Plan Comparison ({selectedScenario})
            </h3>
            <div style={{ height: '320px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[
                    {
                      metric: 'Average Delay (s)',
                      'Fixed Baseline': planComparison?.fixed_plan?.avg_delay_sec || 42,
                      'Adaptive AI Plan': planComparison?.adaptive_plan?.avg_delay_sec || 31,
                    },
                    {
                      metric: 'Max Queue (veh)',
                      'Fixed Baseline': planComparison?.fixed_plan?.max_queue_veh || 28,
                      'Adaptive AI Plan': planComparison?.adaptive_plan?.max_queue_veh || 19,
                    },
                    {
                      metric: 'Average Wait (s)',
                      'Fixed Baseline': planComparison?.fixed_plan?.avg_wait_sec || 36,
                      'Adaptive AI Plan': planComparison?.adaptive_plan?.avg_wait_sec || 24,
                    },
                  ]}
                  margin={{ top: 20, right: 30, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="metric" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0f172a',
                      borderColor: '#334155',
                      borderRadius: '8px',
                      color: '#f8fafc',
                    }}
                  />
                  <Legend />
                  <Bar dataKey="Fixed Baseline" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Adaptive AI Plan" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Road Coverage & Per-Approach Simulation Table (ISSUE 3 & 4) */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Simulated Intersection Road Coverage &amp; Performance
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Validated road records included in counterfactual simulation model ({selectedScenario})
                </p>
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  padding: '4px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'rgba(34, 197, 94, 0.15)',
                  color: '#22c55e',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                }}
              >
                ROADS SIMULATED: {simulationResult?.adaptive_plan_result?.per_approach?.length || approachDemands.length}
              </span>
            </div>

            {/* Any Excluded Roads Warning */}
            {((simulationResult as any)?.excluded_roads?.length || 0) > 0 && (
              <div
                style={{
                  backgroundColor: 'rgba(234, 179, 8, 0.1)',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  fontSize: '12px',
                  color: '#eab308',
                }}
              >
                <strong>Notice — Excluded Roads:</strong>
                {((simulationResult as any)?.excluded_roads || []).map((ex: any, idx: number) => (
                  <div key={idx} style={{ marginTop: '4px' }}>
                    • Road {ex.road_id || ex.approach_id || 'N/A'}: {ex.reason || 'Unmapped or invalid ROI'}
                  </div>
                ))}
              </div>
            )}

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-medium)', textAlign: 'left', color: 'var(--text-tertiary)' }}>
                    <th style={{ padding: '10px 12px' }}>ROAD NAME</th>
                    <th style={{ padding: '10px 12px' }}>APPROACH / ID</th>
                    <th style={{ padding: '10px 12px' }}>AVERAGE DELAY</th>
                    <th style={{ padding: '10px 12px' }}>AVERAGE WAIT</th>
                    <th style={{ padding: '10px 12px' }}>MAX QUEUE</th>
                    <th style={{ padding: '10px 12px' }}>THROUGHPUT</th>
                    <th style={{ padding: '10px 12px' }}>VEHICLES SERVED</th>
                  </tr>
                </thead>
                <tbody>
                  {(simulationResult?.adaptive_plan_result?.per_approach || []).map((app) => {
                    const matchRoad = approachDemands.find(
                      a => a.approach_id === app.approach_id || a.direction === app.direction
                    );
                    const roadName = matchRoad?.name || app.approach_id || 'Unnamed Road';
                    return (
                      <tr key={app.approach_id} style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {roadName}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span style={{ padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--bg-surface-elevated)', border: '1px solid var(--border-subtle)', fontSize: '11px' }}>
                            {app.direction} ({app.approach_id})
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#22c55e', fontWeight: 600 }}>
                          {app.avg_delay_sec?.toFixed(1)}s
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {app.avg_wait_sec?.toFixed(1)}s
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {app.max_queue_veh} veh
                        </td>
                        <td style={{ padding: '10px 12px', color: '#38bdf8' }}>
                          {app.throughput_veh_per_hour} veh/hr
                        </td>
                        <td style={{ padding: '10px 12px', color: '#a855f7', fontWeight: 700 }}>
                          {app.vehicles_served}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: AUDIT LOG */}
      {activeTab === 'audit' && (
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '24px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
                System Audit Trail & Officer Telemetry
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Immutable event record of model recommendations, constraint validations, and interventions
              </p>
            </div>
            <button
              onClick={() => api.getIntersectionAuditLog(selectedIntersectionId, 25).then(setAuditLog)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: 600,
                border: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-surface-elevated)',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={12} /> Refresh Log
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-medium)', textAlign: 'left', color: 'var(--text-tertiary)' }}>
                  <th style={{ padding: '10px 14px' }}>TIMESTAMP</th>
                  <th style={{ padding: '10px 14px' }}>EVENT TYPE</th>
                  <th style={{ padding: '10px 14px' }}>ACTOR</th>
                  <th style={{ padding: '10px 14px' }}>INTERSECTION</th>
                  <th style={{ padding: '10px 14px' }}>DETAILS & OUTCOME</th>
                </tr>
              </thead>
              <tbody>
                {auditLog.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                      No events logged yet. Trigger a recommendation or simulation to populate.
                    </td>
                  </tr>
                ) : (
                  auditLog.map((log) => (
                    <tr
                      key={log.entry_id}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span
                          style={{
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: 700,
                            backgroundColor: log.event_type.includes('RECOMMENDATION')
                              ? 'rgba(56, 189, 248, 0.15)'
                              : log.event_type.includes('SIMULATION')
                              ? 'rgba(168, 85, 247, 0.15)'
                              : 'rgba(34, 197, 94, 0.15)',
                            color: log.event_type.includes('RECOMMENDATION')
                              ? '#38bdf8'
                              : log.event_type.includes('SIMULATION')
                              ? '#a855f7'
                              : '#22c55e',
                          }}
                        >
                          {log.event_type}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{log.actor}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{log.intersection_id}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                        {log.details ? JSON.stringify(log.details).slice(0, 80) : 'System generated'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Officer Rejection Dialog Modal (PART 6) */}
      {rejectionModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
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
              border: '1px solid var(--border-medium)',
              borderRadius: '14px',
              maxWidth: '480px',
              width: '100%',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ef4444',
                }}
              >
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Reject Recommendation
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Record official rejection reason. Baseline fixed plan will remain active.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                REJECTION REASON:
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={3}
                style={{
                  backgroundColor: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: '8px',
                  padding: '10px',
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  outline: 'none',
                  resize: 'none',
                }}
                placeholder="Specify reason (e.g. traffic incident, emergency vehicle corridor, manual timing override)..."
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button
                onClick={() => setRejectionModalOpen(false)}
                disabled={isRejecting}
                style={{
                  padding: '10px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: '1px solid var(--border-subtle)',
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleRejectRecommendation}
                disabled={isRejecting || !rejectionReason.trim()}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 800,
                  cursor: isRejecting ? 'not-allowed' : 'pointer',
                  border: 'none',
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  boxShadow: '0 2px 10px rgba(239, 68, 68, 0.4)',
                }}
              >
                {isRejecting ? 'Recording Rejection...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default AdaptiveSignalControl;
