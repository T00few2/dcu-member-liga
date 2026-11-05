import { describe, expect, it } from 'vitest';
import { CODE_OF_CONDUCT_TEXT_URL, cleanCodeOfConductText } from '@/lib/codeOfConduct';

describe('Code of Conduct text', () => {
  it('reads the Google Doc as plain text', () => {
    expect(CODE_OF_CONDUCT_TEXT_URL).toMatch(/docs\.google\.com\/document\/d\/.+\/export\?format=txt$/);
  });

  it('drops the BOM, separator lines and extra blank lines', () => {
    const raw = '﻿Code of Conduct\r\nIndledning \r\n________________\r\n\r\n\r\n\r\n1. Formål';
    expect(cleanCodeOfConductText(raw)).toBe('Code of Conduct\nIndledning\n\n1. Formål');
  });
});
