---
name: find-missing-events
description: >-
  Cross-checks the official news list at pokemongo.com/en/news against data/events.json and the ScrapedDuck feed, finds
  announced regional or in-person events that neither source carries, and proposes entries for data/events.json. Use
  this whenever the user asks whether any events are missing, wants the event list checked, audited, refreshed or
  brought up to date, mentions comparing against pokemongo.com or the official news, asks why an announced event is not
  showing on the Events page, or wants a regional event added — even if they never name the news page or the feed.
---

# Finding events the Events page does not carry

The Events page merges two sources, and this skill audits the gap between them and Niantic's own announcements.

- **The ScrapedDuck feed** mirrors Leek Duck and covers the game's scheduled content thoroughly. It is the bulk of the
  page and needs no help. The page reads it from `data/events-feed.json`, an hourly copy, where `compare-sources.mts`
  below reads the live mirror — which is the right source for an audit, the copy being at most an hour behind it.
- **`data/events.json`** is the repository's own list, for events the feed does not carry. Every entry in it is a
  `regional-event` — a type ScrapedDuck never emits, registered locally in `src/pages/events.tsx` — because what Leek
  Duck systematically omits is the region-locked, in-person kind: City Safari, a campus festival, a mall tour, a
  national partnership.
- **`pokemongo.com`** is the source of truth for what has been announced, and is what this skill reads: the news
  archive, and the in-person events index beside it.

So the job is narrow: find the **regional or in-person events** that Niantic has announced and neither source names, and
offer to add them. That narrowness is the point — the news archive is mostly content the feed already has, and widening
the net past regional events fills the report with noise the maintainer has to re-reject every run.

## Read the sources before deciding anything

```sh
node .claude/skills/find-missing-events/scripts/compare-sources.mts
```

Run it from the checkout root; it takes about half a minute. It walks the **whole** news archive in **every language the
site publishes** — 408 articles across sixteen editions when this was written, not just the English front page — reads
the in-person index and the feed, and reports what no source accounts for as two lists: events that look missing, and
articles that look like they change an event we already carry. Each row carries the closest names the sources hold,
scored.

Three things about that walk are worth knowing, because each has already cost a run its answer.

- **The archive paginates on `?nr=<offset>`, and the plausible-looking `?no=<offset>` is silently ignored**, answering
  with the newest thirty however large you make it. A walk using `no` looks like it paginated and in fact reads page one
  over and over.
- **Reaching past the front page is the whole game for this skill.** The events this repository exists to hold are the
  long ones — an airline partnership, a national-trust season, a nine-stop tour, a six-month mall tour — and those are
  announced months ahead, so they are off the front page while still running. Four such events were live and invisible
  to a front-page audit. If you find yourself reading only the latest thirty articles, you are auditing the wrong set.
- **Reaching past English is the other half of it.** Each edition lists announcements the English one never does,
  because an event for one country is often announced only in that country's language: Día de Muertos in Mexico was in
  Spanish alone, and the Japanese edition alone held some fifty articles the English one did not. A row the English
  edition does not list is marked with the editions that do, like `dia-de-muertos-2026 [es-MX]`, and its date is read in
  that language — month names from Node's ICU, numeric dates such as `2026年10月27日` by pattern — so the date filter
  works the same on it as on any other.

Trust the matched half and spend your attention on what is left. Slug equality is reliable because Leek Duck derives its
slugs from these same announcements.

## Triage what the script leaves you

The report has two lists, and they are there for opposite reasons.

**"Announced, unaccounted for, and not yet over"** is the discovery list. Everything an article's own prose dates into
the future and no source names. That date filter is what makes a 400-article archive readable — an announcement worth
acting on has to say so itself, since a long-running event must state how long it runs while a Community Day can only
name its one weekend. The article's words decide, not `datePublished`, which dates the press release and is routinely
months out in either direction.

