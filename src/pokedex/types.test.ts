/**
 * The ink a type badge writes its name in, which has to read on the type's own colour: the game's palette runs from
 * Dragon's deep blue to Electric's pale yellow, and white on the light half of it is under 2:1.
 */

import { expect, test } from 'vitest';

import { inkOn, TYPE_PAINT } from './types.js';

/** WCAG's contrast ratio between two `#rrggbb` colours, written out here rather than imported from what it checks. */
function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
      const c = parseInt(hex.slice(at, at + 2), 16) / 255;

      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const [lo, hi] = [lum(a), lum(b)].sort((x, y) => x - y);

  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

test('every type writes its name in an ink that reads at 4.5:1 on its colour', () => {
  for (const [type, { colour }] of Object.entries(TYPE_PAINT)) {
    const ink = inkOn(type);

    expect(contrast(ink, colour), type).toBeGreaterThanOrEqual(4.5);
  }

  // The two ends of the palette, so a rule answering one ink for every type cannot pass.
  expect(inkOn('Electric')).toBe('#000000');
  expect(inkOn('Dragon')).toBe('#ffffff');
});
