/**
 * The Inventory page: one Pokémon's detail screen read end to end in the browser, which is what `pnpm inventory snap`
 * and `parse` do from a terminal. A phone connected over WebUSB — from the phone button, which every tab shares — is
 * asked for whatever it is showing, or a PNG already saved is dropped in, and the page prints what every reader makes
 * of it — the same four blocks `parse` prints, from the same `readScreen`.
 *
 * A screen a scan could not have used is refused, with the reason, rather than answered with a page of nulls: the map,
 * a Pokémon with PGSharp's overlay off, anything whose HP did not read. What the readers made of it is still there
 * under the refusal, folded away, the way `snap` prints its report before it refuses.
 *
 * Out of scope, deliberately: a scan of the whole of storage, its CSV, the flag passes and a scroll capture all stay
 * the CLI's. This reads one screen, as a phone shows it or as a file holds it.
 *
 * The OCR engine and the ADB stack are most of this chunk and nothing else uses them, which is why the page is reached
 * through `import()` like every other.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';

import { said } from '../errors.js';
import { read, unreadable } from '../inventory/reader.js';
import { usePhone } from '../phone-store.js';
import { Device } from '../tools/inventory/adb.mts';
import { type Line } from '../tools/inventory/ocr.mts';
import { decodePng, encodePng, type Image } from '../tools/inventory/png.mts';
import { NO_BOX, NO_OVERLAY, printable, refusals, type Reading } from '../tools/inventory/report.mts';

/** Where a screen came from, which names its download and says what the page is showing. */
interface Capture {
  image: Image;

  /** The file it came from, or the name a grab would be saved under. */
  name: string;

  /** Whether it came off the phone, and so is worth offering back as a file. */
  grabbed: boolean;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'done'; reading: Reading; refused: string[] }
  | { kind: 'failed'; message: string };

/** The view a block is printed in: JSON, which says `null` as `null` where a page of prose would leave a gap. */
const shown = (value: unknown) => JSON.stringify(value, null, 2);

/** One line as `--verbose` prints it, box first. */
const dumped = (l: Line) => `${`${l.left},${l.top} ${l.width}×${l.height}`.padEnd(22)} ${l.text}`;

/**
 * `Uint8Array` takes a type argument for the buffer behind it, and only one over an `ArrayBuffer` is a `BlobPart` — a
 * `SharedArrayBuffer` cannot be one. Copied rather than cast, `encodePng` answering the wide type.
 */
function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The four blocks `report` prints, in its order and under its labels. */
function Blocks({ reading }: { reading: Reading }) {
  return (
    <div class="blocks">
      <section>
        <h3>detail</h3>
        <pre>{shown(reading.detail)}</pre>
      </section>
      <section>
        <h3>moves</h3>
        <pre>{shown(reading.moves)}</pre>
      </section>
      <section>
        <h3>overlay box</h3>
        <pre>{reading.box ? shown(reading.box) : NO_BOX}</pre>
        <h3>overlay</h3>
        <pre>{reading.overlay ? shown(reading.overlay) : NO_OVERLAY}</pre>
      </section>
      <section>
        <h3>identity</h3>
        <pre>{shown(printable(reading.identity))}</pre>
      </section>
      <details class="lines">
        <summary>Every line OCR found</summary>
        <pre>{reading.lines.map(dumped).join('\n')}</pre>
      </details>
    </div>
  );
}