**"Undated, but naming something we hold"** is the correction list, and it exists because the date filter has one blind
spot it cannot close: an article that _changes_ an event gives no new date. "The event will be rescheduled to a later
date" names nothing, so a postponement is invisible to a filter built on future dates — which is exactly backwards,
because an update is worse than a gap. A gap omits an event; an update makes one we already publish wrong, and the
`events.ics` feed has already told subscribers when to turn up. So an undated article naming an event a source holds is
surfaced on a second, orthogonal signal: not _is this ahead of us_ but _does this touch something of ours_. Read these
for whether the dates we carry still hold. This list is ordered newest first and its tail is weak matches — a "GO Pass:
March" note scoring 0.50 against "GO Pass: September" — so it thins out as you go down rather than needing to be read
entire.

What reaches you in the discovery list divides two ways, and only the second is worth adding.

**It is not a regional event.** A ticketing update, a "Know Before You GO" venue guide, a "Save the Date", patch notes,
a GO Battle League rotation note, a season, a global event the feed simply names differently — none of these belong in
`data/events.json`. Check the candidate list first: a score near 1.00 usually means the feed or the local file already
has the event under other wording, which is a match the script declined to assert rather than a gap.

**It is an announced regional or in-person event that nothing here names.** Report these. A campus event, a mall tour, a
partnership with a venue or an airline, a city-specific celebration.

A date the parser failed to read would be filtered out silently, so the counts at the end of the report are printed for
a reason: before concluding that a specific event you suspected is genuinely absent, check it is not sitting in them.

Neither list is one-article-one-event, so resolve both by reading rather than by counting:

- **One article, several events.** A City Safari announcement covers three European cities; a "Save the Date" covers
  three GO Tour stops; a mall tour lists eleven venue windows across three countries. Some of those may already be
  present and some not.
- **Several articles, one event.** An announcement, a venue guide and a ticketing update are three articles about the
  same event.

## Read the articles you are unsure about

```sh
node .claude/skills/find-missing-events/scripts/read-article.mts <slug>
```

For a row marked with editions, pass the article's URL in the first of them instead,
`https://pokemongo.com/es-MX/news/dia-de-muertos-2026`, and use that URL as the entry's `link`: the English path does
answer for it, but in the article's own language, behind an English page around it.

This prints the article's `headline`, `link` and `image` — the last taken from its structured data, which is where
existing entries' image URLs come from character for character, so never retype one — then the date the script read, and
then the prose. It exits with an error on a slug that does not exist, which is worth trusting: `/en/news/<slug>` returns
a real 404 (so does any `/<locale>/news/<slug>`), unlike the rest of the site, where an unknown path serves the app
shell with status 200.

**Read the prose for the dates rather than taking the `runs until:` line.** That line is the crude furthest-date-named
signal the triage filter runs on — good enough to decide whether an article is worth your time, and not good enough to
put in a commit, since it cannot tell a start from an end or an event date from a mention of next season. What you are
looking for reads like `Monday, September 28, at 10:00 a.m. to Thursday, October 1, 2026, at 8:00 p.m. local time`. Note
the trap in that example: the start often omits the year, which you take from the end.

## Report before writing

Say what you found and what you are proposing, then wait. Date extraction from prose is the step most likely to be
wrong, and a misread date is much cheaper to catch in a proposal than in a commit. Give, for each proposed event, the
article it came from and the exact JSON entry you would insert, and say plainly which unmatched articles you rejected
and why — that is how the maintainer checks your triage rather than just your parsing.

**Lead with anything already published that is now wrong.** A missing event is an omission the maintainer can add
whenever they read your report; an entry whose dates an article has since changed is actively telling calendar
subscribers to turn up at the wrong time, and the `events.ics` this repository publishes has already gone out. Put that
first and say so, rather than letting it sit in a list of proposals ordered by date.

An entry takes this shape, and only `name`, `start` and `end` are yours to judge:

```json
{
  "eventID": "citysafari-brisbane-2026",
  "name": "Pokémon GO City Safari: Brisbane",
  "eventType": "regional-event",
  "heading": "Regional Event",
  "link": "https://pokemongo.com/en/featured-in-person-events/citysafari/brisbane",
  "image": "https://lh3.googleusercontent.com/pfmQwowEancYRhhAC8W9PnYllGycWzZxU3tvtZOAhe2prk4cu0bKVTbY4NWBgFCnyByzJINEPG7lvPJHsEeGF83m2QJotvZe-pyGZWxl95fO=s0-e365",
  "start": "2026-09-26T00:00:00.000Z",
  "end": "2026-09-27T08:00:00.000Z"
}
```

