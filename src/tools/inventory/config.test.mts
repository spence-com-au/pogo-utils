/**
 * What `--config` does to `DEFAULTS`: a file that changes one tap changes that tap, and leaves every other setting as
 * it was rather than dropping the rest of its group.
 */

import { configWith, DEFAULTS } from './config.mts';
import { expect, test } from 'vitest';

// `toEqual` where the whole config is compared, `configWith` spelling out the `overlay` that `DEFAULTS` leaves out.
test('an empty file is the defaults', () => {
  expect(configWith({})).toEqual(DEFAULTS);
});

test('one tap changed leaves the rest of the taps, and every other group, as they were', () => {
  const config = configWith({ taps: { search: [0.5, 0.2] } });

  expect(config.taps).toStrictEqual({ ...DEFAULTS.taps, search: [0.5, 0.2] });
  expect({ ...config, taps: DEFAULTS.taps }).toEqual(DEFAULTS);
});

test.for(['swipes', 'waits', 'scrollBand'] as const)('one setting in `%s` is laid over the rest of it', (group) => {
  const [field] = Object.keys(DEFAULTS[group]);
  const changed = { [field as string]: 'changed' };

  expect(configWith({ [group]: changed })[group]).toStrictEqual({ ...DEFAULTS[group], ...changed });
});

test('a package is taken only as a string', () => {
  expect(configWith({ package: 'com.example.game' }).package).toBe('com.example.game');
  expect(configWith({ package: { name: 'com.example.game' } }).package).toBe(DEFAULTS.package);
});

test('a package that is not an Android package name is refused', () => {
  expect(() => configWith({ package: 'com.example.game; reboot' })).toThrow('not an Android package name');
});

test('an overlay box is taken whole, there being none by default', () => {
  const overlay = { x: 10, y: 200, width: 300, height: 40 };

  expect(DEFAULTS.overlay).toBeUndefined();
  expect(configWith({ overlay }).overlay).toBe(overlay);
});

test('a "user" is taken where it is a whole number and refused otherwise', () => {
  expect(configWith({ user: 10 }).user).toBe(10);
  expect(configWith({}).user).toBeUndefined();
  expect(() => configWith({ user: -1 })).toThrow('an Android user is a whole number');
  expect(() => configWith({ user: '10' })).toThrow('an Android user is a whole number');
});
