/**
 * The phone every tab shares: held until replaced or unplugged, with whoever is listening told each time.
 */

import { expect, test, vi } from 'vitest';

import type { Phone } from './inventory/webusb.js';
import { PhoneStore } from './phone-store.js';

/** A phone whose connection ends when the test says, and whose `close` does what it is told. */
function fake(name: string, close: () => Promise<void> = () => Promise.resolve()) {
  let end!: (unplugged: boolean) => void;
  const disconnected = new Promise<void>((resolve, reject) => {
    end = (unplugged) => (unplugged ? reject(new Error('unplugged')) : resolve());
  });
  const phone: Phone = {
    name,
    serial: name,
    transport: { state: vi.fn(), shell: vi.fn(), screencap: vi.fn() },
    spawn: vi.fn(),
    close: vi.fn(close),
    disconnected,
  };

  return { phone, end };
}

/** Lets the store's `disconnected` handlers run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a phone held is told to every listener, and replacing it lets the first go even when that throws', async () => {
  const store = new PhoneStore();
  const heard = vi.fn();
  const first = fake('first', () => Promise.reject(new Error('already unplugged')));
  const second = fake('second');

  store.subscribe(heard);
  await store.hold(first.phone);
  await store.hold(second.phone);

  expect(store.phone).toBe(second.phone);
  expect(first.phone.close).toHaveBeenCalledOnce();
  expect(heard).toHaveBeenCalledTimes(2);
});

test.for([
  ['unplugged', true],
  ['closed', false],
] as const)('a phone %s is dropped and the listeners told', async ([, unplugged]) => {
  const store = new PhoneStore();
  const heard = vi.fn();
  const { phone, end } = fake('only');

  await store.hold(phone);
  store.subscribe(heard);
  end(unplugged);
  await settle();

  expect(store.phone).toBeNull();
  expect(heard).toHaveBeenCalledOnce();
});

test('a phone already replaced ending leaves the one held alone', async () => {
  const store = new PhoneStore();
  const first = fake('first');
  const second = fake('second');

  await store.hold(first.phone);
  await store.hold(second.phone);
  first.end(true);
  await settle();

  expect(store.phone).toBe(second.phone);
});
