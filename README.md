# Pokémon GO Utilities

A collection of small, self-contained browser tools for Pokémon GO, served as static files on GitHub Pages as one Preact
application and reached from a shared top tab bar:

- **Events** (`#/events`) — a calendar of current and upcoming in-game events, also published as a calendar
  subscription.
- **Map** (`#/map`) — an interactive map of GPX walking tracks and teleport waypoints.
- **Search** (`#/search`) — a builder for the strings the game's own Pokémon search box takes, which it can type into
  that box itself on a phone connected from the settings menu.
- **Pokédex** (`#/pokedex`) — every species and its forms: what is in the game, which have a shiny and which hunts still
  want it.
- **Integrations** (`#/integrations`) — a PGSharp backup builder that loads those routes in as favourites, a Live
  PokeMap display filter built from the shiny hunt list, and links to the
  [Pokémon GO Coin Bag](https://github.com/na-ji/pokemon-go-coin-bag)'s builds.
- **Inventory** (`#/inventory`) — one Pokémon's detail screen read end to end, off a phone over WebUSB or from a saved
  screenshot: what [`pnpm inventory parse`](#pokémon-inventory) prints, without installing anything.

**➡️ [Open the site](https://spence.com.au/pogo-utils/)**

One document, [`index.html`](index.html), and a page per tab under [`src/pages/`](src/pages). The fragment carries both
where the reader is and the state they left that page in — `#/pokedex?q=pika&n=25` is the Pokédex with a filter typed
and a species open — so a filtered view is still a link. The fragment rather than a path because GitHub Pages has no
rewrites: a path would need every deep link served by `404.html`, which answers HTTP 404 while rendering the page.
[`src/router.ts`](src/router.ts) splits the two halves apart, which is what lets each page keep the state module it
already had: [`src/pokedex/state.ts`](src/pokedex/state.ts) and [`src/search/query.ts`](src/search/query.ts) parse a
query string and have no opinion about which page they are on.

Each page is reached through `import()`, so the chunk holding Leaflet and the one holding the Java serialization codec
are fetched only by the tabs that need them rather than by every reader of the events calendar.

The one exception is the notifications control at the end of the top bar, which every tab shows: it lists the events the
Events page would mark **New**, so it reads the two event files — `data/events-feed.json` and `data/events.json` — and
the saved event filters on whichever tab the reader opens, once per page load. The list and the New mark share one
record of what has been seen, so clearing either clears both. [`src/event-store.ts`](src/event-store.ts) holds it, and
[`src/notices.tsx`](src/notices.tsx) is where another kind of notice would join the list.

The list's second kind is a new PGSharp release. The Vend workflow's hourly run saves the current APK to
`data/pgsharp-release.json`, committing only when it changes, and every tab reads that file too. It is compared with the
last version this browser cleared, stored under `pogo-utils:pgsharp:acknowledged`. A first visit stores the current
version as the baseline instead of reporting it, as `settleSeen` does for events.
[`src/pgsharp/release-store.ts`](src/pgsharp/release-store.ts) holds it.

A new [Coin Bag](https://github.com/na-ji/pokemon-go-coin-bag) release is the third, on the same terms: the same run
saves the tag GitHub's latest release redirects to into `data/coin-bag-release.json`, acknowledged under
`pogo-utils:coin-bag:acknowledged`. Both stores are a [`src/release-store.ts`](src/release-store.ts) each.

Tracks (`<trk>`) and waypoints (`<wpt>`) are stored under [`data/`](data) as one `*.gpx` file per country,
[`data/Australia.gpx`](data/Australia.gpx) and so on — the files themselves are the source of truth. The map page reads
them directly, so to run it locally build the site and serve `dist/` over HTTP (the files are loaded via `fetch`). The
checkout is not servable: `index.html` names `src/main.css` and `src/main.js`, and both are written by the build rather
than kept here, so serving the repository root gets a page with no stylesheet and no module.

```sh
pnpm install
pnpm build
pnpm serve
# then open http://localhost:8000/#/map
```

`pnpm serve` serves what the last build left rather than building first, so an edit under `src/` wants `pnpm build`
again before it shows — and an absent `dist/` stops the server naming that command rather than answering every request
with a 404. The server is [`scripts/serve.mts`](scripts/serve.mts), a `node:http` handler, so nothing is installed for
it and nothing is served that the build does not publish: an extension with no entry in
[`scripts/served-types.mts`](scripts/served-types.mts) is a 404 rather than a guessed type.

That table is the point of serving it this way. Each entry was read off the deployment with `curl -sI` rather than
chosen here, so a header is the same locally as in production — which is what lets the Events page's **Subscribe** link
be followed here at all, `text/calendar` being what a calendar client takes and `text/plain` being what it ignores. It
is also the list [`scripts/assemble.mts`](scripts/assemble.mts) holds `dist/` to, so a new kind of file is one entry
rather than two that can drift apart.

Nothing re-checks those values against the deployment, and the suite cannot: it reads the same table to assert the
server honours it. So a header Pages changes is found by asking it — `curl -sI` against the published file — rather than
by a run going red.

One caveat is local only and stays. The LAN address printed beside the local one is good for viewing the site on a phone
but not for installing it — a plain-HTTP origin is no secure context, and Chrome will read `manifest.json` for
installation only from one — so [Installing as an app](#installing-as-an-app) is a flow only `localhost` or Pages can
exercise. WebUSB is held to a secure context the same way, and so is the Web Crypto hash the Inventory page checks its
OCR model against before reading anything, so that page neither reaches a phone nor reads a dropped screenshot from the
LAN address: `localhost` and Pages can do both, and the browser reaching this machine over the LAN can do neither.

Static hosting cannot list a directory, so the viewer is handed the paths in
[`data/gpx-paths.json`](data/gpx-paths.json). Nothing but the paths comes from it. Each listed file is read for what it
holds: a `<trk>` becomes a track and a `<wpt>` becomes a waypoint, each grouped under the country its own
`<pgr:country>` names, so what a file is called decides nothing. One file per country is therefore a convention for the
reader rather than something the viewer relies on — a file naming two countries would be drawn under both.

[`data/entries-by-event.json`](data/entries-by-event.json) is generated for the same kind of reason. The Events page
links through to an event's routes, and the only record of which event an entry belongs to is a `<pgr:event>` inside a
GPX file — finding those would cost the page a fetch of every one of them. It maps each `eventID` to how many routes and
waypoints it has.

Neither is in version control. `pnpm build` writes both, out of the very pass that validates the files, so adding or
removing a `.gpx` is the whole of the change — there is no index to regenerate alongside it and no stale copy for a
check to catch.

## File format

Each entry keeps its place name in `<name>` and everything else in separate fields, so nothing has to be split back out
of a label:

```xml
<trk>
  <name>Westfalenpark</name>
  <extensions>
    <pgr:city>Dortmund, North Rhine-Westphalia</pgr:city>
    <pgr:country>Germany</pgr:country>
    <pgr:variant>long</pgr:variant>
  </extensions>
</trk>
```

A country's file holds every entry in it, waypoints first and then tracks. That grouping is the format's rather than a
preference: `gpxType` in [the schema](resources/gpx.xsd) is an `xsd:sequence` of `metadata?`, `wpt*`, `rte*`, `trk*`,
`extensions?`, so a validator that has read a `<trk>` is already past the `wpt` particle and a waypoint below one
matches nothing left — `pnpm lint:xml` rejects the file. Within each kind entries are sorted by `<name>`, and
neighbouring entries are separated by a blank line, so a new entry has one place to go and a diff stays small.

GPX 1.1 has no element for a locality, a country, a short/long variant or an event, so those four live in the `pgr`
namespace declared on `<gpx>`. `<pgr:city>` is the locality the place sits in, including its region — it is absent when
the name is itself the place (`Melbourne`, `Boston, MA`). `<pgr:variant>` is `short`/`long`, and only for routes that
come as a pair. `<pgr:event>` names the event the entry was added for, by the `eventID` it has in
[`data/events.json`](data/events.json), and is absent for a place that stands on its own. `<name>` and `<pgr:country>`
are required; the viewer names any file missing either instead of guessing from the file name.

The Routes page's Copy button hands over the one entry it sits beside, written back out as a GPX file of its own rather
than the country file it was read from.

Every file is real GPX 1.1 and is checked against the schema on each push, using the copy of it vendored at
[`resources/gpx.xsd`](resources/gpx.xsd). That check, and the HTML, CSS and JavaScript linters, run together:

```sh
pnpm install
pnpm lint
```

The schema pass reaches the GPX itself, not the `pgr` fields: GPX declares `<extensions>` as any element from another
namespace, processed leniently, so a misspelled `<pgr:contry>` sails through it. A second pass closes that gap by
reading each file the way the viewer does — every `<trk>` and `<wpt>` must carry a non-empty `<pgr:country>`, a
`<pgr:variant>` is only ever `short` or `long`, a `<pgr:event>` must name an `eventID` that
[`data/events.json`](data/events.json) actually has, and a `pgr` element with no matching field (that `<pgr:contry>`) is
reported as the typo it is.

One caveat: an editor that does not model foreign extensions drops the whole `<extensions>` block when it exports.
gpx.studio is one, so a route re-exported from there comes back without its city, country and variant, and needs them
added again.

## Calendar subscription

The same events are published as an iCalendar feed, [`events.ics`](https://spence.com.au/pogo-utils/events.ics), so they
can be subscribed to rather than read here. It holds what the Events page shows by default: every dated event other than
the weekly-cadence ones, so subscribing does not put a Spotlight Hour and a Raid Hour into every week of your calendar.

In Google Calendar, that is **Other calendars → + → From URL**; iOS and Outlook take the same URL. Google re-fetches a
subscribed URL on its own schedule, typically somewhere between a few hours and a day, so a newly announced event does
not appear there as promptly as it does on the page.

Both the page and the subscription read Leek Duck's events from [`data/events-feed.json`](data/events-feed.json), a copy
of the [ScrapedDuck](https://github.com/bigfoott/ScrapedDuck) mirror kept here rather than fetched from it on every
visit. That is what holds the two in step — a browser reading the mirror live and a generator that had read it hours
earlier could disagree — and it gives the feed a history, ScrapedDuck's own being a single commit force-pushed on every
scrape, so `git log -p data/events-feed.json` says when an event appeared, was renamed, moved or lost its dates.
[`scripts/vend-feed.mts`](scripts/vend-feed.mts) takes the copy and the [Vend workflow](.github/workflows/vend.yaml)
runs it hourly:

```sh
pnpm vend:events
```

Each event is cut down to the eight fields the pages read and the list is sorted by `eventID`, so a reworded `extraData`
blurb, a rehosted image or a reordering upstream is not a diff here. That is what makes the commit conditional:
[`git-auto-commit-action`](https://github.com/stefanzweifel/git-auto-commit-action) pushes the copy only when it
differs, and the run passes without a commit when it does not. An empty list or an event with no `eventID` is refused
rather than written, an empty list being what a broken scrape looks like.

Each event also carries `added`, the instant this repository first vended it. It is carried forward from the previous
copy, so only an event the feed has just gained reads the clock and an unchanged feed is still an unchanged file. The
feed has no published date of its own, and this is what lets a browser record everything it has seen as one instant
rather than as one ID per event. The same run stamps any entry in [`data/events.json`](data/events.json) that lacks one,
which is why the workflow also runs on a push to that file: a stamp written by hand could predate one already deployed
by the time it landed, and a browser that had seen past that would never mark the event New.

[`data/events.json`](data/events.json), this repository's own list, is not replaced wholesale but pruned: the
[Prune workflow](.github/workflows/prune.yaml) runs [`scripts/prune-events.mts`](scripts/prune-events.mts) daily, which
removes every event that has ended everywhere — a naive end once it has passed at UTC−12 — along with any `<pgr:event>`
naming one. An event with no announced end is kept, and so is one the feed also carries: that entry overrides the feed's
rather than being the only copy of it, so removing it would uncover upstream's, which by then is usually the same event
without its dates. The run re-checks the files with `pnpm lint:xml` before it commits, a reference left behind being one
the build would refuse on every deploy after it.

```sh
pnpm prune:events
```

GitHub's 60-day rule applies to both scheduled workflows: a schedule is disabled after 60 days with no commit to the
repository. The Vend workflow's hourly commits are what keep them alive, which holds as long as the events keep moving;
if everything here goes stale at once, re-enable them from the Actions tab.

A calendar app fetches a URL and cannot run the page's JavaScript, so the merge the browser does has to happen ahead of
time. [`scripts/build-ics.mts`](scripts/build-ics.mts) does it, as a step of the build rather than after one:

```sh
pnpm build
```

The feed is not in version control — it is derived from `data/events-feed.json`, [`data/events.json`](data/events.json)
and [`data/entries-by-event.json`](data/entries-by-event.json), all three of which are, so there is no second copy to
keep in step. The generator reads no clock and makes no request, which is why it can sit inside `pnpm build` at all:
`pnpm lint:types` _is_ `pnpm build`, so a generator that fetched would put somebody else's server in front of every
lint. A local run therefore produces exactly the bytes a deploy does.

Nothing is on a timer. The [Pages workflow](.github/workflows/pages.yaml) deploys on a push, and the Vend and Prune
workflows commit with a GitHub App's installation token rather than the default `GITHUB_TOKEN` — which raises no
workflow run at all, and so would leave the site at whatever a human push last built. So a quiet stretch upstream
deploys nothing rather than republishing identical bytes, and the page and the subscription are always siblings of one
deploy. Two things follow: data on the page is up to an hour old where it had been live, and a deploy lost to a failed
run waits for the next change to the feed rather than for the next tick — **Run workflow** on any of the three closes
that by hand.

An event's times are carried the way Leek Duck gives them. Most are _local_ events — 6am wherever you are — which is
exactly an iCalendar floating time: a `DTSTART` carrying neither a `TZID` nor a trailing `Z`. The ones that are a single
worldwide instant (GO Battle League rotations, most regional events) are written as UTC and convert to your zone as you
would expect.

Floating time is where calendar apps differ, and it is worth knowing which one you are using. Apple Calendar and
Thunderbird implement it, and show a local event at the hour it says. Google Calendar does not: with no calendar-level
timezone in the file to anchor them to, it reads those times as UTC, so a 2pm Community Day arrives at 2pm UTC rather
than 2pm where you are. Pinning them with `X-WR-TIMEZONE` would fix that for one timezone and break it for every
subscriber outside that zone, so the feed leaves them floating — correct by the spec, and correct in a reader that
follows it.

## Search strings

The **Search** page ([`src/pages/search.tsx`](src/pages/search.tsx)) builds a string for the search box on the game's
Pokémon storage screen. A catalogue of chips sits below the query; you drag one into a group to make a pill of it, and
the arrangement of those pills _is_ the search. The string is written live, with a link that carries the whole
arrangement so one can be shared or bookmarked. An arrangement saved as a favourite is that same link, stored under
`pogo-utils:search:favourites` by [`src/search/favourites.ts`](src/search/favourites.ts).

A group asks for **all** of its pills or **any** of them, holds other groups as well as pills, and turns round with one
press. A pill is required or ruled out, which is one press on its face. That pair is complete over every search the game
can express, and deliberately has no third thing in it: a negated group is the other junction with its pills negated —
`!(a&b)` is `!a,!b` — so De Morgan is something the reader does by arranging rather than something the code has to do
afterwards.

The terms live in one table, [`src/search/terms.ts`](src/search/terms.ts), and the catalogue is rendered from it, so
adding or correcting one is still a single line.

### What a phrase can be

A phrase out of the [community list](https://leidwesen.github.io/SearchPhrases/) reaches the page as one of three
things, and which one is the whole of what the table has to say about it. A shortcut is not a fourth: the list's four
are spans wearing a word, which is why they are read as the spans they stand for and why they turn up below under spans
rather than beside them.

A **term** is a word the table owns, which is most of them — `shiny`, `candyxl`, `party`, `kanto`, `@special`. A
**span** is a phrase and a range of values: `cp100-2000`, `countcandy248-`, `maxspirit1-`. A span's phrase sits _behind_
the numbers for the three IVs, `hp{N}` being the stat where `{N}hp` is the IV, which is the one shape a prefix alone
could not write and the reason a range carries a `suffix` as well. Where the game names a range's values rather than
counting them, the range carries those names as `levels` and the pill picks from them instead of taking digits: a buddy
level is `0` for never a buddy through `5` for a Best Buddy, and `buddy2-` is Good Buddy or better. And anything else is
the reader's **own text** — a name, a nickname, `@hydro pump`, `#keepers` — which is what the game does with a word it
does not know, and so needs no kind of its own.

The eighteen types are read four ways, which is four groups rather than a mode over one: `fire` is the type, `<fire`
what hurts it, `>fire` what it can hurt and `@fire` a move it carries. The four share a hue, there being room on the
wheel for fifteen and no more, so the operator in each chip's label is what says which group a pill came from.

Two shapes the catalogue cannot hold get a box each: the `@` search, where a slot dropdown and one text box write
`@3crunch` as well as `@weather`, and the tag, where only the reader knows what they called theirs. The game's own
priority is what lets one box serve the whole `@` family — a type is read before a move of the same name — and it is
also the catch, so the move Psychic answers to `@psychi`.

**Four phrases are a span wearing a word**, which the list calls shortcuts: `mega` is `mega0-`, `count` is `count2-`,
and `dynamax` and `gigantamax` are those ranges open at the top. Those are read on the way in, so the game's own
spelling arrives as the pill it stands for, and never written on the way out — a shortcut is exactly the thing the list
says gets eaten by whatever is typed next to it, and the span spelled out is the spelling nothing can swallow. Which is
also a caveat the page raises: a move or tag beginning with one of the three unpatched phrases is named under the
string, beside the span the game reads instead of it.

### What the tree is written as

The game takes no brackets. What it does take is clauses separated by `&`, each a list of alternatives separated by `,`,
`:` or `;`, each alternative a term or a term behind a `!` — and that shape is conjunctive normal form, which every
boolean expression has one of. So [`src/search/clauses.ts`](src/search/clauses.ts) distributes whatever has been
arranged into that form, and [`src/search/query.ts`](src/search/query.ts) joins the result with `&`. A shiny Pikachu or
an XXL Pumpkaboo — two `all` groups inside an `any`, which the earlier fixed builder could not say at all — leaves as
`pikachu,pumpkaboo&pikachu,xxl&shiny,pumpkaboo&shiny,xxl`, and not one of those four clauses is a search anybody would
have thought to write.

One reduction happens before the distribution rather than after it, because it decides whether an arrangement can be
written at all. A pill every part of an `any` asks for is lifted out of it: `any(all(s, a), all(s, b))` is
`all(s, any(a, b))`, which is the same search said as a sum where it was said as a product. _A shiny Fire, or a shiny
Water, or a shiny Grass_ is a natural thing to place, and it spreads to two to the power of however many types are named
— 64 clauses at six, past the cap at ten — where the answer is `shiny&fire,water,…` and `shiny` is in every clause.
Dropping those clauses afterwards cannot help, the cap being reached while they are built.

Three costs are worth knowing. An `any` **multiplies** where an `all` adds, so a few groups with nothing in common buy a
great many characters; the converter refuses past a thousand clauses rather than build a string no search box could
hold. A clause that asks nothing is dropped — a pill with no bounds filled in yet, or a group with nothing in it, asks
nothing and is read that way rather than guessed at. And the conversion only means what it says if a comma binds tighter
than an ampersand, which is the one thing everything here rests on — and which the
[community phrase list](https://leidwesen.github.io/SearchPhrases/) states outright for this search box: "`&` and `,`
can be used multiple times in one search. Ambiguity is resolved by always considering `,`s nested inside `&`s", with
`meowth,alola&vulpix,galar` as the example. Niantic's own list never combines the two operators, so that is the source
that settles it. The page used to warn whenever a string mixed them and no longer does: there is nothing to warn about,
and the caveat would have been up for nearly every query worth building in any case.

[`src/search/tree.ts`](src/search/tree.ts) owns the arrangement itself: what a pill writes, and the three edits a drag
makes. A node is named by its **path** — `[2, 0]` is the first part of the third part of the root — which is what a
render already knows and what a drop target already is, so nothing has to mint an identity and keep it in step. The cost
is that `move` is the one operation that invalidates its own argument, taking a pill out shifting every sibling after it
along, so it corrects its destination rather than trusting callers to.

### Typing one in

A query can be written out rather than arranged, which is the page's _Advanced_ pane against the _Builder_ the rest of
this section describes. [`src/search/parse.ts`](src/search/parse.ts) reads `(pikachu&shiny),(pumpkaboo&xxl)` into the
tree the brackets describe and the canvas draws it, which is the inverse of the composer and the easy direction of the
two: a reader can say what they mean with brackets, and the page writes out something the game will take.

The two panes are two views of one tree, so the output card sits above both and stays put as they swap. The pane is in
neither the link nor storage: a link carries the arrangement, and the arrangement draws in either.

It is an **import rather than a second composer**. Nothing in it writes a string — it writes a tree, the canvas draws
it, and the one composer takes it from there, so the pills it leaves can be dragged about like any others. A word the
catalogue knows arrives as its own pill, so `shiny` lights up the Status chip and `cp1500-3000` arrives as a span pill
with its two ends set — boxes where the range counts, named dropdowns where it names, so `buddy2-5` arrives reading
_Good Buddy_ to _Best Buddy_; `1-151` arrives as _Gen 1_, that being the chip which already spells it. Anything else is
a name, which is what the game does with a word it does not know.

Both of the game's spellings of each operator are read: `&` and `|` are _and_, `,` and `;` and `:` are _or_, and `!`
rules out what follows — a bracket included, which arrives as the other junction with its pills turned, De Morgan being
applied while reading because `tree.ts` keeps negation on the pills and has no negated group.

The test that matters is the round trip: **every string this page writes out of the pills a typed query returns, it
reads back into the same string.** The composer writes on the assumption a comma binds tighter, and the reader has to
make the same assumption to agree, so that one property holds the two halves to one language.

The qualification is the name box, which splits on commas and leaves everything else a reader types alone — so a name
can hold the punctuation this page gives a meaning the game does not have. The game has no brackets at all, so
`Mr. Mime (shiny)` is a perfectly good name to send it and a string this reader refuses; a name holding a `|` comes back
as the two pills that `|` asks for. A refusal the reader can act on is the better answer there than a quoting syntax the
game would not read either, and [`src/search/parse.test.ts`](src/search/parse.test.ts) pins both sides of that line.

### Shortening

**Shorten**, beside the character count, says the same thing in fewer characters — worth having because the game's
search box is a small one and a long string is pasted with half of it out of sight. The three reductions are the ones
where the reader has named a species at more length than the game needs, or a category has said what its own terms
already settle: a name can lose its tail, since `charmander` and `charma` reach the same one species and so does the dex
number `4`; dex spans collapse, into their overlap where they are AND'd and their union where they are OR'd; and
`terms.ts`'s `exclusive`, `exhaustive` and `covers` make `shadow&!purified` say `shadow`, every star rating at once say
nothing at all, and the two backdrops say `background`.

**Every one of them is local to one group.** That is the whole of what the canvas changed about
[`src/search/optimise.ts`](src/search/optimise.ts): the earlier page AND'd one clause per category, so "this category's
terms" and "the terms AND'd with everything else" were the same set and a reduction could be written once against it. An
arrangement can put a category's terms in two different groups, or inside an `any` the rest of the query is not AND'd
with, so each reduction asks only about one group's own parts. A pill one group over is a pill it knows nothing about,
which is the only reading that cannot make a search broader than it was.

It rewrites the _tree_ rather than the string, handing a second tree to the same composer, so the short string goes
through the same distribution and the same clause writer as the long one — and the canvas and the link never stop
carrying what was actually arranged, so switching the toggle back off restores the original rather than leaving a
rewrite to undo. The substitutions are listed under the string, because one of them is not an equivalence: a name
matches nicknames as well as species, where a dex number matches the species alone. What it will not do is turn
`+charmander` into `4,5,6`, or shorten it to `+charm` by reaching the family through another of its members; both need
to know which species share an evolution family, which is data this repository does not hold.

## Pokédex

The **Pokédex** page ([`src/pages/pokedex.tsx`](src/pages/pokedex.tsx)) is the whole national dex drawn as the game's
own Pokédex: a grid of glass tiles, each the species' picture over its number, under a card naming the region. A
**Regions** sheet picks a region — every generation's card carries its starters and how much of it is registered — and a
search sheet narrows the grid by name or number, by whether a species is in the game yet, and by toggles for a shiny, a
wild spawn, a category (Legendary, Mythical, Ultra Beast, Baby, Regional) or a place on one of the hunt lists.

The tabs along the foot — Pokémon, Shiny, XXL, XXS and 100% — redraw the grid as that dex. The Pokémon tab fills a tile
for every species in the game; each of the others fills a tile once some form of the species is in the game (with its
shiny out, in the Shiny dex) and off the hunt's list — the lists name forms, and the game fills a tile once any form is
registered — and leaves the rest as an empty numbered tile, as the game shows a slot not yet registered. The Shiny dex
turns the page gold. The card heading the grid counts what is registered in the open mode against what the filters
leave, with the counts for the four hunt modes — Shiny, XXL, XXS and 100% — beneath.

Picking a tile opens the species on a band of its type colour: its normal and shiny picture, its types, what is true of
it, each of its forms and regional variants with the same answers, and a link into the **Search** page for it or its
family. The arrows step through the species the filters left, and the link carries the mode, the filters and the open
species.

Nothing on it is kept by hand. [`src/pokedex/entries.ts`](src/pokedex/entries.ts) reads
[`src/pokemon/pokedex.ts`](src/pokemon/pokedex.ts) for the flags and the hunt lists in [`src/filters/`](src/filters) for
what is still wanted — the same Sets the PGSharp backup is built from — so crossing a species off `xxl.js` takes it off
the page's XXL filter too. A list is a checklist and the backup's feed is that list narrowed to what the wild can turn
up, so the page says when a species is wanted but the feed cannot alert on it: Mewtwo is still wanted as a 100%, and
only a raid will ever produce one.

The pictures are the game's own, hotlinked from [PokeMiners' `pogo_assets`](https://github.com/PokeMiners/pogo_assets) —
the same 256×256 renders [`src/tools/inventory/game-master.mts`](src/tools/inventory/game-master.mts) matches a
screenshot against, so the two cannot disagree about what a species looks like. Most of the dex is `pm{dex}.icon.png`,
which the number alone derives; `build:sprites` ([`scripts/build-sprites.mts`](scripts/build-sprites.mts)) writes the
113 it does not — and beside them, in `data/pokemon-types.json`, each species' types off the same form, which colour its
entry — read out of the committed game master so the build reaches no network. 961 species draw a render that way. The
other 64 have no artwork in the game at all — 62 of them are species it has not released, the exceptions being
Scatterbug and Spewpa — and fall back to [PokeAPI](https://github.com/PokeAPI/sprites), which covers the dex by number.
A species whose picture does not load keeps its number.

A species the game draws only as a form — Unown, Burmy, Mimikyu — has no picture of its own, so the table names one of
its forms. Which one comes from [`src/pokemon/pokedex.ts`](src/pokemon/pokedex.ts): `addForms` lists a species' forms in
the game's order, so the first is the one that stands for the species. Only Spinda reaches no answer that way, its
patterns being numbered where that table names them, and the build says so when it happens.

## Import into PGSharp

The **Integrations** page ([`src/pages/integrations.tsx`](src/pages/integrations.tsx), reached from the top tab bar)
builds a _partial_ `PGSData.dat` containing only every route and waypoint here — plus, if ticked, a fixed control layout
(floating control, fast-snipe buttons, cooldown indicator, nearby radar) and the nearby feed's filter list
(`Shiny Hunting` and `100%`). No existing backup is needed: click **Generate & download**, then import the file into
PGSharp to add them as favourites. Because the file holds only those keys, importing it leaves the rest of your PGSharp
profile as it was. Everything runs in the browser. The favourite encoding is a client-side port of
[`pgsedit`](https://github.com/joshuaspence/pgsedit).

Every favourite is named with its country's flag in front — `🇳🇱 Amsterdam, Netherlands`, `🇯🇵 Ueno Park, Tokyo, Japan` —
matching PGSharp's own hot places (`🇺🇸 Pier 39, California, USA`). The favourite format has no icon field, so the flag
is simply part of the name; it is derived from the `<pgr:country>`, and a country the viewer has no code for stops the
build rather than importing unflagged. Both lists still sort by the name itself, so a flag never moves an entry.

Each waypoint also carries the IANA timezone its coordinates fall in (`Europe/Madrid`), read from the boundary data in
[`tz-lookup`](https://github.com/darkskyapp/tz-lookup) — a zone name belongs to a polygon, so no offset calculation can
stand in for it. Routes have no timezone field, matching PGSharp. If that script does not load, the backup is written
without timezones and the page says how many were left out; PGSharp accepts entries either way.

## Import into Live PokeMap

The second panel on the **Integrations** page writes a [Live PokeMap](https://livepokemap.com) _display filter_: an
allowlist of every species still wanted for a shiny, as the dex numbers its filter stores. Click **Copy to clipboard**,
then press **Import** under Live PokeMap's own display filters. A copy rather than a download because its importer takes
neither a file nor a pasted field — it calls `navigator.clipboard.readText()` and reads whatever is on the clipboard, so
a downloaded file would only have to be opened and copied out by hand first.

It is the shiny list alone. XXL, XXS and 100% are thresholds rather than lists — `filterXXL`, `filterXXS` and `minIV`
say them without naming a species, and Live PokeMap surfaces all three unprompted, its `alwaysShowSize` and
`alwaysShowPerfect` defaulting on. Which species still want a shiny is the one thing it cannot work out for itself, and
it is the same Set the PGSharp feed is built from, narrowed the same way by
[`src/filters/narrow.ts`](src/filters/narrow.ts).

**Importing replaces your display filters entirely.** Live PokeMap spreads an imported `config` over its own defaults
rather than over what you had, so every field the file leaves out — the IV and level bounds among them — goes back to
its default. The file therefore carries only the two fields this collection has an opinion about, and the panel says so
above the button.

Not to be confused with Live PokeMap's own **Config** export, the `{"_version": 1, "settings": {…}}` file. That one
honours a seven-key allowlist of interface preferences and silently drops anything else, so a species list cannot be
expressed in it at all; the two formats are not interchangeable in either direction.

## Installing as an app

[`manifest.json`](manifest.json) lets a phone add the site to its home screen and open it without the browser's toolbar,
starting on the Events page, with a long-press shortcut to each of the six tabs. Those two members are not in the
checkout's copy: [`scripts/build-manifest.mts`](scripts/build-manifest.mts) writes them into `dist/manifest.json` from
the router's page table in [`src/page-table.ts`](src/page-table.ts), so renaming or adding a page moves its shortcut
with it rather than leaving one that quietly opens the Events page. Its paths are relative, so it works under the Pages
subdirectory as well as from a local server, and [`scripts/assemble.mts`](scripts/assemble.mts) resolves every one of
them inside the build the same way it resolves the markup's: an icon or a shortcut naming a file that moved fails the
build rather than drawing a letter tile on somebody's home screen.

The icons the manifest names are not in the checkout at all: [`scripts/build-icons.mts`](scripts/build-icons.mts)
renders each from [`favicon.svg`](favicon.svg) straight into `dist/icons/`, the way the calendar feed is written rather
than kept, reading the manifest for the sizes to draw and for the plate colour behind a maskable one. The ball is
therefore drawn in exactly one place. They are PNGs at the sizes the manifest declares because Chrome matches an
installable icon by its declared pixel size and wants both a 192 and a 512. A maskable icon is the same ball inset to
two thirds of its canvas — far enough in to keep the rim inside the central 40% radius a launcher promises to keep when
it crops the icon to its own shape — composited onto an opaque plate, because the corners of a cropped icon are never
transparent. At 768 that inset is exactly 128 pixels, so the ball is rendered at 512 rather than resampled from it.
Nothing in the chain honours `prefers-color-scheme`, which is what makes `favicon.svg`'s themed rim come out in the
light theme's dark colour every time, rather than whenever the person rendering it by hand remembered to.

## Pokémon inventory

`pnpm inventory scan` lists every Pokémon in storage in a CSV (species, nickname, form, costume, shiny, lucky, XXL/XXS,
CP, HP, level, IVs and moves) by driving an Android phone over `adb`. Pokémon GO is drawn by Unity, so Android can't
read its text; instead the script takes a screenshot at each step and reads it with Tesseract. Both tools have to be on
`PATH`:

```sh
brew install android-platform-tools tesseract   # or: apt install adb tesseract-ocr
pnpm inventory scan --out inventory.csv
```

The scan needs PGSharp with its IV display switched on, since PGSharp's overlay is where the level and the three IVs are
read from; on the stock client those columns come back empty. Plug the phone in with USB debugging on, set Pokémon GO to
English and choose a storage sort order first; the scan keeps whatever order is set. It opens the first Pokémon and
swipes through the rest, reading the detail screen and then the moves scrolled into view. Form is never shown on screen,
so the script works it out from the HP, IVs and types against the base stats in
[the game master](https://github.com/alexelgt/game_masters), which is also how a nicknamed Pokémon gets its species
back. Size comes from the `XXL` or `XXS` badge on the detail screen, and shiny, lucky and costume from the game's own
searches, one quick pass each before the full pass; `--flags` picks which. Expect several seconds per Pokémon. `--limit`
and `--skip` break a long run into pieces, and `--refresh` downloads the game master and form icons again rather than
using the week-old cache. The icons are found through GitHub's API, which answers an address without a token 60 times an
hour; `GITHUB_TOKEN=$(gh auth token)` in front of the command lifts that where it runs out. Pokémon GO is launched only
where it is not already the app in front, so a run started over an open storage screen picks up from there rather than
waiting out a cold start.

A scroll capture keeps dragging the screen up and taking a screenshot until it stops moving, then stitches the frames
into one tall image, which is how a screen longer than the phone is seen whole. `pnpm inventory snap` takes one of any
screen it can confirm is a detail screen and leaves it as `NAME.png`, leaving the plain screenshot under that same name
only where PGSharp's overlay did not read, which is where it does not scroll at all; a scan takes one where `--scroll`
asks for it, reading the moves from it rather than from one screenshot taken part way down. A snap will not write over a
capture already saved under the name unless it has a better one to put there, so a re-snap that comes back refused
leaves the earlier file alone and says so. It then drags the panel back to where it found it, measuring rather than
assuming it got there, so one snap does not shift the next. The stitched image is not handed to the readers anchored on
a fraction of the height — the star corner, the overlay sweep, the tag band and the artwork — so `snap` and `parse` crop
it back to the screen it records before they see it, and read the moves off the whole. The band of the screen the frames
are lined up in is `scrollBand` in `--config`; it has to end above the game's floating buttons, which are drawn over the
panel rather than in it, or their top is stitched in once per frame.

Every tap position, swipe and delay can be overridden from a JSON file passed as `--config`. When something is misread,
`pnpm inventory snap` saves a screenshot of whatever the phone shows and prints what each reader makes of it, and
`pnpm inventory parse FILE.png` does the same for a saved one. `--search` drives the phone to the Pokémon first, typing
a term into storage's own search box and opening the first thing it matches, so that `--search '+burmy & cp196'` names
what the capture wanted where a screen set up by hand records nothing about which Pokémon that was. `--verbose` adds
every line OCR found with its box, which is what separates a field left empty because no text was read there from one
left empty because a reader anchored on the wrong line. On all three commands it also un-silences the preamble narrated
before there is anything to report — the form icons about to be read, with the families no artwork settles — which is
the same two lines on every run of a warm cache, and so is worth reading only when a form comes out wrong. A download
says so either way, a file already in date being read without a word, so `Downloading` names only what a cold or stale
run is actually waiting on. What went wrong is never held back either: a stale copy read because the download failed, or
an icon that could not be had, prints regardless. `snap` exits non-zero unless the screen is a Pokémon detail screen
carrying PGSharp's overlay, those being what every other reader depends on; it still saves the screenshot when it
refuses, and still stitches one whose only fault is a field that did not read — what it will not scroll is a screen
PGSharp's overlay cannot vouch for, the map and a detail screen being indistinguishable there. `pnpm inventory help`
lists the flags each command acts on, and a flag given to a command that does not act on it is refused rather than
quietly ignored. The cache, the snaps and `inventory*.csv` are git-ignored, since they describe a player's own account.

Automated input is against Niantic's terms of service. The scan only reads and moves at about a person's pace, but the
risk to the account is yours to weigh.

### In the browser

The **Inventory** page ([`src/pages/inventory.tsx`](src/pages/inventory.tsx)) is `snap` and `parse` without the install:
it reads one detail screen, grabbed off a phone or dropped in as a PNG, and prints the four blocks `parse` prints —
`detail`, `moves`, the overlay box and what read inside it, and the identity — from the same
[`readScreen`](src/tools/inventory/report.mts). A screen a scan could not have used is refused the way `snap` refuses
it, with the reason said: an HP that did not read, or no PGSharp overlay. What the readers made of it anyway is still
there, folded under the refusal. A scan of storage, its CSV, the flag passes and a scroll capture stay the CLI's.

The phone is reached over WebUSB with [Tango](https://tangoadb.dev/) (`@yume-chan/adb`, MIT), picked through the
browser's own device chooser, and has to be authorised on the phone the first time as it does for `adb`. It is a
Chromium API, so Chrome or Edge, and a phone an `adb` server on the same computer already holds cannot be claimed —
`adb kill-server` first. Where the connection will not come up, [WebADB](https://webadb.com/) is a shell over the same
WebUSB to find out why; it is a hosted app rather than a library, which is why the site imports Tango instead.

The phone is connected from the settings menu (⚙️ in the top bar) rather than from any one page, and the connection
outlives the tab it was made on: [`src/phone-store.ts`](src/phone-store.ts) holds it for the document until the phone is
unplugged, so `adb` cannot reach the phone until then or until the site is closed. That is what the Search page's
**Search** button uses. Beside **Copy** while a phone is held, it drives storage the way `snap --search` does, through
the same [`storage`](src/tools/inventory/storage.mts) and its `DEFAULTS`: the game launched if it is not in front,
storage opened from the map or a detail screen, the string typed into the box, and the game's own count of what matched
reported back. The OCR it finds its way with is fetched on the first press rather than with the page.

The readers run in the browser unchanged. [`png.mts`](src/tools/inventory/png.mts) decodes with
[fflate](https://github.com/101arrowz/fflate) rather than `node:zlib`, keeping both the `Viewport` chunk a stitch
carries and the uncorrected colours [`artwork.mts`](src/tools/inventory/artwork.mts) picks a form by, which
`createImageBitmap` would lose. OCR is an `Engine` installed by whatever runs the readers: the CLI in
[`ocr-cli.mts`](src/tools/inventory/ocr-cli.mts), and [tesseract.js](https://github.com/naptha/tesseract.js)
(Apache-2.0) in [`ocr-wasm.mts`](src/tools/inventory/ocr-wasm.mts), with the whitelist and page segmentation mode passed
per read and TSV asked for as the CLI's `tessedit_create_tsv` is. It reads with the CLI's own model, `eng.traineddata`
from `tessdata_fast` 4.1.0 — what `apt` and `brew` both install — fetched once from that tag and kept in the browser.

Nothing read leaves the page. What it fetches carries nothing about the screen: the model, the form icons from
`pogo_assets` that the Pokédex page already draws, and the game master — the vended
[`fixtures/game-master.json`](src/tools/inventory/fixtures/game-master.json), which the build publishes rather than the
page fetching the 23 MB it is made from. The screenshot and its reading stay in memory, and leave only as a download.

The corpus is what holds the page to the CLI. `INVENTORY_OCR=wasm pnpm test:corpus` runs
[`screens.test.mts`](src/tools/inventory/screens.test.mts) under the WebAssembly engine, handed the CLI's model off disk
so it reaches no network and checked to be the same file the page fetches. Every capture reads the same fields,
identity, form, level and IVs under both. Three assertions still differ, the three that pin which route a CP took rather
than what any capture answers: tesseract.js is a fork of Tesseract 5.1 where `apt` installs 5.3.4, and it reads
`castform-snowy.png`, `deoxys-normal.png` and `deoxys-defense.png`'s CP straight off the label line where the CLI has to
sweep the region for it, `charizard-gigantamax.png`'s the other way round, and the sweep offers a different stray on
`castform-sunny.png` and `pikachu-santa-hat.png`. Pinned to the CLI's routes, they are the CLI's to keep.

## Trainer battles

`pnpm battle` plays the game's Team Leader training battles one after another, driving the same phone over `adb` as
[`pnpm inventory`](#pokémon-inventory). Unlike the inventory scanner it does not only read, and automating input breaks
Niantic's terms of service, so run it on an account whose loss you would accept.

```sh
pnpm battle run --leader spark --league great --count 5
```

Start it from the map, or anywhere between the result of one battle and the start of the next: from the map it opens the
main menu's BATTLE and scrolls the Battle tab down to the Training card. It swipes across the field for fast moves.
While the opponent has shields left, read off the hexagons along the top, it throws its cheapest charged move to draw
them; once they are gone, the one worth the most for each point of energy it costs, and of two worth as much, the
cheaper, which fires sooner — a move's worth being power, times STAB, times its effectiveness against the opponent,
adjusted for the chance it raises or drops our own attack or their defense as though that touched one more hit of its
size, bar our attack's where their next hit would faint us with no shield to stop it — keeping the energy for it while a
weaker one is ready instead, unless such a hit can come first: a charged move that the energy counted off the hits on
our bar affords, or their next fast move. It reads the moves off the labels under their buttons and the two Pokémon off
the names along the top, every few seconds. A nicknamed Pokémon of yours is named by the party screen instead, whose
pictures it matches against the game's icons, as the lead and then whichever it sent in after a faint, passing over any
that cannot hold the moves read; one it still cannot name, or an opponent it cannot read, counts as neutral. After a
faint it sends in one the opponent cannot hit super effectively, then the one that hits it hardest. In the minigame it
finds the bubbles by the thrown move's type colour, read off the game's icon for the type, and swipes along each chain
of them, sweeping rows only where none are found. The shield prompt never says which move is coming, so it judges by the
hardest the opponent could have — of those its players run, or both of its own once the banners after earlier prompts
have named them, and of those the energy it is counted as having off the hits on our bar affords — with each side built
as the strongest spread for the CP its HUD shows, and takes a shield only where that hit would take nine tenths of the
HP left, or where it does not know enough to tell. A charged move that always raises or drops attack or defense, such as
Close Combat or Icy Wind, moves the hit too, shielded or not: ours as it throws them, the opponent's off those banners,
each side's undone when its Pokémon leaves the field. With none of our shields left, a move that drops our own defense
waits while the opponent's counted energy affords a charged move we would survive, until that lands or our energy could
have filled. Training has no rematch, so between battles it taps its way back round — the result's ✓, the leader,
BATTLE, the league, then USE THIS PARTY on the game's recommended party. It keeps the screen awake while it runs and
puts the setting back after. Where nothing on screen has been recognised for 20 seconds it stops rather than tap at a
screen it does not know, and `--keep-frames DIR` saves the last few frames it saw.

`--keep-video FILE` keeps the whole of the screen the run watched, battles and the menus between them, as MPEG-TS video
that `mpv` or `ffplay` plays, so any moment the log names can be looked at afterwards, not only those around a faint or
a shield prompt. A moment's time in the video is its time in the log, seconds since the run began, across the restarts
`screenrecord`'s three-minute limit makes. It is the H.264 the run already decodes, kept rather than recorded a second
time, so it costs the phone nothing more; the run does a little more work, cutting it into pictures and writing about 30
of them a second to disk, at most about 15 MB a minute and less for a still screen. A browser does not play MPEG-TS;
`ffmpeg -i run.ts -c copy run.mp4` makes one it does, its times the same. Like any capture of the phone it shows the
account's trainer names, so it is not to be committed as it is.

How it is put together, and the strategy it plays by in full, is in
[`src/tools/battle/README.md`](src/tools/battle/README.md).

A screenshot takes 0.8–1.9 seconds over `adb` against a turn of half a second, so a battle is watched as video instead:
`screenrecord` on the phone sends H.264 at 30 frames a second and `ffmpeg` decodes it, which needs `ffmpeg` on `PATH`
beside `adb`, and Tesseract for the league screen and the names and moves. The first run also downloads the game's form
icons for the party screen, some 40 MB, kept for a week like the game master.
[`src/tools/battle/recognise.mts`](src/tools/battle/recognise.mts) reads which part of a battle a frame shows from
colour samples alone, cheap enough for every frame; [`src/tools/battle/menus.mts`](src/tools/battle/menus.mts) reads the
screens between battles off full screenshots. No phone's shape is the reference: a position down the screen is written
as where the game pins the piece — the top edge, the foot, or a fraction of the height between — and how many of the
screen's widths it sits from there, a number every phone agrees on, as
[`src/tools/battle/layout.mts`](src/tools/battle/layout.mts) explains. A position added needs its anchor too, measured
on both the Pixel 8 Pro's fixtures and the Pixel 4 XL's, which the tests read alike. `pnpm battle record` saves what the
recognisers are tuned against, at the phone's own shape:

```sh
pnpm battle record --seconds 60 battle.h264
```

## Live PokeMap watcher

`pnpm watch:livepokemap` keeps a [Live PokeMap](https://livepokemap.com) session open the way a browser tab would and
pushes a notification to a phone through [ntfy](https://ntfy.sh) for each spawn one of its queries wants. A query is a
Live PokeMap display filter, one file each: whatever its own **Export** writes, or the shiny hunt the
[Integrations page](#import-into-live-pokemap) copies, pasted into a file.

```sh
LPM_USERNAME=… LPM_PASSWORD=… NTFY_TOPIC=… pnpm watch:livepokemap shiny-hunt.json perfect-dratini.json
```

It runs in the foreground until stopped. Leave `NTFY_TOPIC` unset to run it console only: each match is printed in full
instead, with a Google Maps link, once per spawn as a notification would be. `NTFY_SERVER` points it at an ntfy server
other than `ntfy.sh`, and `NTFY_TOKEN` gives it an access token for one that needs it. Subscribe to the same topic in
the ntfy app on the phone. The topic is as good as a password on the public server, since anyone who knows it can read
what is sent there, so pick one nobody would guess. It gives each connect two seconds per address family rather than
Node's 250 ms, which `ntfy.sh` overruns from a slow link, so no `NODE_OPTIONS` is needed for that. None of these values,
nor the token the login answers, is ever printed; `--verbose` adds each request as it is sent and a line per poll.

Any of these can go in a `.env` at the repository root instead of the command line, one `NAME=value` per line, which git
ignores. One set on the command line still wins over the file.

Each notification names the species and form, why it matched (shiny, 100%, XXL, XXS), IV, CP and level, where the spawn
is and when it despawns, and opens that spot in Google Maps when tapped. A spawn notifies once however many queries want
it and however many polls carry it.

**What the world view can see.** The watcher watches the whole world, as the map does zoomed all the way out. From there
the server answers two lists: every 100% IV spawn, whatever species the filter names, and the account's own shinies of
the species it does name. A spawn in the first list is wanted where the filter would draw it on the map, so a shiny hunt
still notifies every 100% spawn while its `alwaysShowPerfect` is on — the default — as its map would show them. A shiny
is wanted where the filter's species list admits it. Nothing else reaches the world view: a 98% spawn, an XXL below
100%, a 0%, a PvP rank, a rare species. A query asking for any of those is told so when the command starts, rather than
left to wait for something that cannot come.

**What the account can see.** Live PokeMap shows Pokémon with IVs from its Explorer plan up, and your own shinies only
on Premium. The first poll says whether the account has shiny access; without it, no shiny is ever notified.

**How it behaves.** It asks once per `viewport_refresh_seconds` from `/api/config` (15 today, and never under 5, as the
page holds it), with one request however many queries, carrying a filter wide enough for all of them. Before the first
it makes the reads the page makes on load, and it never writes: the page saves your interface preferences on load, and
doing the same would overwrite your display filters with the watcher's. The login's token lasts a day with no way to
refresh it, so a refused token is answered by logging in again. A refused or failed request is waited out, doubling from
30 seconds to 15 minutes, rather than asked again at the poll rate; a login refused outright stops the command.

Automated access is against Live PokeMap's terms, and the account is at risk however closely the watcher keeps to what
one tab does — Node's requests do not look like Chrome's to Cloudflare, whatever headers they carry. The risk is yours
to weigh.

## Prior art

The Events page began as a look at three sites covering the same ground, each worth visiting in its own right:

| Site                                                           | What it is                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [PGO Calendar](https://vivific.github.io/pgocalendar/)         | A calendar of current and upcoming events.                                        |
| [Event Board](https://hydrorx1.github.io/POGO-Event-Timezone/) | The same events read against a world clock, and it publishes iCalendar feeds too. |
| [SWFLJOHN](https://swfljohn.com)                               | Events and GPX routes on one site — the pair of things this repository holds.     |

The last two are built on the same [ScrapedDuck](https://github.com/bigfoott/ScrapedDuck) mirror of Leek Duck as the
Events page here, so an event missing from one is usually missing from all three.
