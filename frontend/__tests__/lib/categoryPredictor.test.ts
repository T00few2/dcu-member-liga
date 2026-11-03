import { describe, it, expect } from 'vitest';
import {
  inputsFromParticipant,
  predictorFormLayout,
  hasPredictedVsImpliedMismatch,
  filterPredictorRiders,
  formatVeloValue,
  powerFromStravaCurve,
  predictionFor,
  stravaInputsForRider,
  EMPTY_POWER,
  EMPTY_PREDICTION,
  type Participant,
  type PredictionMap,
  type PredictionSnapshot,
} from '@/components/admin/category-predictor/shared';

/** Backend predictions are plain data; the frontend only looks them up. */
function pred(velo: number, category: string): PredictionSnapshot {
  return { ...EMPTY_PREDICTION, velo, category, low: velo - 10, high: velo + 10, catLow: category, catHigh: category };
}

describe('inputsFromParticipant', () => {
  it('converts Zwift CP watts to W/kg', () => {
    const p: Participant = {
      name: 'Test',
      zwiftId: '1',
      weightInGrams: 70000,
      cp5s: 1050,
      cp1min: 490,
      cp5min: 350,
      cp20min: 280,
      racingScore: 640,
      max30Rating: 1100,
      ligaCategory: null,
    };
    expect(inputsFromParticipant(p)).toEqual({
      weightKg: 70,
      wkg5s: 15,
      wkg1m: 7,
      wkg5m: 5,
      wkg20m: 4,
      racingScore: 640,
    });
  });
});

describe('predictionFor', () => {
  it('returns the backend prediction for a rider, or an empty one', () => {
    const map: PredictionMap = { '1': pred(1200, 'Platinum') };
    expect(predictionFor(map, '1').velo).toBe(1200);
    expect(predictionFor(map, '2')).toEqual(EMPTY_PREDICTION);
    expect(predictionFor(undefined, '1')).toEqual(EMPTY_PREDICTION);
  });
});

describe('stravaInputsForRider', () => {
  const rider: Participant = {
    name: 'Test', zwiftId: '1', weightInGrams: 70000, cp5s: null, cp1min: null, cp5min: null, cp20min: null,
    racingScore: 500, max30Rating: 1100, ligaCategory: null,
  };

  it('combines profile weight and ZRS with the loaded Strava power', () => {
    const power = { ...EMPTY_POWER, wkg20m: 4.2 };
    expect(stravaInputsForRider(rider, { power, activityCount: 12 })).toEqual({
      weightKg: 70, racingScore: 500, wkg5s: 0, wkg1m: 0, wkg5m: 0, wkg20m: 4.2,
    });
  });

  it('is null when Strava is not loaded or failed', () => {
    expect(stravaInputsForRider(rider, undefined)).toBeNull();
    expect(stravaInputsForRider(rider, { power: EMPTY_POWER, activityCount: null, error: 'x' })).toBeNull();
  });
});

describe('predictorFormLayout', () => {
  it('hides ZRS and unused power rows for the default regressor set', () => {
    const layout = predictorFormLayout(['weight_kg', 'wkg1m', 'wkg20m', 'compound5m']);
    expect(layout.showWeight).toBe(true);
    expect(layout.showZrs).toBe(false);
    expect(layout.powerRows.map(r => r.field)).toEqual(['wkg1m', 'wkg5m', 'wkg20m']);
    expect(layout.powerRows.find(r => r.field === 'wkg5m')?.compoundLabel).toBe('5m²/kg (auto)');
    expect(layout.powerRows.find(r => r.field === 'wkg5m')?.wattsLabel).toBeNull();
  });

  it('shows derived watts rows when those regressors are active', () => {
    const layout = predictorFormLayout(['wkg5s', 'watts5s', 'compound5s']);
    expect(layout.powerRows).toHaveLength(1);
    expect(layout.powerRows[0].wattsLabel).toBe('5s watts (auto)');
    expect(layout.powerRows[0].compoundLabel).toBe('5s²/kg (auto)');
  });

  it('shows ZRS only when that regressor is active', () => {
    expect(predictorFormLayout(['zrs']).showZrs).toBe(true);
    expect(predictorFormLayout(['zrs']).usesPower).toBe(false);
  });
});

describe('powerFromStravaCurve', () => {
  it('converts watts to W/kg using rider weight', () => {
    expect(powerFromStravaCurve({ w5: 1050, w60: 490, w300: 350, w1200: 280 }, 70)).toEqual({
      wkg5s: 15,
      wkg1m: 7,
      wkg5m: 5,
      wkg20m: 4,
    });
  });

  it('keeps previous values when a duration is missing', () => {
    expect(powerFromStravaCurve({ w1200: 280 }, 70, { ...EMPTY_POWER, wkg1m: 6 })).toEqual({
      wkg5s: 0,
      wkg1m: 6,
      wkg5m: 0,
      wkg20m: 4,
    });
  });
});