export default function InventoryPage() {
  const phone = usePhone();
  const [capture, setCapture] = useState<Capture | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const unread = unreadable();

  // The capture as a PNG, encoded once for the picture below and the download beside it.
  const png = useMemo(() => (capture ? Uint8Array.from(encodePng(capture.image)) : null), [capture]);

  // The picture of what is being read, as an object URL that is let go of when it is replaced or the page is left.
  useEffect(() => {
    if (png === null) {
      setPreview(null);

      return;
    }

    const url = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
    setPreview(url);

    return () => URL.revokeObjectURL(url);
  }, [png]);

  const busy = phase.kind === 'busy';

  async function readCapture(next: Capture) {
    setCapture(next);
    setPhase({ kind: 'busy', message: 'Reading…' });

    try {
      const reading = await read(next.image, (fraction) =>
        setPhase({
          kind: 'busy',
          message: `Fetching the OCR model, ${Math.round(fraction * 100)}% — once, then kept in this browser…`,
        }),
      );

      setPhase({ kind: 'done', reading, refused: refusals(reading) });
    } catch (e) {
      setPhase({ kind: 'failed', message: said(e) });
    }
  }

  async function grab() {
    if (phone === null) {
      return;
    }

    setPhase({ kind: 'busy', message: `Taking a screenshot on ${phone.name}…` });

    let image: Image;

    try {
      const device = new Device(phone.transport);

      await device.check();
      image = await device.screenshot();
    } catch (e) {
      setPhase({ kind: 'failed', message: `Could not take a screenshot: ${said(e)}` });

      return;
    }

    await readCapture({ image, name: `${new Date().toISOString().replaceAll(':', '-')}.png`, grabbed: true });
  }

  async function open(file: File) {
    let image: Image;

    try {
      image = decodePng(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      setPhase({ kind: 'failed', message: `${file.name}: ${said(e)}` });

      return;
    }

    await readCapture({ image, name: file.name, grabbed: false });
  }

  function dropped(event: DragEvent) {
    event.preventDefault();
    setDragging(false);

    const file = event.dataTransfer?.files[0];

    if (file && !busy && unread === null) {
      void open(file);
    }
  }

  return (
    <>
      <header class="page">
        <h1 class="sr">Inventory</h1>
        <p class="sub">
          Read one Pokémon’s detail screen — species, form, CP, HP, level, IVs, size, tags and moves — the way{' '}
          <code>pnpm inventory parse</code> does, in the browser. Nothing leaves the page.
        </p>
      </header>

      <main
        class={dragging ? 'reader dragging' : 'reader'}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={dropped}
      >
        <div class="panel">
          <h2>From a phone</h2>

          <p>
            Connect an Android phone with 📱 in the top bar, open a Pokémon in Pokémon GO with PGSharp’s IV display
            showing, and take whatever it shows.
          </p>

          <div class="actions">
            <button class="run" type="button" disabled={busy || phone === null} onClick={() => void grab()}>
              {phone ? `Read ${phone.name}’s screen` : 'Read the screen'}
            </button>
          </div>
        </div>

        <div class="panel">
          <h2>From a file</h2>

          <p>
            Drop a screenshot anywhere here, or pick one — a PNG as <code>adb exec-out screencap -p</code> or{' '}
            <code>pnpm inventory snap</code> saves it, a scroll capture included.
          </p>

          {unread && <p class="note">{unread}</p>}

          <label class="file">
            <input
              type="file"
              accept="image/png"
              disabled={busy || unread !== null}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];

                if (file) {
                  void open(file);
                }

                event.currentTarget.value = '';
              }}
            />
          </label>
        </div>

        {phase.kind === 'busy' && <p class="status">{phase.message}</p>}

        {phase.kind === 'failed' && (
          <p class="status err" role="alert">
            {phase.message}
          </p>
        )}

        {capture && phase.kind !== 'busy' && (
          <div class="panel result">
            <div class="heading">
              <h2>{capture.name}</h2>
              {capture.grabbed && (
                <button class="ghost" type="button" onClick={() => png && download(png, capture.name, 'image/png')}>
                  Save screenshot
                </button>
              )}
              {phase.kind === 'done' && (
                <button
                  class="ghost"
                  type="button"
                  onClick={() =>
                    download(
                      new TextEncoder().encode(
                        shown({ ...phase.reading, identity: printable(phase.reading.identity) }),
                      ),
                      capture.name.replace(/\.png$/i, '') + '.json',
                      'application/json',
                    )
                  }
                >
                  Save reading
                </button>
              )}
            </div>

            {preview && <img class="shot" src={preview} alt={`The screenshot ${capture.name}`} />}

            {phase.kind === 'done' &&
              (phase.refused.length > 0 ? (
                <>
                  <p class="status err" role="alert">
                    Refused: {phase.refused.join('; ')}.
                  </p>
                  <details class="anyway">
                    <summary>What each reader made of it anyway</summary>
                    <Blocks reading={phase.reading} />
                  </details>
                </>
              ) : (
                <Blocks reading={phase.reading} />
              ))}
          </div>
        )}
      </main>
    </>
  );
}
