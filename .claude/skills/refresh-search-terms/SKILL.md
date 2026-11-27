---
name: refresh-search-terms
description: >-
  Audits the Search page's hand-kept facts — the legacy moves list, the search terms and the mega and buddy levels in
  `src/search/terms.ts`, and the precedence rule `src/search/clauses.ts` rests on — against Niantic's help articles, the
  SearchPhrases community list and p337, then proposes the edits. Use this whenever the user asks to refresh, audit or
  update the search terms or search logic, asks whether the legacy moves are current, mentions a new search keyword or
  mega level, or a season's move rebalance has landed.
---

# Refreshing the search terms

Most of what the Search page knows is derived: species, forms, types and movesets come from the game master that
`pnpm vend:game-master` writes to `data/game-master.json`. What this skill audits is the rest, the facts transcribed by
hand because no machine-readable source has them, each with the source it was read off named in its doc comment:

- **`LEGACY_MOVES`** in `src/search/terms.ts`: each species beside a move it can no longer learn, dated by the line
  above it ("listed them on …").
- **The terms**: `GROUPS`, `RANGE_TABLE`, `SHORTCUTS` and `BUDDY_LEVELS` in the same file, including the `max` of
  `megalevel` and `buddylevel`.
- **The precedence rule** the whole of `src/search/clauses.ts` rests on: a `,` binds tighter than an `&`.

The job ends on a report and a wait. Every source is a page written for people, and its claims need judging before any
of them reaches the code.

## The sources

Four, fixed, so one run compares with the next.

| Source                                                                                                                    | Authority for                                  | Read                        |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------- |
| [Niantic FAQ 1486](https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/1486-searching-filtering-your-pokemon-inventory/) | the official vocabulary and syntax, `buddy0–5` | the whole article           |
| [Niantic FAQ 3331](https://niantic.helpshift.com/hc/en/6-pokemon-go/faq/3331-how-can-i-increase-a-pokemon-s-mega-level/)  | how many mega levels there are                 | the whole article           |
| [SearchPhrases](https://leidwesen.github.io/SearchPhrases/js/code.js)                                                     | community-found terms and the precedence quote | the `phraseData` array only |
| [p337 legacy moves](https://www.p337.info/pokemongo/pages/legacy-moves/)                                                  | which moves are legacy, per species            | the legacy table            |

SearchPhrases is three tables in one page, and only one is the storage search this site writes for: `phraseData`. The
other two, `friendData` and `dexData`, describe different search boxes with their own rules, so a claim read off them
says nothing about storage. Its tables live in `js/code.js` rather than the page's HTML, which is why that is the URL.

## Reading them

Download each source with `curl -sL` into its own file in the scratchpad and read the file. The finding is often a row
that is missing, so read the bytes the site served: a summarising fetch tool can drop a row or tidy a table into one the
page never had.

Each download proves itself before anything is compared against it. A non-200 status, a file without the article's
title, a `code.js` without `phraseData` or a p337 page without `Roar of Time` means the page moved or changed shape:
stop and report that source as unread rather than diffing against an empty table.

## The checks

Work through all four. Each ends when every row on both sides is accounted for — matched, proposed or reported.

1. **The precedence quote.** Find `always considering ,s nested inside &s` in `phraseData`'s source, beside the
   `meowth,alola&vulpix,galar` example. Gone or reworded is the most serious finding there is: every search string the
   site writes assumes it.
2. **The terms.** Compare every term in `phraseData` and FAQ 1486 with the terms, prefixes and shortcuts in `terms.ts`,
   both ways. A source term the site lacks is a candidate. A site term a source now says is gone, renamed or broken is a
   defect.
3. **The levels.** Compare the mega levels FAQ 3331 names with `megalevel`'s `max`, and the buddy levels FAQ 1486 and
   `phraseData` give with `buddylevel`'s `max` and `BUDDY_LEVELS`. The doc comment above `RANGE_TABLE` says why each
   ceiling is what it is; a source that now settles what it left open is a proposal.
4. **The legacy moves.** Compare p337's table with `LEGACY_MOVES`, both ways. For each row to add, prove its spelling:
   - The move must be a `name` in `data/game-master.json`'s `moves`, lower-cased as the existing rows are. p337 writes
     names for people, so a spelling the game master lacks needs resolving before it is proposed.
   - The game completes a move's name, so `@acid` also matches Acid Spray, which Muk learns now. A row is only ever
     asked of its own species, so list the moves the term is a prefix of among the `moves` of that species' entries in
     `data/game-master.json`'s `forms`, every form included. Another species' move cannot misfire: `Psybeam+` is under
     `megas`, a Mega Malamar's, and never Chansey's. Where the term takes in a move its own species learns, qualify it
     by slot as `@1acid` is: `@1` for a fast move and `@2` for a charged one, from the move's `fast`. Two moves in the
     same slot cannot be told apart this way, so report that row rather than propose it.
   - The doc comment above `LEGACY_MOVES` covers forms the search cannot name. Read it before proposing a row for a
     species with forms.

**A site term no source mentions is unverified, not gone.** These pages document terms rather than list every one, so
report it for the user to try in the game. Only a source saying a term is gone, or the user's own check on the phone,
justifies proposing its removal.

## The report

Report in the chat, in this order, then wait for the user:

1. **Anything that makes strings the site already writes wrong**: the precedence quote changed, a term the site writes
   that a source says is gone, a `LEGACY_MOVES` row p337 no longer lists. These are live, so they lead.
2. **`LEGACY_MOVES` changes**: each with p337's row, the exact line to add or delete and, for an addition, the prefix
   matches found and the slot chosen.
3. **Terms and levels the site lacks**, each as a `feature-request` candidate. A new term is a new pill with its own
   label and group, which is a feature rather than a refresh.
4. **Unverified terms**: site terms no source mentions, for the user to try in the game.
5. **What each source showed unchanged**, one line apiece, plus any source reported unread. A report listing only
   differences reads the same as one whose sources were never opened.

## Landing the approved changes

1. Edit `src/search/terms.ts` and set the date on the line above `LEGACY_MOVES` to the day p337 was read. A ceiling that
   changes takes its doc comment with it, since that comment says why the ceiling is what it is.
2. Run `pnpm lint` and `pnpm test src/search`. The `legacymovesets` preset's expected clauses in
   `src/search/query.test.ts` move with `LEGACY_MOVES`, so update them and check the diff is only the rows you changed.
3. Commit and open one pull request for the run, as the repository's `CLAUDE.md` and pull request rules say.
4. File each approved term or level candidate with the `feature-request` skill, naming the source and quoting the row,
   and link the issues from the pull request.
