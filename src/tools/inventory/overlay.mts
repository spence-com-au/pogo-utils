/**
 * The near-white PGSharp draws its overlay in, and the three-slash pattern it prints the IVs as. Nothing reads the IVs
 * off the overlay any more — the scan reads them off the export — but `detail.mts` still reads a CP, which is the same
 * near-white text, and tells the overlay's line from a name by the slashes.
 */

/** Bright enough to be the overlay's white text, and flat enough in colour not to be its IV percentage. */
export const OVERLAY_LUMINANCE = 150;
export const OVERLAY_CHROMA = 55;

/** Three small numbers separated by slashes: PGSharp's overlay, which `detail.mts` tells from a name line by it. */
export const TRIPLE = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/;
