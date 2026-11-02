/**
 * The top tab bar, rendered from the one page table rather than written out per page.
 *
 * This is the duplication the move onto a single document was able to delete: the same five links were a `<nav>` block
 * in each of the five documents, each block marking a different tab `aria-current` by hand, so adding a page meant six
 * edits and getting one wrong showed as two current tabs or none.
 */

import { Notices } from './notices.js';
import { Phone } from './phone.js';
import { PAGES, toHash, type Page } from './router.js';
import { Settings } from './settings.js';

/**
 * A tab links the page's bare fragment, so clicking one opens that page in its default state rather than carrying the
 * query across. Nothing else would make sense: a `q` typed into the Pokédex filter means nothing on the Map.
 *
 * `aria-current` is derived from which page is open, which is what it is for — a reader on a screen reader is told
 * which tab they are on, and the stylesheet draws the same fact from the same attribute rather than from a second
 * class.
 */
export function Nav({ current }: { current: Page }) {
  return (
    <div class="topbar">
      <nav class="topnav">
        {PAGES.map(({ name, label, icon }) => (
          <a
            key={name}
            class="tab"
            href={toHash(name)}
            title={label}
            aria-current={name === current ? 'page' : undefined}
          >
            <span class="tab-icon" aria-hidden="true">
              {icon}
            </span>{' '}
            <span class="tab-label">{label}</span>
          </a>
        ))}
      </nav>

      {/*
       * Outside the `<nav>`, which scrolls sideways on a phone and so would clip the panels these open. None is a tab
       * either: the notifications go nowhere until a notice in them is chosen, and the phone and the settings belong to
       * no page.
       */}
      <Notices />
      <Phone />
      <Settings />
    </div>
  );
}
