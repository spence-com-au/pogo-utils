/**
 * Where PGSharp draws its overlay, and the near-white it draws it in. The overlay states the level and the three IVs
 * outright, which the scan now reads off the export instead — so nothing reads the box any more. What is left is its
 * geometry, which `config.mts` takes as a default, and the luminance and chroma `detail.mts` reads a CP by, the detail
 * screen's CP being the same near-white text.
 */

/** Where PGSharp draws its overlay, as fractions of the screen's width and height. */
export interface OverlayBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bright enough to be the overlay's white text, and flat enough in colour not to be its IV percentage. */
export const OVERLAY_LUMINANCE = 150;
export const OVERLAY_CHROMA = 55;

/** Three small numbers separated by slashes: PGSharp's overlay, which `detail.mts` tells from a name line by it. */
export const TRIPLE = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/;
