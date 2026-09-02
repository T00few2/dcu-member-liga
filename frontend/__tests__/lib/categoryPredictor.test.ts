import { describe, it, expect } from 'vitest';
import {
  combineInputs,
  inputsFromParticipant,
  predictionFromInputs,
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
