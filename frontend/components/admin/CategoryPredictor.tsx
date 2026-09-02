'use client';

import { useState, useEffect, useMemo } from 'react';
import { User } from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
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
  predictionFromStravaCache,
  actualVeloFromParticipant,
  FEATURE_DEFS,
  EMPTY_POWER,
  EMPTY_SHARED,
  Participant,
  FeatureKey,
  SharedField,
  SharedInputs,
  PowerField,
  PowerInputs,
  StravaRiderCache,
  filterPredictorRiders,
  powerFromStravaCurve,
} from './category-predictor/shared';
import CategoryPredictorResults from './category-predictor/CategoryPredictorResults';
import CategoryPredictorForm from './category-predictor/CategoryPredictorForm';
import CategoryPredictorRoster from './category-predictor/CategoryPredictorRoster';

interface CategoryPredictorProps {
  user: User | null;
}

function parseNumericField(value: string): number {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

export default function CategoryPredictor({ user }: CategoryPredictorProps) {
  const queryClient = useQueryClient();
  const { data: participantsRaw, isLoading: loadingParticipants } = useParticipantsQuery();
  const participants = (participantsRaw ?? []) as Participant[];

  const { data: predictorConfig } = usePredictorConfigQuery();

  const [selectedFeatures, setSelectedFeatures] = useState<Record<FeatureKey, boolean>>(ALL_ON);
  const [savedFeedback, setSavedFeedback] = useState(false);

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

  const [selectedZwiftId, setSelectedZwiftId] = useState('');
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [showMismatchOnly, setShowMismatchOnly] = useState(false);
  const [stravaByRider, setStravaByRider] = useState<Record<string, StravaRiderCache>>({});
  const [loadingStravaIds, setLoadingStravaIds] = useState<Record<string, true>>({});
  const [bulkStravaProgress, setBulkStravaProgress] = useState<{ done: number; total: number } | null>(null);
  const [shared, setShared] = useState<SharedInputs>(EMPTY_SHARED);
  const [zwiftPower, setZwiftPower] = useState<PowerInputs>(EMPTY_POWER);
  const [assignChoice, setAssignChoice] = useState('zwift');
  const [assigningZwiftId, setAssigningZwiftId] = useState<string | null>(null);
  const [assignResult, setAssignResult] = useState<{ category: string } | null>(null);
  const [assignError, setAssignError] = useState('');
  const [assignErrors, setAssignErrors] = useState<Record<string, string>>({});
  const [assignedOverlay, setAssignedOverlay] = useState<Record<string, string>>({});

  const selectedStrava = selectedZwiftId ? stravaByRider[selectedZwiftId] : undefined;
  const stravaPower = selectedStrava?.power ?? EMPTY_POWER;

  const zwiftPrediction = useMemo(
    () => predictionFromInputs(model, combineInputs(shared, zwiftPower)),
    [model, shared, zwiftPower],
  );
  const stravaPrediction = useMemo(
    () => predictionFromInputs(model, combineInputs(shared, stravaPower)),
    [model, shared, stravaPower],
  );

  const selectedParticipant = participants.find(p => p.zwiftId === selectedZwiftId) ?? null;
  const actualVelo = selectedParticipant ? actualVeloFromParticipant(selectedParticipant) : null;

  const visibleRiders = useMemo(
    () => filterPredictorRiders(participants, model, {
      unassignedOnly: showUnassignedOnly,
      mismatchOnly: showMismatchOnly,
      assignedOverlay,
    }),
    [participants, model, showUnassignedOnly, showMismatchOnly, assignedOverlay],
  );

  function handleSelectRider(zwiftId: string, scrollToDetail = false) {
    setSelectedZwiftId(zwiftId);
    setAssignChoice('zwift');
    setAssignResult(null);
    setAssignError('');
    const p = participants.find(pp => pp.zwiftId === zwiftId);
    if (!p) {
      setShared({ ...EMPTY_SHARED });
      setZwiftPower({ ...EMPTY_POWER });
      return;
    }
    const filled = inputsFromParticipant(p);
    setShared({ weightKg: filled.weightKg, racingScore: filled.racingScore });
    setZwiftPower({ wkg5s: filled.wkg5s, wkg1m: filled.wkg1m, wkg5m: filled.wkg5m, wkg20m: filled.wkg20m });
    if (scrollToDetail) {
      requestAnimationFrame(() => {
        document.getElementById('predictor-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  async function loadStravaForRider(zwiftId: string, weightKg: number) {
    if (!user) return;
    setLoadingStravaIds(prev => ({ ...prev, [zwiftId]: true }));
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/verification/strava-power-curve/${zwiftId}?days=90`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setStravaByRider(prev => ({
          ...prev,
          [zwiftId]: {
            power: prev[zwiftId]?.power ?? EMPTY_POWER,
            activityCount: prev[zwiftId]?.activityCount ?? null,
            error: data.message ?? 'Failed to load Strava data',
          },
        }));
        return;
      }
      const curve: Record<string, number> = data.curve ?? {};
      setStravaByRider(prev => ({
        ...prev,
        [zwiftId]: {
          power: powerFromStravaCurve(curve, weightKg, prev[zwiftId]?.power),
          activityCount: typeof data.activityCount === 'number' ? data.activityCount : null,
        },
      }));
    } catch (e: unknown) {
      setStravaByRider(prev => ({
        ...prev,
        [zwiftId]: {
          power: prev[zwiftId]?.power ?? EMPTY_POWER,
          activityCount: prev[zwiftId]?.activityCount ?? null,
          error: e instanceof Error ? e.message : 'Error loading Strava data',
        },
      }));
    } finally {
      setLoadingStravaIds(prev => {
        const next = { ...prev };
        delete next[zwiftId];
        return next;
      });
    }
  }

  async function handleLoadStrava() {
    if (!selectedZwiftId) return;
    const kg = shared.weightKg > 0 ? shared.weightKg : (selectedParticipant?.weightInGrams ?? 0) / 1000;
    await loadStravaForRider(selectedZwiftId, kg);
  }

  async function handleLoadStravaAll() {
    const pending = visibleRiders.filter(p => {
      const entry = stravaByRider[p.zwiftId];
      return !entry || Boolean(entry.error);
    });
    if (pending.length === 0) return;
    setBulkStravaProgress({ done: 0, total: pending.length });
    let done = 0;
    for (const p of pending) {
      const kg = (p.weightInGrams ?? 0) / 1000;
      await loadStravaForRider(p.zwiftId, kg);
      done += 1;
      setBulkStravaProgress({ done, total: pending.length });
    }
    setBulkStravaProgress(null);
  }

  async function submitAssign(zwiftId: string, veloToSend: number): Promise<void> {
    if (!user) return;
    setAssigningZwiftId(zwiftId);
    setAssignResult(null);
    setAssignError('');
    setAssignErrors(prev => {
      const next = { ...prev };
      delete next[zwiftId];
      return next;
    });
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/liga-categories/${zwiftId}/predict-assign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ predictedVelo: veloToSend }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.message ?? 'Assignment failed';
        if (zwiftId === selectedZwiftId) setAssignError(message);
        setAssignErrors(prev => ({ ...prev, [zwiftId]: message }));
        return;
      }
      const category = data.category as string;
      setAssignedOverlay(prev => ({ ...prev, [zwiftId]: category }));
      if (zwiftId === selectedZwiftId) setAssignResult({ category });
      void queryClient.invalidateQueries({ queryKey: ['participants'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'liga-categories'] });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Assignment failed';
      if (zwiftId === selectedZwiftId) setAssignError(message);
      setAssignErrors(prev => ({ ...prev, [zwiftId]: message }));
    } finally {
      setAssigningZwiftId(null);
    }
  }

  async function handleAssign() {
    if (!selectedZwiftId) return;
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
    await submitAssign(selectedZwiftId, veloToSend);
  }

  async function handleRosterAssign(zwiftId: string, choice: string) {
    const p = participants.find(pp => pp.zwiftId === zwiftId);
    if (!p) return;
    let veloToSend: number | null = null;
    if (choice === 'zwift') {
      veloToSend = predictionFromInputs(model, inputsFromParticipant(p)).velo;
    } else if (choice === 'strava') {
      veloToSend = predictionFromStravaCache(model, p, stravaByRider[zwiftId]).velo;
    } else {
      veloToSend = veloForCategory(choice);
    }
    if (veloToSend == null || veloToSend <= 0) {
      setAssignErrors(prev => ({ ...prev, [zwiftId]: 'Could not compute a vELO for the chosen category' }));
      return;
    }
    await submitAssign(zwiftId, veloToSend);
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
    if (source === 'zwift') {
      setZwiftPower(prev => ({ ...prev, [field]: next }));
      return;
    }
    if (!selectedZwiftId) return;
    setStravaByRider(prev => ({
      ...prev,
      [selectedZwiftId]: {
        power: { ...(prev[selectedZwiftId]?.power ?? EMPTY_POWER), [field]: next },
        activityCount: prev[selectedZwiftId]?.activityCount ?? null,
      },
    }));
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

  return (
    <div className="space-y-8">
      <div className="bg-muted/40 border border-border rounded-lg p-4 text-sm text-muted-foreground space-y-1">
        <p>
          <span className="font-medium text-foreground">What this tool does:</span> Riders with thin Zwift profiles
          may not have a ZwiftRacing vELO score, so the automatic category assignment can&apos;t place them. This tool
          fits a linear model from riders <em>who do</em> have vELO scores, then uses it to predict a vELO for
          any rider based on their power data — from Zwift and from Strava side by side — and assigns them a starting
          category using the same engine as the nightly job.
        </p>
        <p>
          <span className="font-medium text-foreground">Workflow:</span> Review the model fit, then use the
          overview table to scan every filtered rider&apos;s vELO category and predicted category band. Load Strava
          when you need outdoor power. Click a name for the detailed form, or assign directly from the table.
          Assignments are a <em>manual hold</em>: nightly auto-assign will not overwrite them until you release
          them from Categories.
        </p>
      </div>

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

      <CategoryPredictorRoster
        riders={visibleRiders}
        model={model}
        selectedZwiftId={selectedZwiftId}
        onSelectRider={zwiftId => handleSelectRider(zwiftId, true)}
        showUnassignedOnly={showUnassignedOnly}
        onSetShowUnassignedOnly={setShowUnassignedOnly}
        showMismatchOnly={showMismatchOnly}
        onSetShowMismatchOnly={setShowMismatchOnly}
        stravaByRider={stravaByRider}
        loadingStravaIds={loadingStravaIds}
        bulkStravaProgress={bulkStravaProgress}
        onLoadStrava={zwiftId => {
          const p = participants.find(pp => pp.zwiftId === zwiftId);
          const kg = (p?.weightInGrams ?? 0) / 1000;
          void loadStravaForRider(zwiftId, kg);
        }}
        onLoadStravaAll={() => { void handleLoadStravaAll(); }}
        assignedOverlay={assignedOverlay}
        assigningZwiftId={assigningZwiftId}
        assignErrors={assignErrors}
        onAssign={(zwiftId, choice) => { void handleRosterAssign(zwiftId, choice); }}
      />

      <CategoryPredictorForm
        participants={participants}
        selectedZwiftId={selectedZwiftId}
        onSelectRider={handleSelectRider}
        showUnassignedOnly={showUnassignedOnly}
        onSetShowUnassignedOnly={setShowUnassignedOnly}
        showMismatchOnly={showMismatchOnly}
        onSetShowMismatchOnly={setShowMismatchOnly}
        loadingStrava={Boolean(selectedZwiftId && loadingStravaIds[selectedZwiftId])}
        onLoadStrava={handleLoadStrava}
        stravaError={selectedStrava?.error ?? ''}
        zwiftRideCount={selectedParticipant?.zwiftActivityCount ?? null}
        stravaRideCount={selectedStrava?.activityCount ?? null}
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
        assigning={assigningZwiftId === selectedZwiftId}
        onAssign={handleAssign}
        assignResult={assignResult}
        assignError={assignError}
        assignedOverlay={assignedOverlay}
      />
    </div>
  );
}
