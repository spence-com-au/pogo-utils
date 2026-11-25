import { expect, test } from 'vitest';

import { copyHint, detectPlatform } from './platform.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

test('an iPhone is iOS, whichever browser it is in', () => {
  expect(detectPlatform({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe('ios');
  expect(detectPlatform({ userAgent: IPHONE_CHROME, maxTouchPoints: 5 })).toBe('ios');
});

test('an iPad asking for the desktop page is told from a Mac by its touch screen', () => {
  expect(detectPlatform({ userAgent: MAC, maxTouchPoints: 5 })).toBe('ios');
  expect(detectPlatform({ userAgent: MAC, maxTouchPoints: 0 })).toBe('other');
});

test('an Android phone is Android', () => {
  expect(detectPlatform({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe('android');
});

test('a desktop is neither', () => {
  expect(detectPlatform({ userAgent: WINDOWS, maxTouchPoints: 0 })).toBe('other');
});

test('the copy hint gives each desktop its own shortcut and none on a phone', () => {
  expect(copyHint({ userAgent: MAC, maxTouchPoints: 0 })).toBe('Press ⌘C');
  expect(copyHint({ userAgent: WINDOWS, maxTouchPoints: 0 })).toBe('Press Ctrl+C');
  expect(copyHint({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe('Copy the selection');
  expect(copyHint({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe('Copy the selection');

  // A 'Macintosh' that reports touch is an iPad, so it takes the phone hint, not the Mac shortcut.
  expect(copyHint({ userAgent: MAC, maxTouchPoints: 5 })).toBe('Copy the selection');
});
