'use client';

import { useState, useEffect, useMemo } from 'react';
import { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';
import { useParticipantsQuery, usePredictorConfigQuery } from '@/hooks/queries';
import {
  ALL_ON,
  mergeFeatures,
  buildModel,
  veloForCategory,
  inputsFromParticipant,
  combineInputs,
  predictionFromInputs,
  FEATURE_DEFS,
  EMPTY_POWER,
  EMPTY_SHARED,
  Participant,
  FeatureKey,
  SharedField,
  SharedInputs,
  PowerField,
  PowerInputs,
} from './category-predictor/shared';
import CategoryPredictorResults from './category-predictor/CategoryPredictorResults';
import CategoryPredictorForm from './category-predictor/CategoryPredictorForm';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CategoryPredictorProps {
  user: User | null;
}

function parseNumericField(value: string): number {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CategoryPredictor({ user }: CategoryPredictorProps) {
  const { data: participantsRaw, isLoading: loadingParticipants } = useParticipantsQuery();
  const participants = (participantsRaw ?? []) as Participant[];

  const { data: predictorConfig } = usePredictorConfigQuery();

  // ── Model feature selection ──────────────────────────────────────────────
  const [selectedFeatures, setSelectedFeatures] = useState<Record<FeatureKey, boolean>>(ALL_ON);
  const [savedFeedback, setSavedFeedback] = useState(false);

  // Sync feature selection from server config when it loads
  useEffect(() => {
    if (predictorConfig?.features && typeof predictorConfig.features === 'object') {
      setSelectedFeatures(mergeFeatures(predictorConfig.features));
    }
  }, [predictorConfig]);

  const model = useMemo(() => buildModel(participants, selectedFeatures), [participants, selectedFeatures]);
  const activeFeatureKeys = useMemo(
    () => FEATURE_DEFS.filter(f => selectedFeatures[f.key]).map(f => f.key),
    [selectedFeatures],
  );

  // ── Rider / form state ───────────────────────────────────────────────────
  const [selectedZwiftId, setSelectedZwiftId] = useState('');
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [loadingStrava, setLoadingStrava] = useState(false);
  const [stravaError, setStravaError] = useState('');
  const [shared, setShared] = useState<SharedInputs>(EMPTY_SHARED);
  const [zwiftPower, setZwiftPower] = useState<PowerInputs>(EMPTY_POWER);
  const [stravaPower, setStravaPower] = useState<PowerInputs>(EMPTY_POWER);
  const [assignChoice, setAssignChoice] = useState('zwift');
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<{ category: string } | null>(null);
  const [assignError, setAssignError] = useState('');

  // ── Derived prediction values ────────────────────────────────────────────
  const zwiftPrediction = useMemo(
    () => predictionFromInputs(model, combineInputs(shared, zwiftPower)),
    [model, shared, zwiftPower],
  );
  const stravaPrediction = useMemo(
    () => predictionFromInputs(model, combineInputs(shared, stravaPower)),
    [model, shared, stravaPower],
  );

  const selectedParticipant = participants.find(p => p.zwiftId === selectedZwiftId) ?? null;
  const actualVelo =
    selectedParticipant && typeof selectedParticipant.max30Rating === 'number'
      ? selectedParticipant.max30Rating
      : selectedParticipant?.max30Rating != null && selectedParticipant.max30Rating !== 'N/A'
      ? parseFloat(String(selectedParticipant.max30Rating))
      : null;

  // ── Handlers ─────────────────────────────────────────────────────────────

  function handleSelectRider(zwiftId: string) {
    setSelectedZwiftId(zwiftId);
    setAssignChoice('zwift');
    setAssignResult(null);
    setAssignError('');
    setStravaError('');
    const p = participants.find(pp => pp.zwiftId === zwiftId);
    if (!p) {
      setShared({ ...EMPTY_SHARED });
      setZwiftPower({ ...EMPTY_POWER });
      setStravaPower({ ...EMPTY_POWER });
      return;
    }
    const filled = inputsFromParticipant(p);
    setShared({ weightKg: filled.weightKg, racingScore: filled.racingScore });
    setZwiftPower({ wkg5s: filled.wkg5s, wkg1m: filled.wkg1m, wkg5m: filled.wkg5m, wkg20m: filled.wkg20m });
    setStravaPower({ ...EMPTY_POWER });
  }

  async function handleLoadStrava() {
    if (!selectedZwiftId || !user) return;
    setLoadingStrava(true);
    setStravaError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/verification/strava-power-curve/${selectedZwiftId}?days=90`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { setStravaError(data.message ?? 'Failed to load Strava data'); return; }
      const curve: Record<string, number> = data.curve ?? {};
      const kg = shared.weightKg > 0 ? shared.weightKg : (selectedParticipant?.weightInGrams ?? 0) / 1000;
      const c5s  = curve['w5']    ?? 0;
      const cp1  = curve['w60']   ?? 0;
      const cp5  = curve['w300']  ?? 0;
      const cp20 = curve['w1200'] ?? 0;
      const wkg = (w: number, prev: number) => kg > 0 && w > 0 ? parseFloat((w / kg).toFixed(2)) : prev;
      setShared(prev => ({ ...prev, weightKg: kg || prev.weightKg }));
      setStravaPower(prev => ({
        wkg5s:  wkg(c5s,  prev.wkg5s),
        wkg1m:  wkg(cp1,  prev.wkg1m),
        wkg5m:  wkg(cp5,  prev.wkg5m),
        wkg20m: wkg(cp20, prev.wkg20m),
      }));
    } catch (e: unknown) {
      setStravaError(e instanceof Error ? e.message : 'Error loading Strava data');
    } finally {
      setLoadingStrava(false);
    }
  }

  async function handleAssign() {
    if (!selectedZwiftId || !user) return;
    let veloToSend: number;
    if (assignChoice === 'zwift') {
      if (zwiftPrediction.velo == null) return;
      veloToSend = zwiftPrediction.velo;
    } else if (assignChoice === 'strava') {
      if (stravaPrediction.velo == null) return;
      veloToSend = stravaPrediction.velo;
    } else {
      const mid = veloForCategory(assignChoice);
      if (!mid) { setAssignError('Could not compute a vELO for the chosen category'); return; }
      veloToSend = mid;
    }
    setAssigning(true);
    setAssignResult(null);
    setAssignError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/liga-categories/${selectedZwiftId}/predict-assign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ predictedVelo: veloToSend }),
      });
      const data = await res.json();
      if (!res.ok) { setAssignError(data.message ?? 'Assignment failed'); return; }
      setAssignResult({ category: data.category });
    } catch (e: unknown) {
      setAssignError(e instanceof Error ? e.message : 'Assignment failed');
    } finally {
      setAssigning(false);
    }
  }

  function handleSetSharedInput(field: SharedField, value: string) {
    setAssignResult(null);
    setAssignError('');
    setShared(prev => ({ ...prev, [field]: parseNumericField(value) }));
  }

  function handleSetPowerInput(source: 'zwift' | 'strava', field: PowerField, value: string) {
    setAssignResult(null);
    setAssignError('');
    const next = parseNumericField(value);
    if (source === 'zwift') setZwiftPower(prev => ({ ...prev, [field]: next }));
    else setStravaPower(prev => ({ ...prev, [field]: next }));
  }

  function handleSetAssignChoice(choice: string) {
    setAssignChoice(choice);
    setAssignResult(null);
    setAssignError('');
  }

  async function handleSaveDefaults() {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/predictor-config`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: selectedFeatures }),
      });
      if (res.ok) {
        setSavedFeedback(true);
        setTimeout(() => setSavedFeedback(false), 2000);
      }
    } catch { /* ignore */ }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">
      {/* ── Intro ── */}
      <div className="bg-muted/40 border border-border rounded-lg p-4 text-sm text-muted-foreground space-y-1">
        <p>
          <span className="font-medium text-foreground">What this tool does:</span> Riders with thin Zwift profiles
          may not have a ZwiftRacing vELO score, so the automatic category assignment can&apos;t place them. This tool
          fits a linear model from riders <em>who do</em> have vELO scores, then uses it to predict a vELO for
          any rider based on their power data — from Zwift and from Strava side by side — and assigns them a starting
          category using the same engine as the nightly job.
        </p>
        <p>
          <span className="font-medium text-foreground">Workflow:</span> Review the model fit below, then scroll
          to <em>Predict &amp; Assign</em>. Select a rider, optionally load Strava power, compare the two columns,
          and click Assign using the prediction you want. The predicted vELO is written as{' '}
          <code className="bg-muted px-1 rounded text-xs">assignedFrom: &quot;predicted&quot;</code> so the nightly
          job will re-evaluate them normally going forward.
        </p>
      </div>

      {/* ── Section 1: Model ── */}
      <CategoryPredictorResults
        loadingParticipants={loadingParticipants}
        model={model}
        selectedFeatures={selectedFeatures}
        onToggleFeature={(key, enabled) =>
          setSelectedFeatures(prev => ({ ...prev, [key]: enabled }))
        }
        onSaveDefaults={handleSaveDefaults}
        savedFeedback={savedFeedback}
        onResetFeatures={() => setSelectedFeatures({ ...ALL_ON })}
      />

      {/* ── Section 2: Predict & Assign ── */}
      <CategoryPredictorForm
        participants={participants}
        selectedZwiftId={selectedZwiftId}
        onSelectRider={handleSelectRider}
        showUnassignedOnly={showUnassignedOnly}
        onSetShowUnassignedOnly={setShowUnassignedOnly}
        loadingStrava={loadingStrava}
        onLoadStrava={handleLoadStrava}
        stravaError={stravaError}
        shared={shared}
        onSetSharedInput={handleSetSharedInput}
        zwiftPower={zwiftPower}
        stravaPower={stravaPower}
        onSetPowerInput={handleSetPowerInput}
        model={model}
        activeFeatureKeys={activeFeatureKeys}
        zwiftPrediction={zwiftPrediction}
        stravaPrediction={stravaPrediction}
        actualVelo={actualVelo}
        assignChoice={assignChoice}
        onSetAssignChoice={handleSetAssignChoice}
        assigning={assigning}
        onAssign={handleAssign}
        assignResult={assignResult}
        assignError={assignError}
      />
    </div>
  );
}
