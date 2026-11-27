/**
 * Line icons for buttons, drawn in the text colour of the button they sit in so they follow the theme and a button's
 * states. Each is one SVG path on a 24-unit grid. The eye pair is here rather than with the Search page that drew it
 * first because the Map page hides its entries with the same button, and one look for "hide" is the point.
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

/** Open while what it sits beside is shown, struck through while it is hidden. */
export const EYE_ICON = 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z';
export const EYE_OFF_ICON = `${EYE_ICON}M4 4l16 16`;
