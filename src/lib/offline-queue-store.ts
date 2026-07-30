"use client";

import type { QueuedCall } from "./offline-calls";

/**
 * The device-side queue for calls logged without a connection.
 *
 * IndexedDB rather than localStorage, for three reasons that all bite in the field:
 *   • localStorage is synchronous — writing on the main thread during a call-logging tap is
 *     exactly when a telecaller notices jank;
 *   • it caps around 5MB of STRINGS, so a long offline stretch can silently start throwing;
 *   • and its failure mode is a thrown exception mid-write that loses the whole blob, where
 *     IndexedDB fails one transaction and leaves the rest of the queue intact.
 *
 * Hand-rolled rather than pulling in idb/Dexie: this is one object store with four operations,
 * and a dependency that ships a wrapper for the whole IndexedDB surface is not worth the
 * bundle on a page a telecaller loads on mobile data.
 *
 * EVERY operation fails soft. A browser in private mode, with storage disabled, or out of
 * quota must degrade to "this call could not be queued" — never to a crash that costs the
 * telecaller the outcome they just typed. Callers get `false`/`[]` and surface it in the UI.
 */

const DB_NAME = "b2-offline";
const DB_VERSION = 1;
const STORE = "queued-calls";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    // Feature-detect rather than assume: IndexedDB is absent in some embedded webviews and
    // is present-but-throwing in Firefox private mode.
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          // Keyed by the device-generated clientKey, which is also what the server dedupes
          // on — so "already queued" and "already saved" mean the same thing end to end.
          db.createObjectStore(STORE, { keyPath: "clientKey" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const t = db.transaction(STORE, mode);
          const req = run(t.objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          t.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

/** Add or overwrite a queued call. `false` means the device could not store it. */
export async function enqueueCall(entry: QueuedCall): Promise<boolean> {
  const res = await tx("readwrite", (s) => s.put(entry));
  return res !== null;
}

/** Everything still waiting, oldest first — the order they were recorded in. */
export async function listQueuedCalls(): Promise<QueuedCall[]> {
  const rows = await tx<QueuedCall[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedCall[]>);
  return (rows ?? []).sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

/** Drop entries the server has confirmed. */
export async function dequeueCalls(clientKeys: string[]): Promise<void> {
  for (const key of clientKeys) {
    await tx("readwrite", (s) => s.delete(key) as unknown as IDBRequest<undefined>);
  }
}

/** Record a failed attempt so a permanently-rejected entry can eventually be given up on. */
export async function bumpAttempts(entries: QueuedCall[]): Promise<void> {
  for (const e of entries) {
    await enqueueCall({ ...e, attempts: e.attempts + 1 });
  }
}

/**
 * A key unique to this device and moment.
 *
 * `crypto.randomUUID` where available; the fallback covers non-secure origins (plain http on
 * a LAN IP), where it is undefined. Collisions only matter within one device's own queue, and
 * random+time is far beyond sufficient for that.
 */
export function newClientKey(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
