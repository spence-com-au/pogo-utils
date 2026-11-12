/**
 * The phone control in the top bar, between the notifications and the settings, on every tab: a phone that, pressed,
 * offers the browser's chooser to connect the Android phone held over WebUSB. With no phone held, connecting is the
 * one thing to do with it, so a press does it rather than opening a panel to press again in; with one held, a press
 * opens a panel saying which phone it is, with a button to let it go. It is greyed out while no phone is held, and in
 * colour with a green dot while one is, so the bar says which from any tab.
 *
 * The demo phone, which reads recorded screens in place of a phone, is kept out of the way behind `?demo`: with it in
 * the address, a press holds the demo phone rather than offering the chooser, and its panel puts it away.
 */

import { Fragment } from 'preact';
import { useRef, useState } from 'preact/hooks';

import { putBack } from './battle/awake.js';
import { loadChunk } from './chunks.js';
import type { About } from './core/adb.mts';
import type { Phone as Held } from './core/browser/webusb.js';
import { said } from './errors.js';
import { DEMO_SERIAL, phoneStore, usePhone } from './phone-store.js';
import { useDismiss } from './popover.js';

/**
 * Whether the address asks for the demo phone: `/?demo#/inventory`, in the address's own query rather than the page's
 * in the fragment, which tab switches and the pages' own `replaceQuery` rewrite out from under it.
 */
const demoAsked = () => new URLSearchParams(location.search).has('demo');

/** The panel's list: what the phone said of itself, less what it said nothing of, and the serial it is found by. */
function rows({ maker, model, android, screen, battery }: About, serial: string) {
  return [
    ['Maker', maker],
    ['Model', model],
    ['Android', android],
    ['Screen', screen && `${screen[0]} × ${screen[1]}`],
    ['Battery', battery === undefined ? undefined : `${battery}%`],
    ['Serial', serial],
  ].filter((row): row is [string, string] => row[1] !== undefined);
}

