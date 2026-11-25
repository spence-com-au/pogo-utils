/**
 * A button that opens the browser's file picker for one JSON file and hands over what was picked. The input itself is
 * hidden and clicked by the button, a file input being unstyleable, so the button can match the controls beside it.
 */

import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';

export function JsonFileButton({
  children,
  class: className,
  disabled,
  title,
  onFile,
}: {
  children: ComponentChildren;
  class?: string;
  disabled?: boolean;
  title?: string;
  onFile: (file: File) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);

  return (
    <>
      <button type="button" class={className} disabled={disabled} title={title} onClick={() => picker.current?.click()}>
        {children}
      </button>

      {/* `value` is cleared as the change is read so that picking the same file twice in a row fires a second time. */}
      <input
        ref={picker}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const [file] = event.currentTarget.files ?? [];

          event.currentTarget.value = '';

          if (file !== undefined) {
            onFile(file);
          }
        }}
      />
    </>
  );
}
