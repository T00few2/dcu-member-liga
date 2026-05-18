'use client';

import { useState, useEffect, useMemo } from 'react';
import { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';
import { useParticipantsQuery, usePredictorConfigQuery } from '@/hooks/queries';
import {
  ALL_ON,
  mergeFeatures,
  buildModel,
  predict,
  categoryFromVelo,
  veloForCategory,
  ZR_CATEGORY_DEFAULTS,
  FEATURE_DEFS,
  Participant,
  Inputs,
  FeatureKey,
} from './category-predictor/shared';
import CategoryPredictorResults from './category-predictor/CategoryPredictorResults';
import CategoryPredictorForm from './category-predictor/CategoryPredictorForm';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CategoryPredictorProps {
  user: User | null;
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

  // ── Rider / form state ───────────────────────────────────────────────────
  const [selectedZwiftId, setSelectedZwiftId] = useState('');
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [powerSource, setPowerSource] = useState<'zwift' | 'strava'>('zwift');
  const [loadingStrava, setLoadingStrava] = useState(false);
  const [stravaError, setStravaError] = useState('');
  const [inputs, setInputs] = useState<Inputs>({ weightKg: 0, wkg5s: 0, wkg1m: 0, wkg5m: 0, wkg20m: 0, racingScore: 0 });
  const [manualCategory, setManualCategory] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<{ category: string } | null>(null);
  const [assignError, setAssignError] = useState('');

  // ── Derived prediction values ────────────────────────────────────────────
  const activeFeatures = FEATURE_DEFS.filter(f => model?.activeFeatureKeys.includes(f.key));
  const predRow = activeFeatures.map(f => f.fromInputs(inputs));
  const predictedVelo = model && predRow.length > 0 && predRow.every(v => v > 0)
    ? Math.round(predict(model.coeffs, predRow))
    : null;
  const predictedCategory = predictedVelo != null ? categoryFromVelo(predictedVelo, ZR_CATEGORY_DEFAULTS) : null;
  const predLow  = predictedVelo != null && model ? Math.round(predictedVelo - model.rmse) : null;
  const predHigh = predictedVelo != null && model ? Math.round(predictedVelo + model.rmse) : null;
  const catLow   = predLow  != null ? categoryFromVelo(predLow,  ZR_CATEGORY_DEFAULTS) : null;
  const catHigh  = predHigh != null ? categoryFromVelo(predHigh, ZR_CATEGORY_DEFAULTS) : null;

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
    setManualCategory('');
    setAssignResult(null);
    setAssignError('');
    setStravaError('');
    const p = participants.find(pp => pp.zwiftId === zwiftId);
    if (!p) { setInputs({ weightKg: 0, wkg5s: 0, wkg1m: 0, wkg5m: 0, wkg20m: 0, racingScore: 0 }); return; }
    const kg = (p.weightInGrams ?? 0) / 1000;
    const wkg = (w: number | null) => (kg > 0 && w && w > 0) ? parseFloat((w / kg).toFixed(2)) : 0;
    const rs = typeof p.racingScore === 'number' ? p.racingScore : parseFloat(String(p.racingScore ?? '')) || 0;
    setInputs({
      weightKg: kg,
      wkg5s:  wkg(p.cp5s),
      wkg1m:  wkg(p.cp1min),
      wkg5m:  wkg(p.cp5min),
      wkg20m: wkg(p.cp20min),
      racingScore: rs,
    });
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
      const kg = inputs.weightKg > 0 ? inputs.weightKg : (selectedParticipant?.weightInGrams ?? 0) / 1000;
      const c5s  = curve['w5']    ?? 0;
      const cp1  = curve['w60']   ?? 0;
      const cp5  = curve['w300']  ?? 0;
      const cp20 = curve['w1200'] ?? 0;
      const wkg = (w: number, prev: number) => kg > 0 && w > 0 ? parseFloat((w / kg).toFixed(2)) : prev;
      setInputs(prev => ({
        ...prev,
        weightKg: kg || prev.weightKg,
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
    const targetCat = manualCategory || predictedCategory;
    if (!selectedZwiftId || !user || !targetCat) return;
    let veloToSend: number;
    if (manualCategory) {
      const mid = veloForCategory(manualCategory);
      if (!mid) { setAssignError('Could not compute a vELO for the chosen category'); return; }
      veloToSend = mid;
    } else {
      if (predictedVelo == null) return;
      veloToSend = predictedVelo;
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

  function handleSetInput(field: keyof Inputs, value: string) {
    setAssignResult(null);
    setAssignError('');
    const num = parseFloat(value);
    setInputs(prev => ({ ...prev, [field]: isNaN(num) ? 0 : num }));
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

  function handleSetManualCategory(cat: string) {
    setManualCategory(cat);
    setAssignResult(null);
    setAssignError('');
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
          any rider based on their power data — either from Zwift or from Strava — and assigns them a starting
          category using the same engine as the nightly job.
        </p>
        <p>
          <span className="font-medium text-foreground">Workflow:</span> Review the model fit below, then scroll
          to <em>Predict &amp; Assign</em>. Select a rider, optionally switch to Strava power data and click Load,
          adjust any values if needed, and click Assign. The predicted vELO is written as{' '}
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
        powerSource={powerSource}
        onSetPowerSource={(src) => {
          setPowerSource(src);
          if (src === 'zwift') setStravaError('');
        }}
        loadingStrava={loadingStrava}
        onLoadStrava={handleLoadStrava}
        stravaError={stravaError}
        inputs={inputs}
        onSetInput={handleSetInput}
        model={model}
        predictedVelo={predictedVelo}
        predictedCategory={predictedCategory}
        predLow={predLow}
        predHigh={predHigh}
        catLow={catLow}
        catHigh={catHigh}
        actualVelo={actualVelo}
        manualCategory={manualCategory}
        onSetManualCategory={handleSetManualCategory}
        assigning={assigning}
        onAssign={handleAssign}
        assignResult={assignResult}
        assignError={assignError}
      />
    </div>
  );
}
