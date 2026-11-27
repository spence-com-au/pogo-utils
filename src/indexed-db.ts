/**
 * One request against one object store, in a database holding that store alone: opened, created on first use, asked
 * and closed again, the answer handed back once the transaction has committed. What the battle's stay-awake setting and
 * the inventory both keep in IndexedDB, neither holding enough to want a connection kept open.
 */
export async function inStore<T>(
  database: string,
  store: string,
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const opening = indexedDB.open(database, 1);
  opening.onupgradeneeded = () => opening.result.createObjectStore(store);

  const opened = await new Promise<IDBDatabase>((resolve, reject) => {
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error(`${database} could not be opened`));
  });

  try {
    const transaction = opened.transaction(store, mode);
    const request = act(transaction.objectStore(store));

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error(`${store} not written`));
    });

    return request.result;
  } finally {
    opened.close();
  }
}
