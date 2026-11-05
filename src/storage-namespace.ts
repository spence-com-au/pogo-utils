/**
 * The namespace every key this app owns sits under: the Pages path segment, since `localStorage` and `sessionStorage`
 * are keyed by origin and `spence.com.au` serves every repository published there — an unqualified name is not this
 * app's to claim.
 *
 * A module of its own, so a page keying its own choices does not depend on another page's to learn one string, and so
 * `src/backup.ts` sweeps the same prefix every key is built from. One spelling is what rules out the disagreement that
 * does harm: a transport sweeping a prefix shorter than the keys carry would carry the neighbouring site's keys along
 * with this app's.
 */

export const NAMESPACE = 'pogo-utils';

export const KEY_PREFIX = `${NAMESPACE}:`;
