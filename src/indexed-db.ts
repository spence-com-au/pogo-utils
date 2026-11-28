/**
 * What this app keeps in IndexedDB is small and touched seldom, so each use opens its database, does one thing and
 * closes it again rather than keeping a connection open: `inStore` for the one request the battle's stay-awake setting
 * and the inventory make at a time, and `readDatabase` and `replaceDatabase` for a backup, which carries a database
 * whole.
 */

/** A database's stores by name, each holding its values by their keys. */
export type Stores = Record<string, Record<string, unknown>>;

/** What `request` answers, once it has. */
const answered = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused a request'));
  });

/** Once `transaction` has committed. */
const committed = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB did not commit a transaction'));
  });

/**
 * `database` opened, with `store` in it where `create` says to make it: added by a version above the one found where a
 * restored backup left the database without it. Without `create`, a database or store not there is null, and nothing
 * is made — a read that made one would leave an empty database behind on every visit, for a backup to carry.
 */
async function openedWith(database: string, store: string, create: boolean): Promise<IDBDatabase | null> {
  const opening = indexedDB.open(database);

  // Only a database not there yet is upgraded, opened as it is without a version.
  opening.onupgradeneeded = () => {
    if (create) {
      opening.result.createObjectStore(store);
    } else {
      opening.transaction?.abort();
    }
  };

  const opened = await answered(opening).catch((error: unknown) => {
    if (opening.error?.name === 'AbortError') {
      return null;
    }

    throw error;
  });

  if (opened === null || opened.objectStoreNames.contains(store)) {
    return opened;
  }

  opened.close();

  if (!create) {
    return null;
  }

  const upgrading = indexedDB.open(database, opened.version + 1);
  upgrading.onupgradeneeded = () => upgrading.result.createObjectStore(store);

  return answered(upgrading);
}

/**
 * One request against one object store: its database opened, asked and closed again, the answer handed back once the
 * transaction has committed. A write makes the database and store where they are not there; a read of one not there
 * answers undefined and makes nothing.
 */
export async function inStore<T>(
  database: string,
  store: string,
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const opened = await openedWith(database, store, mode !== 'readonly');

  if (opened === null) {
    return undefined;
  }

  try {
    const transaction = opened.transaction(store, mode);
    const request = act(transaction.objectStore(store));

    await committed(transaction);

    return request.result;
  } finally {
    opened.close();
  }
}

/** The names of the databases this origin holds. */
export async function databaseNames(): Promise<string[]> {
  return (await indexedDB.databases()).flatMap(({ name }) => (name === undefined ? [] : [name]));
}

/**
 * Everything `name` holds, store by store. Only values under string keys are read, those being all a file can name;
 * none of this app's stores keys by anything else.
 */
export async function readDatabase(name: string): Promise<Stores> {
  const opened = await answered(indexedDB.open(name));

  try {
    const names = [...opened.objectStoreNames];

    if (names.length === 0) {
      return {};
    }

    // Every request made before any is awaited: a transaction commits once it is left with none pending.
    const transaction = opened.transaction(names, 'readonly');
    const asked = names.map((store) => {
      const objectStore = transaction.objectStore(store);

      return [store, answered(objectStore.getAllKeys()), answered(objectStore.getAll())] as const;
    });

    const stores: Stores = {};

    for (const [store, keys, values] of asked) {
      const held = await values;

      stores[store] = Object.fromEntries(
        (await keys).flatMap((key, index) => (typeof key === 'string' ? [[key, held[index]]] : [])),
      );
    }

    return stores;
  } finally {
    opened.close();
  }
}

/**
 * Replaces `name` with a database holding `stores` and nothing else, or deletes it where `stores` is null. Made at
 * version 1, the version `inStore` opens.
 */
export async function replaceDatabase(name: string, stores: Stores | null): Promise<void> {
  await answered(indexedDB.deleteDatabase(name));

  if (stores === null) {
    return;
  }

  const opening = indexedDB.open(name, 1);

  opening.onupgradeneeded = () => {
    for (const store of Object.keys(stores)) {
      opening.result.createObjectStore(store);
    }
  };

  const opened = await answered(opening);

  try {
    const names = Object.keys(stores);

    if (names.length === 0) {
      return;
    }

    const transaction = opened.transaction(names, 'readwrite');

    for (const [store, entries] of Object.entries(stores)) {
      for (const [key, value] of Object.entries(entries)) {
        transaction.objectStore(store).put(value, key);
      }
    }

    await committed(transaction);
  } finally {
    opened.close();
  }
}
