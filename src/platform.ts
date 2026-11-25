/**
 * Which phone the page is open on, for offering only the build that will install there. Read off the user agent rather
 * than off a feature, since what differs is which app store's rules the device lives under, not anything a page can
 * probe.
 *
 * iPadOS has asked for desktop pages since 13 and says `Macintosh` like a Mac does. No Mac has a touch screen, so a
 * `Macintosh` that reports touch points is an iPad. A guess either way can be wrong — a browser can be told to claim
 * anything — which is why whatever reads this keeps a way to show everything.
 */

export type Platform = 'ios' | 'android' | 'other';

/** The two fields read, so a test can hand over any device without a browser. */
export interface Device {
  readonly userAgent: string;
  readonly maxTouchPoints: number;
}

export function detectPlatform({ userAgent, maxTouchPoints }: Device): Platform {
  if (/Android/i.test(userAgent)) {
    return 'android';
  }

  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) {
    return 'ios';
  }

  return 'other';
}

/** The document's own platform, or `other` where there is no navigator to ask. */
export function currentPlatform(): Platform {
  return typeof navigator === 'undefined' ? 'other' : detectPlatform(navigator);
}

/**
 * What the Copy button shows when the clipboard write is refused and the query is selected to copy by hand: the
 * platform's own copy shortcut to press, or, on a phone with no keyboard, an instruction that names no key.
 */
export function copyHint(device: Device): string {
  if (detectPlatform(device) !== 'other') {
    return 'Copy the selection';
  }

  return /Mac/.test(device.userAgent) ? 'Press ⌘C' : 'Press Ctrl+C';
}
