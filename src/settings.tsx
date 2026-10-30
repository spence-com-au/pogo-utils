/**
 * The settings control at the end of the top bar, beside the notifications, on every tab: a gear that opens a panel
 * for what belongs to the browser rather than to any one page. So far that is two things. The backup of everything this
 * app keeps in `localStorage` — export it as a file, or import one back — lived on the Events page while the events
 * preferences were the only thing stored, and moved here once other tabs had choices of their own worth carrying. The
 * phone held over WebUSB lived on the Inventory page, and moved here once the Search page used it too.
 */

import { useRef, useState } from 'preact/hooks';

import { applyBackup, backupName, ownedKeys, parseBackup, rescueName, writeBackup } from './backup.js';
import { putBack } from './battle/awake.js';
import { said } from './errors.js';
import { eventStore } from './event-store.js';
import { DEMO_SERIAL, phoneStore, usePhone } from './phone-store.js';
import { useDismiss } from './popover.js';

/**
 * Hand text over as a download, a synthetic click on an `<a download>` being the only way a page can name a file.
 * `downloadBytes` in `src/pages/integrations.tsx` is the same shape for bytes, and the two are worth collapsing into
 * `dom.ts` as their own change — one that reaches a page this one does not touch.
 */
function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');

  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Settings() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  /**
   * What the last export or import had to say, or null before either. A line of its own rather than a toast, since a
   * refusal is the one thing here a reader may need to read twice and act on.
   */
  const [status, setStatus] = useState<string | null>(null);

  /**
   * The file picker Import clicks, hidden so the two controls match each other rather than one being browser-styled.
   */
  const picker = useRef<HTMLInputElement>(null);

  const phone = usePhone();
  const demo = phone?.serial === DEMO_SERIAL;

  /** What the last attempt to connect a phone has to say, or null once there is nothing to add to the phone held. */
  const [phoneStatus, setPhoneStatus] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useDismiss(open, () => setOpen(false), root);

  /**
   * Offer the browser's chooser and hold whatever is picked. `webusb.ts` is fetched only now: it brings Tango, which
   * would otherwise load on every tab for a menu most visits never open. A browser with no WebUSB finds out here too,
   * `connect` refusing with the reason.
   */
  async function connectPhone() {
    setConnecting(true);
    setPhoneStatus('Pick the phone in the browser’s chooser, then allow USB debugging on it…');

    try {
      const { connect } = await import('./inventory/webusb.js');
      const picked = await connect();

      // The chooser dismissed, which keeps whatever phone is already connected rather than letting it go for nothing.
      if (picked === null) {
        setPhoneStatus(phoneStore.phone ? null : 'No phone was picked.');
        return;
      }

      await phoneStore.hold(picked);
      setPhoneStatus(null);

      // A battle whose tab was closed mid-run left the phone kept awake, which is put back now that it is here again.
      await putBack(picked).catch((e: unknown) =>
        setPhoneStatus(`Could not put back the setting a battle kept the phone awake by: ${said(e)}`),
      );
    } catch (e) {
      setPhoneStatus(`Could not connect: ${said(e)}`);
    } finally {
      setConnecting(false);
    }
  }

  /**
   * Hold the demo phone, or put it away. Never in place of a real one, which may be partway through something: the
   * buttons below see to the one held, Connect waiting on the demo and the demo on a phone let go, and `lend` to one
   * lent to a battle, which nothing is held in place of, by taking it back over the demo once the battle ends.
   */
  async function toggleDemo() {
    setPhoneStatus(null);

    try {
      if (phone?.serial === DEMO_SERIAL) {
        await phone.close();
      } else {
        const { demoPhone } = await import('./inventory/demo.js');

        // Asked again once the module is in, which a first use waits on: a phone picked in the chooser meanwhile, or
        // taken back by a battle that ended, is real, and `hold` would close it.
        if (phoneStore.phone === null) {
          await phoneStore.hold(demoPhone());
        }
      }
    } catch (e) {
      setPhoneStatus(`Could not start the demo: ${said(e)}`);
    }
  }

  /**
   * Hand the saved preferences over as a file. A storage failure is reported rather than swallowed: `writeBackup` lets
   * one through for exactly this reason, a download that quietly did not happen being worse than one that says why.
   */
  function exportPrefs() {
    try {
      const name = backupName(new Date());

      downloadText(writeBackup(), name);
      setStatus(`Saved ${name}.`);
    } catch (e) {
      setStatus(`Could not save a backup: ${said(e)}`);
    }
  }

  /**
   * Read a backup back, over whatever is stored now. Keys the file omits are left alone, so a faithful restore is one
   * into a cleared browser, which is the browser's own site data: an import writes through anything in the namespace,
   * and nothing in the app clears it.
   */
  async function importPrefs(file: File) {
    try {
      const incoming = parseBackup(await file.text());

      // Nothing in the file is nothing to change, and leaving before the copy and the corrections is what makes the
      // message below true: the copy would put a file in the reader's Downloads for an import that touched nothing,
      // and the corrections are not free — the Events page closes a reveal the reader had opened — so running them
      // anyway would say nothing changed on the one render where *Ended* had just emptied itself.
      if (incoming.length === 0) {
        setStatus('That backup held no saved preferences, so nothing changed.');
        return;
      }

      // Judged before anything is saved and saved before anything is written, so a copy is taken only for a file that
      // is about to be applied. This is the undo: a reader who picks the wrong file has nothing else to go back to,
      // and the keys it replaces are the ones nothing can reconstruct.
      //
      // The skip is not a formality. `settleSeen` writes `seen` as soon as the feed lands, so a loaded page nearly
      // always has something stored — except in the one flow this exists for, a reader who has just cleared their
      // browser and imports before the feed arrives, where a copy of nothing would be the first thing they saw.
      if (ownedKeys().length > 0) {
        downloadText(writeBackup(), rescueName(new Date()));
      }

      const written = applyBackup(incoming);

      eventStore.restored();

      setStatus(`Restored ${written.length} saved preference${written.length === 1 ? '' : 's'}.`);
    } catch (e) {
      setStatus(`Could not restore that backup: ${said(e)}`);
    }
  }

  return (
    <div class="menu settings" ref={root}>
      <button
        type="button"
        class="menu-toggle"
        aria-expanded={open}
        aria-controls="settings-panel"
        aria-label="Settings"
        title="Settings"
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">⚙️</span>
      </button>

      <div class="menu-panel" id="settings-panel" hidden={!open}>
        <div class="menu-head">
          <span>Settings</span>
        </div>

        <section class="settings-section" aria-labelledby="settings-backup">
          <h2 id="settings-backup">Backup</h2>
          <p class="settings-note">
            Save the preferences this browser has stored as a file, or read one back. An import replaces the preferences
            the file names, leaves the rest, and first downloads a copy of what it replaces.
          </p>

          <div class="settings-actions">
            <button type="button" title="Save every preference this browser has stored as a file" onClick={exportPrefs}>
              Export
            </button>
            <button
              type="button"
              title="Read a saved file back, replacing the preferences it names and leaving the rest"
              onClick={() => picker.current?.click()}
            >
              Import
            </button>
          </div>

          {/*
           * Clicked by the button above rather than shown, a file input being unstyleable. `value` is cleared as the
           * change is read so that picking the same file twice in a row fires a second time rather than nothing.
           */}
          <input
            ref={picker}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const [file] = event.currentTarget.files ?? [];

              event.currentTarget.value = '';

              if (file !== undefined) {
                void importPrefs(file);
              }
            }}
          />

          {/*
           * Present from the first render even with nothing to say: `hidden` takes an element out of the accessibility
           * tree, so a live region that arrives with its first message reads as a region appearing rather than as one
           * whose contents changed, and the refusal goes unannounced to the reader who most needs it. Empty rather than
           * `hidden`, and `:empty` is what keeps it from costing a gap.
           */}
          <p class="settings-status" aria-live="polite">
            {status}
          </p>
        </section>

        <section class="settings-section" aria-labelledby="settings-phone">
          <h2 id="settings-phone">Phone</h2>
          <p class="settings-note">
            Connect an Android phone with USB debugging on, for the Inventory tab to read its screen and the Search tab
            to type into its storage. Close any <code>adb</code> server first: a phone held by one cannot be claimed
            here. Where the connection will not come up, <a href="https://webadb.com/">WebADB</a> is a shell over the
            same WebUSB to find out why. The phone stays connected from tab to tab until it is unplugged or the site is
            closed. With no phone to hand, the demo phone shows what the tabs do with recorded screens.
          </p>

          <div class="settings-actions">
            <button
              type="button"
              disabled={connecting || demo}
              title={demo ? 'Put the demo phone away first' : undefined}
              onClick={() => void connectPhone()}
            >
              {phone && !demo ? 'Connect another phone' : 'Connect a phone'}
            </button>
            <button
              type="button"
              disabled={connecting || (phone !== null && !demo)}
              title={phone && !demo ? 'Only with no phone connected' : undefined}
              onClick={() => void toggleDemo()}
            >
              {demo ? 'Put the demo phone away' : 'Use a demo phone'}
            </button>
          </div>

          {/* Present from the first render, for the reason the backup's status above is. */}
          <p class="settings-status" aria-live="polite">
            {phoneStatus ??
              (demo
                ? 'Using the demo phone: the tabs read recorded screens, not your account.'
                : phone
                  ? `Connected to ${phone.name}.`
                  : null)}
          </p>
        </section>
      </div>
    </div>
  );
}
