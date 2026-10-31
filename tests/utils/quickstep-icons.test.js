import { describe, it, expect } from 'vitest';
import { normalizeStepIcon, STEP_ICON_PRESETS } from '../../src/utils/quickstep-icons.js';

describe('normalizeStepIcon', () => {
  it('returns null for empty or non-string values', () => {
    expect(normalizeStepIcon('')).toBeNull();
    expect(normalizeStepIcon('   ')).toBeNull();
    expect(normalizeStepIcon(null)).toBeNull();
    expect(normalizeStepIcon(42)).toBeNull();
  });

  it('keeps a single emoji intact, including multi-codepoint ones', () => {
    expect(normalizeStepIcon('⭐')).toBe('⭐');
    expect(normalizeStepIcon('🗂️')).toBe('🗂️');
  });

  it('truncates to the first grapheme', () => {
    expect(normalizeStepIcon('⭐🔥')).toBe('⭐');
    expect(normalizeStepIcon('ab')).toBe('a');
  });

  it('presets are all valid single graphemes', () => {
    for (const icon of STEP_ICON_PRESETS) expect(normalizeStepIcon(icon)).toBe(icon);
  });
});
