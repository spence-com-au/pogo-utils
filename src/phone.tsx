/**
 * The phone control in the top bar, between the notifications and the settings, on every tab: a phone with a dot, red
 * while no Android phone is held over WebUSB and green while one is, so the bar says which from any tab. A press opens
 * a panel. With a phone held, it says which phone it is, with a button to let it go; with none, its button offers the
 * browser's chooser to connect one. Connecting waits for that button rather than coming with the press, so a press
 * does the same whether a phone is held or not.
 *
 * The demo phone, which reads recorded screens in place of a phone, is kept out of the way behind `?demo`: with it in
 * the address, the panel's button holds the demo phone rather than offering the chooser.
 */

import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { putBack } from './battle/awake.js';
import { loadChunk } from './chunks.js';
import type { About } from './core/adb.mts';
import type { Phone as Held } from './core/browser/webusb.js';
import { said } from './errors.js';
import { DEMO_SERIAL, phoneStore, usePhone } from './phone-store.js';
import { useDismiss } from './popover.js';
import { ticked } from './ticked.js';

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

  const [open, setOpen] = useState(false);

  /** What the last press of Connect has to say, or null with nothing to add. */
  const [status, setStatus] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  /**
   * What a phone said of itself, or why it could not, kept with the phone it was asked of, so the panel never lists one
   * phone's details under the next one's name.
   */
  const [about, setAbout] = useState<{ phone: Held; about?: About; failed?: string } | null>(null);
  const known = about?.phone === phone ? about : null;

  /** Closes the panel and what the last press said with it, the connection going on without them. */
  function close() {
    setOpen(false);
    setStatus(null);
  }

  // The chooser is the browser's own and modal, so nothing outside it reaches the page to close the panel while it is
  // up.
  useDismiss(open, close, root);

  // Asked at every opening rather than kept, the charge being a part that moves, and again for a phone connected or
  // taken back from a battle while the panel is open.
  useEffect(() => {
    if (open && phone) {
      void ask(phone);
    }
  }, [open, phone]);

  /**
   * Says `message` in the panel, opening it again where it was closed meanwhile: the page is live again once the
   * chooser has gone, while the phone waits for USB debugging to be allowed, and why it did not connect is worth
   * reading.
   */
  function tell(message: string) {
    setStatus(message);
    setOpen(true);
  }

  /**
   * Offer the browser's chooser and hold whatever is picked. `webusb.ts` is fetched only now: it brings Tango, which
   * would otherwise load on every tab for a control most visits never press. A browser with no WebUSB finds out here
   * too, `connect` refusing with the reason.
   */
  async function connectPhone() {
    setConnecting(true);
    setStatus('Pick the phone in the browser’s chooser, then allow USB debugging on it…');

    try {
      const { connect } = await loadChunk(() => import('./core/browser/webusb.js'));
      const picked = await connect();

      // The chooser dismissed, or a phone picked in it that this page still has claimed, as one disconnected a moment
      // ago may be.
      if (picked === null) {
        setStatus(null);
        return;
      }

      await phoneStore.hold(picked);
      setStatus(null);

      // A battle whose tab was closed mid-run left the phone kept awake, which is put back now that it is here again.
      await putBack(picked).catch((e: unknown) =>
        tell(`Could not put back the setting a battle kept the phone awake by: ${said(e)}`),
      );
    } catch (e) {
      tell(`Could not connect: ${said(e)}`);
    } finally {
      setConnecting(false);
    }
  }

  /**
   * Hold the demo phone. Never in place of a real one, which may be partway through something: Connect is offered only
   * while none is held, and `lend` sees to one lent to a battle, which nothing is held in place of, by taking it back
   * over the demo once the battle ends.
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
      tell(`Could not start the demo: ${said(e)}`);
    }
  }

  /**
   * Ask `held` what it is, through a `Device` fetched only now, as `webusb.ts` is: it brings the PNG decoder with it.
   * The answer is kept only while that phone is still the one asked about, so a slow one cannot land on the next.
   */
  async function ask(held: Held) {
    setAbout({ phone: held });

    const answer = (got: { about: About } | { failed: string }) =>
      setAbout((was) => (was?.phone === held ? { phone: held, ...got } : was));

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
    setStatus(null);
    void phoneStore
      .release()
      ?.close()
      .catch(() => undefined);
  }

  const label = phone === null ? 'No phone connected' : demo ? 'Using the demo phone' : `Connected to ${phone.name}`;

  return (
    <div class="menu phone" ref={root}>
      <button
        type="button"
        class="menu-toggle"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span aria-hidden="true">📱</span>
        {/* A dot rather than a count, there being one phone at most: green while one is held, red while none is. */}
        <span class={phone ? 'phone-dot phone-held' : 'phone-dot'} aria-hidden="true" />
      </button>

      {open && (
        <div class="menu-panel">
          <div class="menu-head">
            <span>{phone ? phone.name : 'No phone connected'}</span>
          </div>

          <section class="menu-section">
            {phone === null ? (
              <p class="menu-note">
                {demoAsked()
                  ? 'Connect the demo phone, which plays back recorded screens in place of a phone.'
                  : 'Plug in an Android phone with USB debugging on, then connect it.'}
              </p>
            ) : known?.about ? (
              <dl class="phone-about">
                {rows(known.about, phone.serial).map(([term, value]) => (
                  <Fragment key={term}>
                    <dt>{term}</dt>
                    <dd>{value}</dd>
                  </Fragment>
                ))}
              </dl>
            ) : (
              <p class="menu-note">
                {known?.failed === undefined
                  ? 'Asking the phone what it is…'
                  : `Could not ask the phone what it is: ${known.failed}`}
              </p>
            )}

            <div class="menu-actions">
              {phone ? (
                <button type="button" onClick={disconnect}>
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  disabled={connecting}
                  onClick={() => void (demoAsked() ? holdDemo() : connectPhone())}
                >
                  Connect
                </button>
              )}
            </div>

            {/*
             * Added with its message rather than waiting empty: an alert is announced as it arrives, and `tell` can
             * open the panel with its message already in it, where an empty region would have had no time to wait.
             */}
            {status && (
              <p class="menu-status" role="alert">
                {ticked(status)}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