export function Phone() {
  const root = useRef<HTMLDivElement>(null);

  const phone = usePhone();
  const demo = phone?.serial === DEMO_SERIAL;

  /**
   * What the last press has to say, or null once there is nothing to add to the phone held — which closes the note it
   * shows in. `failed` marks a failed connection, the one time it points to WebADB, a shell over the same WebUSB to
   * find out why: kept on the message rather than beside it, so the link cannot outlive the message it explains.
   */
  const [status, setStatus] = useState<{ message: string; failed?: boolean } | null>(null);
  const [connecting, setConnecting] = useState(false);

  /**
   * The phone whose panel is open, with what it said of itself once it has, or why it could not. Kept with the phone
   * rather than as a flag, so the panel closes by itself once that phone is unplugged or replaced rather than opening
   * again over the next.
   */
  const [panel, setPanel] = useState<{ phone: Held; about?: About; failed?: string } | null>(null);
  const shown = panel?.phone === phone ? panel : null;

  // A note waiting to be read closes as a menu would, the connection going on without it, so it cannot sit under the
  // notifications or settings panel opened meanwhile; the panel closes the same way. The chooser is the browser's own
  // and modal, so nothing outside it reaches the page to close the note while it is up.
  useDismiss(
    status !== null || shown !== null,
    () => {
      setStatus(null);
      setPanel(null);
    },
    root,
  );

  /**
   * Offer the browser's chooser and hold whatever is picked. `webusb.ts` is fetched only now: it brings Tango, which
   * would otherwise load on every tab for a control most visits never press. A browser with no WebUSB finds out here
   * too, `connect` refusing with the reason.
   */
  async function connectPhone() {
    setConnecting(true);
    setStatus({ message: 'Pick the phone in the browser’s chooser, then allow USB debugging on it…' });

    try {
      const { connect } = await loadChunk(() => import('./core/browser/webusb.js'));
      const picked = await connect();

      // The chooser dismissed, or the phone already held picked in it, which keeps whatever phone is already connected
      // rather than letting it go for nothing.
      if (picked === null) {
        setStatus(null);
        return;
      }

      await phoneStore.hold(picked);
      setStatus(null);

      // A battle whose tab was closed mid-run left the phone kept awake, which is put back now that it is here again.
      await putBack(picked).catch((e: unknown) =>
        setStatus({ message: `Could not put back the setting a battle kept the phone awake by: ${said(e)}` }),
      );
    } catch (e) {
      // Not pointed to WebADB where the browser has no WebUSB at all, which WebADB needs as much as this does.
      setStatus({ message: `Could not connect: ${said(e)}`, failed: 'usb' in navigator });
    } finally {
      setConnecting(false);
    }
  }

  /**
   * Hold the demo phone. Never in place of a real one, which may be partway through something: `press` opens the
   * panel instead while one is held, and `lend` sees to one lent to a battle, which nothing is held in place of, by
   * taking it back over the demo once the battle ends.
   */
  async function holdDemo() {
    setStatus(null);

    try {
      const { demoPhone } = await loadChunk(() => import('./demo-phone.js'));

      // Asked again once the module is in, which a first use waits on: a phone picked in the chooser meanwhile, or
      // taken back by a battle that ended, is real, and `hold` would close it.
      if (phoneStore.phone === null) {
        await phoneStore.hold(demoPhone());
      }
    } catch (e) {
      setStatus({ message: `Could not start the demo: ${said(e)}` });
    }
  }

  /**
   * Open the panel on `held` and ask it what it is, through a `Device` fetched only now, as `webusb.ts` is: it brings
   * the PNG decoder with it. Asked at every opening rather than kept, the charge being a part that moves. The demo
   * phone is not asked, having nothing to say.
   */
  async function show(held: Held) {
    setStatus(null);
    setPanel({ phone: held });

    if (held.serial === DEMO_SERIAL) {
      return;
    }

    // Kept only where the panel it was asked for is still open: one closed meanwhile stays closed.
    const answer = (got: { about: About } | { failed: string }) =>
      setPanel((was) => (was?.phone === held ? { phone: held, ...got } : was));

    try {
      const { Device } = await loadChunk(() => import('./core/adb.mts'));

      answer({ about: await new Device(held.transport).about() });
    } catch (e) {
      answer({ failed: said(e) });
    }
  }

  /**
   * Let the phone go: out of the store at once, so no tab starts on it meanwhile, then closed, which frees it for an
   * `adb` server on this computer. A phone that throws as it closes was unplugged already, and is gone either way.
   */
  function disconnect() {
    setPanel(null);
    void phoneStore
      .release()
      ?.close()
      .catch(() => undefined);
  }

  function press() {
    if (shown) {
      setPanel(null);
    } else if (phone) {
      void show(phone);
    } else if (demoAsked()) {
      void holdDemo();
    } else {
      void connectPhone();
    }
  }

  const label = demo
    ? 'Using the demo phone'
    : phone
      ? `Connected to ${phone.name}`
      : demoAsked()
        ? 'Use the demo phone'
        : 'Connect a phone';

  return (
    <div class="menu phone" ref={root}>
      <button
        type="button"
        class={phone ? 'menu-toggle' : 'menu-toggle phone-none'}
        aria-expanded={phone ? shown !== null : undefined}
        aria-label={label}
        title={label}
        disabled={connecting}
        onClick={press}
      >
        <span class="phone-icon" aria-hidden="true">
          📱
        </span>
        {/* A dot rather than a count, there being one phone at most: lit while one is held, so the bar says so. */}
        {phone && <span class="phone-held" aria-hidden="true" />}
      </button>

      {shown && (
        <div class="menu-panel">
          <div class="menu-head">
            <span>{shown.phone.name}</span>
          </div>

          <section class="menu-section">
            {demo ? (
              <p class="menu-note">Recorded screens, standing in for a phone.</p>
            ) : shown.about ? (
              <dl class="phone-about">
                {rows(shown.about, shown.phone.serial).map(([term, value]) => (
                  <Fragment key={term}>
                    <dt>{term}</dt>
                    <dd>{value}</dd>
                  </Fragment>
                ))}
              </dl>
            ) : (
              <p class="menu-note">
                {shown.failed === undefined
                  ? 'Asking the phone what it is…'
                  : `Could not ask the phone what it is: ${shown.failed}`}
              </p>
            )}

            <div class="menu-actions">
              <button type="button" onClick={disconnect}>
                Disconnect
              </button>
            </div>
          </section>
        </div>
      )}

      {/*
       * Added with its message rather than waiting empty: an alert is announced as it arrives, where a `hidden` note
       * holding a live region would take the region out of the accessibility tree along with it.
       */}
      {status && (
        <div class="menu-panel phone-note">
          <p role="alert">
            {status.message}
            {status.failed && (
              <>
                {' '}
                <a href="https://webadb.com/">WebADB</a> can help find out why.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
