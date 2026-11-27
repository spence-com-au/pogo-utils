/**
 * Line icons for buttons, drawn in the text colour of the button they sit in so they follow the theme and a button's
 * states. Each is one SVG path on a 24-unit grid. The paths here are the ones both the Search page and the Map page
 * draw, so copying and hiding each wear one look across the site; a path only one page draws stays with that page.
 */

/** A path as an icon, 18px unless a stylesheet sizes it otherwise. */
export const icon = (path: string) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d={path} />
  </svg>
);

/** Copy, and the tick it turns into for a moment once a copy has worked. */
export const COPY_ICON = 'M8 8h12v12H8zM4 16V4h12';
export const DONE_ICON = 'M5 12l5 5L19 7';

/** Open while what it sits beside is shown, struck through while it is hidden. */
export const EYE_ICON = 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z';
export const EYE_OFF_ICON = `${EYE_ICON}M4 4l16 16`;
