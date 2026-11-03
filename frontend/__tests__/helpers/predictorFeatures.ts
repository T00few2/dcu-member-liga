import type { FeatureMeta } from '@/components/admin/category-predictor/shared';

/** Feature metadata as `POST /admin/predictor/model` returns it (labels only; no model math). */
export const FEATURE_META: FeatureMeta[] = [
  { key: 'weight_kg', label: 'Weight (kg)', description: 'Raw rider weight.', requires: [] },
  { key: 'zrs', label: 'ZRS', description: 'Zwift Racing Score.', requires: ['racingScore'] },
  { key: 'wkg5s', label: '5s W/kg', description: '5-second peak power per kg.', requires: ['cp5s'] },
  { key: 'wkg1m', label: '1min W/kg', description: '1-minute power per kg.', requires: ['cp1min'] },
  { key: 'wkg5m', label: '5min W/kg', description: '5-minute power per kg.', requires: ['cp5min'] },
  { key: 'wkg20m', label: '20min W/kg', description: 'FTP proxy.', requires: ['cp20min'] },
  { key: 'watts5s', label: '5s watts', description: 'Absolute 5s watts.', requires: ['cp5s'] },
  { key: 'watts1m', label: '1min watts', description: 'Absolute 1min watts.', requires: ['cp1min'] },
  { key: 'watts5m', label: '5min watts', description: 'Absolute 5min watts.', requires: ['cp5min'] },
  { key: 'watts20m', label: '20min watts', description: 'Absolute 20min watts.', requires: ['cp20min'] },
  { key: 'compound5s', label: '5s²/kg', description: 'Sprint compound score.', requires: ['cp5s'] },
  { key: 'compound1m', label: '1m²/kg', description: 'Anaerobic compound score.', requires: ['cp1min'] },
  { key: 'compound5m', label: '5m²/kg', description: 'VO2max compound score.', requires: ['cp5min'] },
  { key: 'compound20m', label: '20m²/kg', description: 'FTP compound score.', requires: ['cp20min'] },
];
