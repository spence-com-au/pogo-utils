/**
 * Every country a GPX file names, each with the continent it groups under in the sidebar and the ISO 3166-1 alpha-2
 * code its flag is drawn from. One table, so a country's continent and code cannot drift out of step.
 *
 * Exactly those countries and no others: `validate-gpx.mts` checks both directions, so adding a country ahead of its
 * first route fails the lint as surely as forgetting to add it at all.
 *
 * The code is required, a country with no entry here being unflaggable and a PGSharp backup erroring rather than
 * importing it. The continent only groups the sidebar, which falls back to "Other" without one.
 *
 * Codes are alpha-2 so the flag emoji is derived rather than pasted in — "AU" is legible in a diff and two similar
 * flags are not. England is a subdivision, and carries the "GB-ENG" tag sequence Unicode gives it.
 */

/**
 * One country's entry: the alpha-2 code its flag is derived from, and the continent it groups under.
 *
 * Both fields are `string` and the table is keyed by `string`, rather than naming the codes, continents and countries
 * this one happens to hold. A country is a data change and lands on `master` on its own, so a type that enumerated the
 * rows would turn every such edit into a type edit as well — and the row set is already checked, better than a type
 * could: validate-gpx.mts reads it against the files in both directions. What the shape does buy is the row itself. A
 * misspelled `continent` is a type error where inference simply gave that country a field of its own and let the
 * sidebar file it under "Other".
 */
export interface Country {
  code: string;
  continent: string;
}

/**
 * Bound to a name rather than exported as a literal, because an `export default` takes an expression and there is
 * nowhere on one to write the annotation that makes the table `Record<string, Country>` rather than only the keys it
 * happens to hold.
 */
const COUNTRIES: Record<string, Country> = {
  'Australia': { code: 'AU', continent: 'Oceania' },
  'Brazil': { code: 'BR', continent: 'South America' },
  'England': { code: 'GB-ENG', continent: 'Europe' },
  'France': { code: 'FR', continent: 'Europe' },
  'Germany': { code: 'DE', continent: 'Europe' },
  'India': { code: 'IN', continent: 'Asia' },
  'Indonesia': { code: 'ID', continent: 'Asia' },
  'Japan': { code: 'JP', continent: 'Asia' },
  'Kiribati': { code: 'KI', continent: 'Oceania' },
  'Malaysia': { code: 'MY', continent: 'Asia' },
  'Mexico': { code: 'MX', continent: 'North America' },
  'New Zealand': { code: 'NZ', continent: 'Oceania' },
  'Philippines': { code: 'PH', continent: 'Asia' },
  'Portugal': { code: 'PT', continent: 'Europe' },
  'Russia': { code: 'RU', continent: 'Europe' },
  'Singapore': { code: 'SG', continent: 'Asia' },
  'South Korea': { code: 'KR', continent: 'Asia' },
  'Spain': { code: 'ES', continent: 'Europe' },
  'Taiwan': { code: 'TW', continent: 'Asia' },
  'United Arab Emirates': { code: 'AE', continent: 'Asia' },
  'United States': { code: 'US', continent: 'North America' },
};

export default COUNTRIES;
