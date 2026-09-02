import { describe, it, expect } from 'vitest';
import {
  combineInputs,
  inputsFromParticipant,
  predictionFromInputs,
  predictorFormLayout,
  hasPredictedVsImpliedMismatch,
  EMPTY_POWER,
  EMPTY_PREDICTION,
  type ModelResult,
  type Participant,
} from '@/components/admin/category-predictor/shared';

const MODEL: ModelResult = {
  coeffs: [200, 250],
  r2: 1,
  rmse: 40,
  n: 10,
  activeFeatureKeys: ['wkg20m'],
  trainingPoints: [],
};

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

describe('predictionFromInputs', () => {
  it('returns empty when power inputs are missing', () => {
    expect(predictionFromInputs(MODEL, combineInputs({ weightKg: 70, racingScore: 500 }, EMPTY_POWER)))
      .toEqual(EMPTY_PREDICTION);
  });

  it('produces independent Zwift and Strava predictions from the same model', () => {
    const shared = { weightKg: 70, racingScore: 500 };
    const zwift = predictionFromInputs(MODEL, combineInputs(shared, { ...EMPTY_POWER, wkg20m: 4.0 }));
    const strava = predictionFromInputs(MODEL, combineInputs(shared, { ...EMPTY_POWER, wkg20m: 4.4 }));

    expect(zwift.velo).toBe(1200);
    expect(strava.velo).toBe(1300);
    expect(zwift.category).toBe('Platinum');
    expect(strava.category).toBe('Amethyst');
    expect(zwift.velo).not.toBe(strava.velo);
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

describe('hasPredictedVsImpliedMismatch', () => {
  const model: ModelResult = {
    coeffs: [0, 300],
    r2: 1,
    rmse: 10,
    n: 10,
    activeFeatureKeys: ['wkg20m'],
    trainingPoints: [],
  };

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
    // 4.0 W/kg × 300 = 1200 → Platinum; 900 → Silver
    expect(hasPredictedVsImpliedMismatch(model, rider(900))).toBe(true);
  });

  it('is false when predicted and implied categories match', () => {
    expect(hasPredictedVsImpliedMismatch(model, rider(1200))).toBe(false);
  });

  it('is false when the rider has no actual vELO', () => {
    expect(hasPredictedVsImpliedMismatch(model, rider(0))).toBe(false);
    expect(hasPredictedVsImpliedMismatch(model, { ...rider(1200), max30Rating: 'N/A' })).toBe(false);
  });
});