describe('filterPredictorRiders', () => {
  // Every rider's Zwift power predicts 1200 → Platinum.
  const model: PredictionMap = {
    '1': pred(1200, 'Platinum'), '2': pred(1200, 'Platinum'), '3': pred(1200, 'Platinum'),
  };
  const base = {
    weightInGrams: 70000,
    cp5s: 1000,
    cp1min: 400,
    cp5min: 300,
    cp20min: 280,
    racingScore: 500,
  };

  it('returns riders sorted by name and honors unassigned / mismatch filters', () => {
    const riders: Participant[] = [
      { ...base, name: 'Zoe', zwiftId: '3', max30Rating: 1200, ligaCategory: { category: 'Gold' } },
      { ...base, name: 'Ada', zwiftId: '1', max30Rating: 900, ligaCategory: null },
      { ...base, name: 'Bea', zwiftId: '2', max30Rating: 1200, ligaCategory: null },
    ];
    expect(filterPredictorRiders(riders, model, { unassignedOnly: false, mismatchOnly: false }).map(p => p.name))
      .toEqual(['Ada', 'Bea', 'Zoe']);
    expect(filterPredictorRiders(riders, model, { unassignedOnly: true, mismatchOnly: false }).map(p => p.zwiftId))
      .toEqual(['1', '2']);
    expect(filterPredictorRiders(riders, model, { unassignedOnly: false, mismatchOnly: true }).map(p => p.zwiftId))
      .toEqual(['1']);
  });

  it('treats session overlay assigns as assigned', () => {
    const riders: Participant[] = [
      { ...base, name: 'Ada', zwiftId: '1', max30Rating: 900, ligaCategory: null },
    ];
    expect(filterPredictorRiders(riders, model, { unassignedOnly: true, mismatchOnly: false, assignedOverlay: { '1': 'Platinum' } }))
      .toEqual([]);
  });

  it('can isolate riders with vELO 0 or missing', () => {
    const riders: Participant[] = [
      { ...base, name: 'Ada', zwiftId: '1', rating: 900, max30Rating: 0, ligaCategory: null },
      { ...base, name: 'Bea', zwiftId: '2', rating: 0, max30Rating: 900, ligaCategory: null },
      { ...base, name: 'Cara', zwiftId: '3', rating: 'N/A', max30Rating: 900, ligaCategory: null },
    ];
    expect(filterPredictorRiders(riders, model, { unassignedOnly: false, mismatchOnly: false, zeroVeloOnly: true }).map(p => p.name))
      .toEqual(['Bea', 'Cara']);
  });

  it('can isolate riders without a 30d vELO score', () => {
    const riders: Participant[] = [
      { ...base, name: 'Ada', zwiftId: '1', rating: 0, max30Rating: 900, ligaCategory: null },
      { ...base, name: 'Bea', zwiftId: '2', rating: 900, max30Rating: 0, ligaCategory: null },
      { ...base, name: 'Cara', zwiftId: '3', rating: 900, max30Rating: 'N/A', ligaCategory: null },
    ];
    expect(filterPredictorRiders(riders, model, { unassignedOnly: false, mismatchOnly: false, no30dVeloOnly: true }).map(p => p.name))
      .toEqual(['Bea', 'Cara']);
  });
});

describe('formatVeloValue', () => {
  it('rounds numeric scores and treats missing values as empty', () => {
    expect(formatVeloValue(1100.4)).toBe('1100');
    expect(formatVeloValue(0)).toBe('0');
    expect(formatVeloValue('N/A')).toBeNull();
    expect(formatVeloValue(null)).toBeNull();
  });
});

describe('hasPredictedVsImpliedMismatch', () => {
  const predictions: PredictionMap = { '1': pred(1200, 'Platinum') };

  function rider(max30Rating: number): Participant {
    return {
      name: 'Test',
      zwiftId: '1',
      weightInGrams: 70000,
      cp5s: 1000,
      cp1min: 400,
      cp5min: 300,
      cp20min: 280,
      racingScore: 500,
      max30Rating,
      ligaCategory: { category: 'Gold' },
    };
  }

  it('is true when predicted category differs from the vELO-implied category', () => {
    // predicted 1200 → Platinum; actual 900 → Silver
    expect(hasPredictedVsImpliedMismatch(rider(900), predictions)).toBe(true);
  });

  it('is false when predicted and implied categories match', () => {
    expect(hasPredictedVsImpliedMismatch(rider(1200), predictions)).toBe(false);
  });

  it('is false when the rider has no actual vELO', () => {
    expect(hasPredictedVsImpliedMismatch(rider(0), predictions)).toBe(false);
    expect(hasPredictedVsImpliedMismatch({ ...rider(1200), max30Rating: 'N/A' }, predictions)).toBe(false);
  });

  it('is false when the backend has no prediction for the rider', () => {
    expect(hasPredictedVsImpliedMismatch(rider(900), {})).toBe(false);
  });
});