- **Leave `added` out.** It is the instant the event first reached the site, and the Vend workflow stamps it on the push
  that lands the entry. One written now would predate whatever the workflow vends before this lands, and a browser that
  had already seen past that would never mark the event New.
- **`eventType` and `heading` are always `regional-event` and `Regional Event`.** They are what gives the event its
  colour and its filter chip on the page, and this file holds nothing else.
- **`eventID` is yours to choose and is not the article slug.** It is a short, stable name ending in the event's year:
  `citysafari-brisbane-2026` for an article slugged `brisbane`, `30th-anniversary-kuala-lumpur-2026` for one slugged
  `event-kuala-lumpur-30th-anniversary-2026`. Group siblings under a shared prefix so a family of events sorts and reads
  together, and keep it unique — GPX files reference these IDs in `<pgr:event>`, and `pnpm lint` rejects one that names
  an ID this file does not have.
- **`name` is the event's name, not the headline.** Niantic writes headlines as marketing
  (`PokéXciting! Comes to KLCC Park — Get Ready, Kuala Lumpur!`); the entry gets the name the event goes by
  (`PokéXciting! — Kuala Lumpur`). The article body usually states it plainly as a heading above the dates.
- **Where one article announces several events, each gets its own entry**, with a `link` that may be shared. The four
  `30th-anniversary-*` entries all link to one article.

### Choosing between a floating time and a UTC instant

This distinction is load-bearing: it decides what a subscriber's calendar shows, and the wrong one shifts an event by
hours. **What settles it is how many time zones the event spans, not whether the announcement gives clock times** — and
not the phrase "local time", which appears in single-city announcements too and so distinguishes nothing.

- **An event in one place is one worldwide instant**, so convert its local wall clock to UTC and write a trailing `Z`.
  Brisbane, Marseille, Munich, Lisbon, Rio and Boston all start at `10:00` local on the same day and are stored as six
  different instants — `T00:00`, `T08:00`, `T08:00`, `T09:00`, `T13:00`, `T14:00` — which is the rule visible in the
  data.
- **An event running in several zones at once is a floating time**, so write the wall clock with no zone and no `Z`:
  `2026-10-02T10:00:00.000`. 10am wherever the reader is, which is what such an announcement means and what an iCalendar
  floating time expresses. Three entries are like this and all three are multi-country.

So a mall tour across three countries takes floating times even though it names exact hours, and a one-city festival
takes instants even though it says "local time".

**For an event given as whole days, end at the last moment of the final day rather than midnight of the next**, or a
calendar draws an extra day. The file writes this two ways — `2026-09-27T23:59:00.000` and `2027-04-30T23:59:59.000` —
so either passes; prefer `23:59:59.000` as the more exact of the two.

## Writing and landing the change

Once the proposal is approved:

1. **Insert each entry in `start` order.** The file is sorted by `start` ascending and nothing enforces it, so keep it
   that way by hand — including after correcting an existing entry's dates, which can move it.
2. **Run `npx prettier --write data/events.json`.** `pnpm lint` checks this file's formatting and will fail on it
   otherwise.
3. **Run `pnpm lint`** to confirm nothing else broke.
4. **Commit `data/events.json` alone and land it through a pull request.** The entry is the whole of the change, so
   stage that one path rather than the tree. `master` rejects a direct push, so branch and open the pull request the way
   the repository's `CLAUDE.md` says every change lands, rather than from a copy of its rules here that would drift.

**Do not run `pnpm vend:events`.** It rewrites `data/events-feed.json` from the live mirror, which the Vend workflow
refreshes hourly anyway — so running it now sweeps unrelated feed drift into a commit that should carry one entry.
`pnpm lint` is safe: it builds the calendar feed and the two indexes, and all three are generated rather than tracked.
