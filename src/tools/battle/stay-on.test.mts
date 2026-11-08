import { expect, test } from 'vitest';
import { putStayOn } from './stay-on.mts';

/** A shell that records each command it is sent, as one line. */
function shell() {
  const ran: string[] = [];

  const transport = {
    shell: (args: readonly string[]) => {
      ran.push(args.join(' '));

      return Promise.resolve(new Uint8Array());
    },
  };

  return { ran, transport };
}

test('puts back a number Android stores', async () => {
  const { ran, transport } = shell();

  await putStayOn(transport, '3');

  expect(ran).toEqual(['settings put global stay_on_while_plugged_in 3']);
});

test.each(['1; reboot', '', '-1'])('refuses to put back %j, sending the shell nothing', async (value) => {
  const { ran, transport } = shell();

  await expect(putStayOn(transport, value)).rejects.toThrow('refusing to put stay_on_while_plugged_in back');
  expect(ran).toEqual([]);
});
