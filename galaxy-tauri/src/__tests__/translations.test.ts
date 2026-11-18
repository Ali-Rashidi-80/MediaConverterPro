import { describe, it, expect } from 'bun:test';
import { TRANSLATIONS } from '../i18n/translations';

const collectKeysAndLeaves = (
  obj: Record<string, unknown>,
  prefix = ''
): { keys: string[]; empties: string[] } => {
  const keys: string[] = [];
  const empties: string[] = [];

  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (typeof val === 'string') {
      keys.push(fullKey);
      if (val.trim().length === 0) {
        empties.push(fullKey);
      }
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      const child = collectKeysAndLeaves(val as Record<string, unknown>, fullKey);
      keys.push(...child.keys);
      empties.push(...child.empties);
    }
  }
  return { keys: keys.sort(), empties };
};

describe('i18n translation parity', () => {
  it('has identical keys in Persian (fa) and English (en)', () => {
    const fa = collectKeysAndLeaves(TRANSLATIONS.fa as unknown as Record<string, unknown>);
    const en = collectKeysAndLeaves(TRANSLATIONS.en as unknown as Record<string, unknown>);

    expect(fa.keys).toEqual(en.keys);
    expect(fa.keys.length).toBeGreaterThan(200);
  });

  it('has non-empty strings for every leaf key in fa and en', () => {
    const fa = collectKeysAndLeaves(TRANSLATIONS.fa as unknown as Record<string, unknown>);
    const en = collectKeysAndLeaves(TRANSLATIONS.en as unknown as Record<string, unknown>);

    expect(fa.empties).toEqual([]);
    expect(en.empties).toEqual([]);
  });
});
