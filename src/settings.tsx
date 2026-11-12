/**
 * The settings control at the end of the top bar, beside the notifications, on every tab: a gear that opens a panel
 * for what belongs to the browser rather than to any one page. So far that is the backup of everything this app keeps
 * in `localStorage` — export it as a file, or import one back — which lived on the Events page while the events
 * preferences were the only thing stored, and moved here once other tabs had choices of their own worth carrying. The
 * phone held over WebUSB was here too, and has a control of its own in the bar now, in `phone.tsx`.
 */

import { useRef, useState } from 'preact/hooks';

import { backupName, restoreBackup, writeBackup } from './backup.js';
import { download } from './dom.js';
import { said } from './errors.js';
import { eventStore } from './event-store.js';
import { useDismiss } from './popover.js';

export function Settings() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  /**
   * What the last import or failed export had to say, or null with nothing to say. A line of its own rather than a
   * toast, since a refusal is the one thing here a reader may need to read twice and act on.
   */
  const [status, setStatus] = useState<string | null>(null);

  /**
   * The file picker Import clicks, hidden so the two controls match each other rather than one being browser-styled.
   */
  const picker = useRef<HTMLInputElement>(null);

  useDismiss(open, () => setOpen(false), root);

  /**
   * Hand the saved preferences over as a file. A storage failure is reported rather than swallowed: `writeBackup` lets
   * one through for exactly this reason, a download that quietly did not happen being worse than one that says why. A
   * download that did happen says nothing, the browser showing it already, and clears what an earlier attempt said.
   */
  function exportPrefs() {
    try {
      download(writeBackup(), backupName(new Date()), 'application/json');
      setStatus(null);
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
      const restored = restoreBackup(
        await file.text(),
        new Date(),
        (text, name) => download(text, name, 'application/json'),
        () => eventStore.restored(),
      );

      if (restored === null) {
        setStatus('That backup held no saved preferences, so nothing changed.');
        return;
      }

      const { written, rescued } = restored;

      // The one place the copy is explained, said only when it was taken, so the file in Downloads is not a mystery.
      setStatus(
        `Restored ${written} saved preference${written === 1 ? '' : 's'}.` +
          (rescued ? ' What it replaced was downloaded first.' : ''),
      );
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

        <section class="menu-section" aria-labelledby="settings-backup">
          <h2 id="settings-backup">Backup</h2>
          <p class="menu-note">Save this browser’s preferences as a file, or restore one.</p>

          <div class="menu-actions">
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
      </div>
    </div>
  );
}
