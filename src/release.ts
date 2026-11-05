/**
 * What a vended release is, shared by the vend scripts that write one and the stores that read one back. Its own file
 * in the shared project, which declares neither the browser's globals nor Node's, so both halves can import it.
 */

export interface Release {
  /** The app's own version, as it names it: `1.272.2` for PGSharp, `r9` for the Coin Bag. */
  readonly version: string;

  /** Where the release is had: the versioned APK itself, or the page listing one release's downloads. */
  readonly url: string;
}

/** A release as the vended file holds it. */
export interface VendedRelease extends Release {
  /**
   * When the vend first found this release, as an ISO 8601 instant: roughly when it was released, give or take the hour
   * between runs. Kept across runs that find the same release, so a run with nothing new still changes nothing.
   */
  readonly firstSeen: string;
}

/**
 * The vended file's next contents: `release` stamped with when it was first seen. A release the previous file already
 * holds keeps its `firstSeen`, and only a new one reads the clock through `now`, so an unchanged file after a run still
 * means nothing was released.
 */
export function stampRelease(previous: Partial<VendedRelease>, release: Release, now: () => string): VendedRelease {
  return {
    ...release,
    firstSeen: previous.url === release.url && previous.firstSeen ? previous.firstSeen : now(),
  };
}
