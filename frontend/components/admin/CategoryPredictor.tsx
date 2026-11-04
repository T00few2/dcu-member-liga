'use client';

import { useState, useEffect, useMemo } from 'react';
import { User } from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';
import {
  useParticipantsQuery,
  usePredictorConfigQuery,
  usePredictorModelQuery,
  usePredictionsQuery,
  useDebouncedValue,
  useLeagueSettingsQuery,
  type PredictRow,
} from '@/hooks/queries';
import { effectiveLigaCategories } from '@/lib/ligaCategories';
import {
  veloForCategory,
  inputsFromParticipant,
  combineInputs,
  predictionFor,
  stravaInputsForRider,
  EMPTY_PREDICTION,
  actualVeloFromParticipant,
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
  stravaCurvesFromResponse,
  correctedStravaCurve,
} from './category-predictor/shared';
import CategoryPredictorResults from './category-predictor/CategoryPredictorResults';
import CategoryPredictorForm from './category-predictor/CategoryPredictorForm';
import CategoryPredictorRoster from './category-predictor/CategoryPredictorRoster';
import CategoryPredictorTuning from './category-predictor/CategoryPredictorTuning';

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
  const { data: leagueSettings } = useLeagueSettingsQuery();
  const ligaCats = useMemo(() => effectiveLigaCategories(leagueSettings), [leagueSettings]);

  // The model lives in the backend (single source of truth). Toggling features
  // previews an unsaved selection; "Save as default" stores it for everyone,
  // including the division agent.
  const [selectedFeatures, setSelectedFeatures] = useState<Record<FeatureKey, boolean> | null>(null);
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  const [savedFeedback, setSavedFeedback] = useState(false);

  // Re-seed the checkboxes whenever the saved config changes (first load, Save,
  // Apply of a tuning run, Roll back), so the page never previews stale regressors
  // on top of newly saved settings.
  const savedConfigKey = predictorConfig?.config
    ? `${predictorConfig.updatedAt ?? 'initial'}:${JSON.stringify(predictorConfig.config.features)}`
    : null;
  useEffect(() => {
    if (savedConfigKey && savedConfigKey !== seededFrom && predictorConfig?.config?.features) {
      setSelectedFeatures(predictorConfig.config.features);
      setSeededFrom(savedConfigKey);
    }
  }, [savedConfigKey, seededFrom, predictorConfig]);

  const featuresForModel = useDebouncedValue(selectedFeatures, 300);
  const featuresSettled = JSON.stringify(featuresForModel) === JSON.stringify(selectedFeatures);
  const {
    data: modelData,
    isLoading: loadingModel,
    isPlaceholderData: modelIsPrevious,
    error: modelError,
  } = usePredictorModelQuery(featuresForModel);
  const model = modelData?.model ?? null;
  const featureDefs = useMemo(() => modelData?.features ?? [], [modelData]);
  // Only offer predictions that belong to the current regressor selection: while a
  // new model is loading, the previous one's numbers must not be assignable.
  const zwiftPredictions = !modelIsPrevious && featuresSettled ? modelData?.predictions : undefined;
  const stravaWindowDays = predictorConfig?.config?.stravaWindowDays ?? 90;
  const stravaPowerScale = predictorConfig?.config?.stravaPowerScale;
  const activeFeatureKeys = useMemo(
    () => featureDefs.filter(f => selectedFeatures?.[f.key]).map(f => f.key),
    [featureDefs, selectedFeatures],
  );

  const [selectedZwiftId, setSelectedZwiftId] = useState('');
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [showMismatchOnly, setShowMismatchOnly] = useState(false);
  const [showZeroVeloOnly, setShowZeroVeloOnly] = useState(false);
  const [showNo30dVeloOnly, setShowNo30dVeloOnly] = useState(false);
  const [stravaRaw, setStravaByRider] = useState<Record<string, StravaRiderCache>>({});
  // Loaded Strava curves are corrected with the *current* outdoor→indoor correction every
  // render, so a newly applied config (or a load finishing after it) never keeps an old
  // correction. Entries without `curves` (typed by hand) are used as they are.
  const stravaByRider = useMemo<Record<string, StravaRiderCache>>(() => {
    const out: Record<string, StravaRiderCache> = {};
    for (const [id, entry] of Object.entries(stravaRaw)) {
      out[id] = entry.curves && entry.weightKg
        ? { ...entry, power: powerFromStravaCurve(correctedStravaCurve(entry.curves, stravaPowerScale), entry.weightKg, entry.power) }
        : entry;
    }
    return out;
  }, [stravaRaw, stravaPowerScale]);
  const [loadingStravaIds, setLoadingStravaIds] = useState<Record<string, true>>({});
  const [bulkStravaProgress, setBulkStravaProgress] = useState<{ done: number; total: number } | null>(null);
  const [shared, setShared] = useState<SharedInputs>(EMPTY_SHARED);
  const [zwiftPower, setZwiftPower] = useState<PowerInputs>(EMPTY_POWER);
  const [assignChoice, setAssignChoice] = useState('zwift');
  const [assigningZwiftId, setAssigningZwiftId] = useState<string | null>(null);
  const [releasingZwiftId, setReleasingZwiftId] = useState<string | null>(null);
  const [assignResult, setAssignResult] = useState<{ category: string } | null>(null);
  const [assignError, setAssignError] = useState('');
  const [assignErrors, setAssignErrors] = useState<Record<string, string>>({});
  const [assignedOverlay, setAssignedOverlay] = useState<Record<string, string>>({});

  const selectedStrava = selectedZwiftId ? stravaByRider[selectedZwiftId] : undefined;
  const stravaPower = selectedStrava?.power ?? EMPTY_POWER;

  // Form predictions (editable inputs) — debounced so typing does not fire a request per key.
  const formRows = useMemo<PredictRow[]>(() => [
    { id: 'zwift', inputs: combineInputs(shared, zwiftPower) },
    {
      id: 'strava',
      inputs: combineInputs(shared, stravaPower),
      source: 'strava',
      activityCount: selectedStrava?.activityCount ?? null,
    },
  ], [shared, zwiftPower, stravaPower, selectedStrava?.activityCount]);
  const debouncedFormRows = useDebouncedValue(formRows, 300);
  const { data: formPredictions, isPlaceholderData: formIsPrevious } = usePredictionsQuery(
    debouncedFormRows,
    featuresForModel,
  );
  // Predictions are shown (and assignable) only when they were computed for exactly
  // the inputs on screen; after switching rider or typing, the form waits for the
  // new result instead of offering the previous rider's vELO.
  const formCurrent = !formIsPrevious && featuresSettled
    && JSON.stringify(debouncedFormRows) === JSON.stringify(formRows);
  const zwiftPrediction = formCurrent ? predictionFor(formPredictions, 'zwift') : EMPTY_PREDICTION;
  const stravaPrediction = formCurrent ? predictionFor(formPredictions, 'strava') : EMPTY_PREDICTION;

  // Strava predictions for every rider whose Strava power has been loaded.
  const stravaRows = useMemo<PredictRow[]>(() => participants.flatMap(p => {
    const inputs = stravaInputsForRider(p, stravaByRider[p.zwiftId]);
    return inputs
      ? [{ id: p.zwiftId, inputs, source: 'strava' as const, activityCount: stravaByRider[p.zwiftId]?.activityCount ?? null }]
      : [];
  }), [participants, stravaByRider]);
  const { data: stravaPredictionsData, isPlaceholderData: stravaIsPrevious } = usePredictionsQuery(
    stravaRows,
    featuresForModel,
  );
  const stravaPredictions = !stravaIsPrevious && featuresSettled ? stravaPredictionsData : undefined;

  const selectedParticipant = participants.find(p => p.zwiftId === selectedZwiftId) ?? null;
  const actualVelo = selectedParticipant ? actualVeloFromParticipant(selectedParticipant) : null;

  const visibleRiders = useMemo(
    () => filterPredictorRiders(participants, zwiftPredictions, {
      unassignedOnly: showUnassignedOnly,
      mismatchOnly: showMismatchOnly,
      zeroVeloOnly: showZeroVeloOnly,
      no30dVeloOnly: showNo30dVeloOnly,
      assignedOverlay,
    }),
    [participants, zwiftPredictions, showUnassignedOnly, showMismatchOnly, showZeroVeloOnly, showNo30dVeloOnly, assignedOverlay],
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
      const res = await fetch(`${API_URL}/admin/verification/strava-power-curve/${zwiftId}?days=${stravaWindowDays}`, {
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
      // Keep the raw indoor/outdoor curves: the outdoor→indoor correction is applied here
      // with the active config, and re-applied when that config changes.
      const curves = stravaCurvesFromResponse(data);
      setStravaByRider(prev => ({
        ...prev,
        [zwiftId]: {
          power: prev[zwiftId]?.power ?? EMPTY_POWER, // fallback only; corrected from `curves` at render
          activityCount: typeof data.activityCount === 'number' ? data.activityCount : null,
          curves,
          weightKg,
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
      const mid = veloForCategory(assignChoice, ligaCats);
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
      veloToSend = predictionFor(zwiftPredictions, zwiftId).velo;
    } else if (choice === 'strava') {
      veloToSend = predictionFor(stravaPredictions, zwiftId).velo;
    } else {
      veloToSend = veloForCategory(choice, ligaCats);
    }
    if (veloToSend == null || veloToSend <= 0) {
      setAssignErrors(prev => ({ ...prev, [zwiftId]: 'Could not compute a vELO for the chosen category' }));
      return;
    }
    await submitAssign(zwiftId, veloToSend);
  }

  async function handleRelease(zwiftId: string, name: string) {
    if (!user) return;
    if (!confirm(`Release the manual category assignment for ${name}?\n\nNightly auto-assign from vELO will apply again.`)) return;
    setReleasingZwiftId(zwiftId);
    setAssignErrors(prev => {
      const next = { ...prev };
      delete next[zwiftId];
      return next;
    });
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/liga-categories/${zwiftId}/release-manual`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setAssignErrors(prev => ({ ...prev, [zwiftId]: data.message ?? 'Release failed' }));
        return;
      }
      setAssignedOverlay(prev => {
        const next = { ...prev };
        delete next[zwiftId];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['participants'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'liga-categories'] });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Release failed';
      setAssignErrors(prev => ({ ...prev, [zwiftId]: message }));
    } finally {
      setReleasingZwiftId(null);
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
    if (source === 'zwift') {
      setZwiftPower(prev => ({ ...prev, [field]: next }));
      return;
    }
    if (!selectedZwiftId) return;
    setStravaByRider(prev => ({
      ...prev,
      [selectedZwiftId]: {
        // Start from the values on screen (already corrected); a hand edit drops `curves`.
        power: { ...(stravaByRider[selectedZwiftId]?.power ?? prev[selectedZwiftId]?.power ?? EMPTY_POWER), [field]: next },
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
    if (!user || !selectedFeatures) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/predictor/config`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: { features: selectedFeatures }, reason: 'Regressors saved from predictor page' }),
      });
      if (res.ok) {
        setSavedFeedback(true);
        setTimeout(() => setSavedFeedback(false), 2000);
        void queryClient.invalidateQueries({ queryKey: ['predictor'] });
      }
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-8">
      <div className="bg-muted/40 border border-border rounded-lg p-4 text-sm text-muted-foreground space-y-1">
        <p>
          <span className="font-medium text-foreground">What this tool does:</span> Riders with thin Zwift profiles
          may not have a ZwiftRacing vELO score, so the automatic category assignment can&apos;t place them. The
          backend predictor (the same one the division agent uses) fits a linear model from riders <em>who do</em>
          have vELO scores, then uses it to predict a vELO for
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
        loadingParticipants={loadingParticipants || loadingModel}
        model={model}
        modelError={modelError instanceof Error ? modelError.message : ''}
        featureDefs={featureDefs}
        selectedFeatures={selectedFeatures ?? {}}
        onToggleFeature={(key, enabled) =>
          setSelectedFeatures(prev => ({ ...(prev ?? modelData?.config.features ?? {}), [key]: enabled }) as Record<FeatureKey, boolean>)
        }
        onSaveDefaults={handleSaveDefaults}
        savedFeedback={savedFeedback}
        onResetFeatures={() => {
          if (modelData?.defaultFeatures) setSelectedFeatures({ ...modelData.defaultFeatures });
        }}
      />

      <CategoryPredictorTuning user={user} config={predictorConfig} />

      <CategoryPredictorRoster
        riders={visibleRiders}
        zwiftPredictions={zwiftPredictions}
        stravaPredictions={stravaPredictions}
        selectedZwiftId={selectedZwiftId}
        onSelectRider={zwiftId => handleSelectRider(zwiftId, true)}
        showUnassignedOnly={showUnassignedOnly}
        onSetShowUnassignedOnly={setShowUnassignedOnly}
        showMismatchOnly={showMismatchOnly}
        onSetShowMismatchOnly={setShowMismatchOnly}
        showZeroVeloOnly={showZeroVeloOnly}
        onSetShowZeroVeloOnly={setShowZeroVeloOnly}
        showNo30dVeloOnly={showNo30dVeloOnly}
        onSetShowNo30dVeloOnly={setShowNo30dVeloOnly}
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
        releasingZwiftId={releasingZwiftId}
        onRelease={(zwiftId, name) => { void handleRelease(zwiftId, name); }}
        categories={ligaCats}
      />

      <CategoryPredictorForm
        participants={participants}
        selectedZwiftId={selectedZwiftId}
        onSelectRider={handleSelectRider}
        showUnassignedOnly={showUnassignedOnly}
        onSetShowUnassignedOnly={setShowUnassignedOnly}
        showMismatchOnly={showMismatchOnly}
        onSetShowMismatchOnly={setShowMismatchOnly}
        showZeroVeloOnly={showZeroVeloOnly}
        onSetShowZeroVeloOnly={setShowZeroVeloOnly}
        showNo30dVeloOnly={showNo30dVeloOnly}
        onSetShowNo30dVeloOnly={setShowNo30dVeloOnly}
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
        rmse={model?.rmse ?? null}
        featureDefs={featureDefs}
        zwiftPredictions={zwiftPredictions}
        stravaWindowDays={stravaWindowDays}
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
        categories={ligaCats}
      />
    </div>
  );
}
