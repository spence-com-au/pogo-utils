import { expect, test, vi } from 'vitest';

import { stampRelease } from './release.js';

const release = { version: 'r9', url: 'https://github.com/example/releases/tag/r9' };
const FIRST_SEEN = '2026-10-12T16:00:59.536Z';

test('a release the previous file holds keeps its `firstSeen` without reading the clock', () => {
  const now = vi.fn(() => '2026-11-05T00:00:00.000Z');

  expect(stampRelease({ ...release, firstSeen: FIRST_SEEN }, release, now)).toEqual({
    ...release,
    firstSeen: FIRST_SEEN,
  });
  expect(now).not.toHaveBeenCalled();
});

test('a release at another URL is stamped with the clock', () => {
  const previous = { version: 'r8', url: 'https://github.com/example/releases/tag/r8', firstSeen: FIRST_SEEN };

  expect(stampRelease(previous, release, () => '2026-11-05T00:00:00.000Z')).toEqual({
    ...release,
    firstSeen: '2026-11-05T00:00:00.000Z',
  });
});

test('a previous file without a `firstSeen` is stamped with the clock', () => {
  expect(stampRelease({ url: release.url }, release, () => '2026-11-05T00:00:00.000Z').firstSeen).toBe(
    '2026-11-05T00:00:00.000Z',
  );
});
