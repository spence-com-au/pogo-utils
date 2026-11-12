/**
 * The notifications control at the end of the top bar, on every tab: how many notices are waiting, and the list of
 * them when opened.
 *
 * A notice is anything the reader has not acknowledged yet. The list is not a history — clearing one is acknowledging
 * it, and an acknowledged notice is gone rather than greyed. Three kinds so far: new events, and a new release of
 * PGSharp or of the Coin Bag. Another joins by adding a source to `SOURCES` that answers its own unacknowledged notices
 * and knows how to clear one or all of them.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

import { coinBagReleaseStore } from './coin-bag/release-store.js';
import { relative, type ParsedEvent } from './event-schedule.js';
import { eventStore, useEventStore } from './event-store.js';
import { pgsharpReleaseStore } from './pgsharp/release-store.js';
import { useDismiss } from './popover.js';
import { useReleaseStore } from './release-store.js';
import { toHash } from './router.js';

/** One entry in the list, whatever kind of thing it reports. */
export interface Notice {
  title: string;

  /**
   * The line under the title. A `Date` in it is drawn relative to when the list draws — "2 days ago" — with the day
   * itself on hover, so the times stay text the source cannot word ahead of the moment they are read.
   */
  detail: readonly (string | Date)[];

  /** Unique across every kind, so a source prefixes its own IDs. */
  key: string;

  /** Where choosing it takes the reader. */
  href: string;

  /**
   * Off this site, so opened in a new tab — and acknowledged by being chosen, since nothing here learns otherwise that
   * the reader followed it. An event needs neither: its link opens the Events page on it, which acknowledges it there.
   */
  external?: boolean;

  /** Acknowledge it, which is what takes it off the list — and off anywhere else the same fact is shown. */
  clear: () => void;
}

const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/**
 * One notice per event the Events page would mark New. Choosing one opens that page on the event, through the same
 * `?event=` link the Map page's route cards use; clearing one marks the event seen, which takes the mark off its card.
 */
function eventNotices(): Notice[] {
  return eventStore.newlyVisible().map(eventNotice);
}

/**
 * The notice for one event. Its start stays a date, being what a reader plans around; the relative time is when the
 * site first vended the event, as a release's is when it was first seen, and an event not yet stamped has none.
 */
export function eventNotice(ev: ParsedEvent): Notice {
  return {
    key: `event:${ev.eventID}`,
    title: ev.name,
    detail: [
      [ev.heading || ev.eventType, ev.start ? `from ${dayFmt.format(ev.start)}` : 'date unknown'].join(' · '),
      ...(ev.added ? [' · seen ', ev.added] : []),
    ],
    href: toHash('events', `event=${encodeURIComponent(ev.eventID)}`),
    clear: () => eventStore.acknowledge([ev]),
  };
}

/**
 * The PGSharp release, while it is a version this browser has not acknowledged — never on a first visit, which takes
 * the current one as its baseline. Choosing it downloads that APK, the same link the Integrations page's button names.
 */
function pgsharpNotices(): Notice[] {
  const release = pgsharpReleaseStore.unacknowledged();

  return release === null
    ? []
    : [
        {
          key: `pgsharp:${release.version}`,
          title: `PGSharp ${release.version}`,
          detail: ['Seen ', new Date(release.firstSeen), ' · Download the APK'],
          href: release.url,
          external: true,
          clear: () => pgsharpReleaseStore.acknowledge(),
        },
      ];
}

/**
 * The Coin Bag release, on the same terms as PGSharp's. Choosing it opens the release's page rather than downloading
 * either build, since the page is where a reader picks the APK or the IPA.
 */
function coinBagNotices(): Notice[] {
  const release = coinBagReleaseStore.unacknowledged();

  return release === null
    ? []
    : [
        {
          key: `coin-bag:${release.version}`,
          title: `Coin Bag ${release.version}`,
          detail: ['Seen ', new Date(release.firstSeen), ' · See the release'],
          href: release.url,
          external: true,
          clear: () => coinBagReleaseStore.acknowledge(),
        },
      ];
}

/**
 * One kind of notice: what of it is waiting, and how to clear all of that at once. The second is its own rather than a
 * loop over each notice's `clear`, which for events would write the seen set and redraw every reader once per event.
 */
interface Source {
  notices: () => Notice[];
  clearAll: () => void;
}

/** Every kind of notice, in the order the list shows them. */
const SOURCES: readonly Source[] = [
  { notices: pgsharpNotices, clearAll: () => pgsharpReleaseStore.acknowledge() },
  { notices: coinBagNotices, clearAll: () => coinBagReleaseStore.acknowledge() },
  { notices: eventNotices, clearAll: () => eventStore.acknowledge(eventStore.newlyVisible()) },
];

export function Notices() {
  // Each redraws this whenever its store changes; the stores themselves are read through `SOURCES`.
  useEventStore();
  useReleaseStore(pgsharpReleaseStore);
  useReleaseStore(coinBagReleaseStore);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Each file once per document, whichever tab it opens on. The Events and Integrations pages ask for the same loads
  // and are handed them.
  useEffect(() => {
    void eventStore.ensureLoaded();
    void pgsharpReleaseStore.ensureLoaded();
    void coinBagReleaseStore.ensureLoaded();
  }, []);

  useDismiss(open, () => setOpen(false), root);

  const notices = SOURCES.flatMap((source) => source.notices());
  const count = notices.length;
  const now = new Date();
  const label = count === 0 ? 'Notifications: none' : `Notifications: ${count} new`;

  return (
    <div class="menu notices" ref={root}>
      <button
        type="button"
        class="menu-toggle"
        aria-expanded={open}
        aria-controls="notices-list"
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">🔔</span>
        {count > 0 && (
          <span class="notices-count" aria-hidden="true">
            {count}
          </span>
        )}
      </button>

      <div class="menu-panel" id="notices-list" hidden={!open}>
        <div class="menu-head">
          <span>Notifications</span>
          {count > 0 && (
            <button
              type="button"
              class="notices-clear-all"
              onClick={() => {
                for (const source of SOURCES) {
                  source.clearAll();
                }
              }}
            >
              Clear all
            </button>
          )}
        </div>

        {count === 0 ? (
          <p class="notices-empty">Nothing new.</p>
        ) : (
          <ul>
            {notices.map((notice) => (
              <li key={notice.key}>
                <a
                  href={notice.href}
                  target={notice.external ? '_blank' : undefined}
                  rel={notice.external ? 'noopener' : undefined}
                  onClick={() => {
                    setOpen(false);

                    if (notice.external) {
                      notice.clear();
                    }
                  }}
                >
                  <span class="notices-title">{notice.title}</span>
                  <span class="notices-detail">
                    {notice.detail.map((part) =>
                      typeof part === 'string' ? (
                        part
                      ) : (
                        <time dateTime={part.toISOString()} title={dayFmt.format(part)}>
                          {relative(part, now)}
                        </time>
                      ),
                    )}
                  </span>
                </a>
                <button
                  type="button"
                  class="notices-clear"
                  title="Clear this notification"
                  aria-label={`Clear “${notice.title}”`}
                  onClick={notice.clear}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
