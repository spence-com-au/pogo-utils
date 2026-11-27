/**
 * The settings control at the end of the top bar, beside the notifications, on every tab: a gear that opens a panel
 * for what belongs to the browser rather than to any one page. So far that is the backup of everything this app keeps
 * in `localStorage` and IndexedDB — export it as a file, or import one back — which lived on the Events page while the
 * events preferences were the only thing stored, and moved here once other tabs had choices of their own worth
 * carrying. The phone held over WebUSB was here too, and has a control of its own in the bar now, in `phone.tsx`.
 */

import { useRef, useState } from 'preact/hooks';

import { backupName, restoreBackup, writeBackup } from './backup.js';
import { download } from './dom.js';
import { said } from './errors.js';
import { eventStore } from './event-store.js';
import { inventoryStore } from './inventory-store.js';
import { JsonFileButton } from './json-file-button.js';
import { useDismiss } from './popover.js';

export function Settings() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  /**
   * What the last import or failed export had to say, or null with nothing to say. A line of its own rather than a
   * toast, since a refusal is the one thing here a reader may need to read twice and act on.
   */
  const [status, setStatus] = useState<string | null>(null);

  useDismiss(open, () => setOpen(false), root);

  /**
   * Hand what is saved over as a file. A storage failure is reported rather than swallowed: `writeBackup` lets
   * one through for exactly this reason, a download that quietly did not happen being worse than one that says why. A
   * download that did happen says nothing, the browser showing it already, and clears what an earlier attempt said.
   */
  async function exportPrefs() {
    try {
      download(await writeBackup(), backupName(new Date()), 'application/json');
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
      const written = await restoreBackup(await file.text(), () => {
        eventStore.restored();
        void inventoryStore.restore();
      });

      setStatus(
        written === null
          ? 'That backup has nothing saved, so nothing changed.'
          : `Restored ${written} saved item${written === 1 ? '' : 's'}.`,
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
          <p class="menu-note">Save what this browser keeps for this site as a file, or restore one.</p>

          <div class="menu-actions">
            <button type="button" title="Download everything saved as a file" onClick={() => void exportPrefs()}>
              Export
            </button>
            <JsonFileButton
              title="Restore a saved file, replacing only what it holds"
              onFile={(file) => void importPrefs(file)}
            >
              Import
            </JsonFileButton>
          </div>

          {/*
           * Present from the first render even with nothing to say: `hidden` takes an element out of the accessibility
           * tree, so a live region that arrives with its first message reads as a region appearing rather than as one
           * whose contents changed, and the refusal goes unannounced to the reader who most needs it. Empty rather than
           * `hidden`, and `:empty` is what keeps it from costing a gap.
           */}
          <p class="menu-status" aria-live="polite">
            {status}
          </p>
        </section>
      </div>
    </div>
  );
}
