/**
 * The phone control in the top bar, between the notifications and the settings, on every tab: a phone that, pressed,
 * offers the browser's chooser to connect the Android phone held over WebUSB. Not a menu: connecting is the one thing
 * to do with it, so a press does it rather than opening a panel to press again in. It is greyed out while no phone
 * is held, and in colour with a green dot while one is, so the bar says which from any tab.
 *
 * The demo phone, which reads recorded screens in place of a phone, is kept out of the way behind `?demo`: with it in
 * the address, a press holds the demo phone rather than offering the chooser, and a second puts it away.
 */

import { useRef, useState } from 'preact/hooks';

import { putBack } from './battle/awake.js';
import { loadChunk } from './chunks.js';
import { said } from './errors.js';
import { DEMO_SERIAL, phoneStore, usePhone } from './phone-store.js';
import { useDismiss } from './popover.js';

/**
 * Whether the address asks for the demo phone: `/?demo#/inventory`, in the address's own query rather than the page's
 * in the fragment, which tab switches and the pages' own `replaceQuery` rewrite out from under it.
 */
const demoAsked = () => new URLSearchParams(location.search).has('demo');

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

  // A note waiting to be read closes as a menu would, the connection going on without it, so it cannot sit under the
  // notifications or settings panel opened meanwhile. The chooser is the browser's own and modal, so nothing outside
  // it reaches the page to close the note while it is up.
  useDismiss(status !== null, () => setStatus(null), root);

  /**
   * Offer the browser's chooser and hold whatever is picked. `webusb.ts` is fetched only now: it brings Tango, which
   * would otherwise load on every tab for a control most visits never press. A browser with no WebUSB finds out here
   * too, `connect` refusing with the reason.
   */
  async function connectPhone() {
    setConnecting(true);
    setStatus({ message: 'Pick the phone in the browser’s chooser, then allow USB debugging on it…' });

    try {
      const { connect } = await loadChunk(() => import('./inventory/webusb.js'));
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
   * Hold the demo phone, or put it away. Never in place of a real one, which may be partway through something: `press`
   * offers the chooser instead while one is held, and `lend` sees to one lent to a battle, which nothing is held in
   * place of, by taking it back over the demo once the battle ends.
   */
  async function toggleDemo() {
    setStatus(null);

    try {
      if (phone?.serial === DEMO_SERIAL) {
        await phone.close();
      } else {
        const { demoPhone } = await loadChunk(() => import('./inventory/demo.js'));

        // Asked again once the module is in, which a first use waits on: a phone picked in the chooser meanwhile, or
        // taken back by a battle that ended, is real, and `hold` would close it.
        if (phoneStore.phone === null) {
          await phoneStore.hold(demoPhone());
        }
      }
    } catch (e) {
      setStatus({ message: `Could not start the demo: ${said(e)}` });
    }
  }

  function press() {
    if (demo || (phone === null && demoAsked())) {
      void toggleDemo();
    } else {
      void connectPhone();
    }
  }

  const label = demo
    ? 'Using the demo phone: press to put it away'
    : phone
      ? `Connected to ${phone.name}: press to connect another phone`
      : demoAsked()
        ? 'Use the demo phone'
        : 'Connect a phone';

  return (
    <div class="menu phone" ref={root}>
      <button
        type="button"
        class={phone ? 'menu-toggle' : 'menu-toggle phone-none'}
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
