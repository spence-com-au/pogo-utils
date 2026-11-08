/**
 * The pure functions behind the `find-missing-events` skill's audit, which decide what it reports and so what a reader
 * never sees: `latestDateNamed` dates an announcement from its prose, `slugOf` keys an article against a source, and
 * `containment` pairs a headline with an event it may be about.
 *
 * Here rather than beside the scripts because the suite only looks under `src/`. The scripts themselves fetch the live
 * site, which no test should; these are the parts of them that need no network.
 */

import { containment, tokens } from '../.claude/skills/find-missing-events/scripts/matching.mts';
import { latestDateNamed, slugOf } from '../.claude/skills/find-missing-events/scripts/newsroom.mts';
import { describe, expect, test } from 'vitest';

describe('latestDateNamed', () => {
  test.each([
    // Month and year alone: the day is assumed late in the month so that "through March 2027" is not read as expiring
    // on the 1st, and 28 is the one day every month has.
    ['through March 2027', '2027-03-28'],
    ['February 2027', '2027-02-28'],
    ['September 28, 2026', '2026-09-28'],
    ['OCTOBER 3, 2026', '2026-10-03'],

    // A range must still reach the year, or a tour running into January 2027 reads as naming no dates at all. The date
    // is the range's end, in the month the end names where it names one.
    ['October 3–4, 2026', '2026-10-04'],
    ['October 3-4, 2026', '2026-10-04'],
    ['October 31 – November 1, 2026', '2026-11-01'],
    ['Oct 31 – November 1, 2026', '2026-11-01'],
    ['October 3 – Sunday 4, 2026', '2026-10-04'],

    // A start that omits its year is not a date by itself, but the end that carries the year still is one.
    ['Tuesday, October 13, at 10:00 a.m. to Monday, October 19, 2026, at 8:00 p.m. local time', '2026-10-19'],
  ])('%s is %s', (text, expected) => {
    expect(latestDateNamed(text)).toBe(expected);
  });

  test('a date that does not exist names nothing', () => {
    expect(latestDateNamed('February 30, 2027')).toBeUndefined();
    expect(latestDateNamed('September 31, 2026')).toBeUndefined();
    expect(latestDateNamed('February 29, 2027')).toBeUndefined();
  });

  test('February 29 exists in a leap year', () => {
    expect(latestDateNamed('February 29, 2028')).toBe('2028-02-29');
  });

  test('an impossible date does not hide a real one', () => {
    expect(latestDateNamed('February 30, 2027 and September 28, 2026')).toBe('2026-09-28');
  });

  test('the furthest date wins wherever in the text it falls', () => {
    expect(latestDateNamed('September 28, 2026, then March 2027, then January 2027')).toBe('2027-03-28');
    expect(latestDateNamed('March 2027, then September 28, 2026')).toBe('2027-03-28');
  });

  test.each([[''], ['a feature note with no date in it'], ['Sept 28 with no year']])('%j names no date', (text) => {
    expect(latestDateNamed(text)).toBeUndefined();
  });
});

describe('slugOf', () => {
  test.each([
    ['https://pokemongo.com/en/news/harvest-festival', 'harvest-festival'],
    ['https://pokemongo.com/news/harvest-festival', 'harvest-festival'],
    ['https://pokemongo.com/en/featured-in-person-events/citysafari/brisbane', 'brisbane'],
    ['harvest-festival', 'harvest-festival'],
    ['', ''],
  ])('%j is %j', (url, expected) => {
    expect(slugOf(url)).toBe(expected);
  });

  test('trailing slashes are not a segment', () => {
    expect(slugOf('https://pokemongo.com/en/news/harvest-festival/')).toBe('harvest-festival');
    expect(slugOf('https://pokemongo.com/en/news/harvest-festival///')).toBe('harvest-festival');
  });
});

describe('tokens', () => {
  const words = (text: string) => [...tokens(text)].toSorted();

  test('accents are folded, so the feed and a slug agree', () => {
    expect(words('Pokémon GO Fest Madrid')).toEqual(words('pokemon-go-fest-madrid'));
    expect(words('Pokémon GO Fest Madrid')).toEqual(['fest', 'madrid']);
  });

  test('underscores and hyphens separate words as spaces do', () => {
    expect(words('2026_ana_green')).toEqual(['2026', 'ana', 'green']);
    expect(words('city-safari-brisbane')).toEqual(['brisbane', 'city', 'safari']);
  });

  test('a trailing s is dropped from a longer word only', () => {
    expect(words('City Safaris')).toEqual(['city', 'safari']);
    expect(words('its')).toEqual(['its']);
  });

  test('words too common to separate anything are left out', () => {
    expect(words('The Pokémon GO event for a Community Day')).toEqual(['community', 'day', 'event']);
    expect(tokens('the of and').size).toBe(0);
  });
});

describe('containment', () => {
  test('a name inside a longer headline is wholly contained', () => {
    expect(
      containment('Harvest Festival: Taken Over', 'Rescue Shadow Zekrom during Harvest Festival: Taken Over!'),
    ).toBe(1);
  });

  test('it is not symmetric: the headline is not inside the name', () => {
    const headline = 'Rescue Shadow Zekrom during Harvest Festival: Taken Over!';
    const name = 'Harvest Festival: Taken Over';

    expect(containment(headline, name)).toBeLessThan(containment(name, headline));
  });

  test('a plural headline still reaches a singular name', () => {
    expect(containment('City Safari: Marseille', 'City Safaris in Europe')).toBeCloseTo(2 / 3);
  });

  test('a name sharing no word with the headline scores 0', () => {
    expect(containment('Harvest Festival', 'Wild Area')).toBe(0);
  });

  test('a name of nothing but common words scores 0 rather than NaN', () => {
    expect(containment('The Pokémon GO', 'Pokémon GO Fest')).toBe(0);
    expect(containment('', 'Pokémon GO Fest')).toBe(0);
  });
});
