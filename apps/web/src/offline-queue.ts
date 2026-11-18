import { ApiError, request } from './api';

/**
 * FR-SCAN-07 / NFR-REL-03: a scan taken without internet waits on the phone (IndexedDB) and is sent
 * as soon as the connection is back. Each scan keeps its clientId, so a resend after a lost answer
 * is not saved twice by the server.
 */
export interface QueuedScan {
  clientId: string;
  type: 'SALE' | 'PURCHASE';
  pages: { blob: Blob; name: string }[];
  at: number;
}

const DB = 'erp-offline';
const STORE = 'scans';
const listeners = new Set<(n: number) => void>();

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'clientId' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = f(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

export const toForm = (s: QueuedScan) => {
  const form = new FormData();
  form.set('type', s.type);
  form.set('clientId', s.clientId);
  for (const p of s.pages) form.append('pages', p.blob, p.name);
  return form;
};

/** True when the request never reached the server (no internet), as opposed to a refusal. */
export const isNetworkError = (e: unknown) => !(e instanceof ApiError);

export async function pending(): Promise<QueuedScan[]> {
  try {
    return await tx('readonly', (s) => s.getAll() as IDBRequest<QueuedScan[]>);
  } catch {
    return [];
  }
}

async function notify() {
  const n = (await pending()).length;
  for (const l of listeners) l(n);
}

export async function enqueue(scan: QueuedScan): Promise<void> {
  await tx('readwrite', (s) => s.put(scan));
  await notify();
}

let flushing: Promise<number> | null = null;

/** Sends every waiting scan; returns how many went through. Stops at the first network failure. */
export function flush(): Promise<number> {
  flushing ??= (async () => {
    let sent = 0;
    for (const s of await pending()) {
      try {
        await request('/scans', { method: 'POST', body: toForm(s) });
        sent++;
      } catch (e) {
        if (isNetworkError(e)) break;
        if ((e as ApiError).status === 401) break; // signed out: keep it for after login
        // refused for good (e.g. too large): drop it so the queue does not block
      }
      await tx('readwrite', (st) => st.delete(s.clientId));
    }
    await notify();
    return sent;
  })().finally(() => (flushing = null));
  return flushing;
}

/** Subscribes to the number of waiting scans; flushes when the phone comes back online. */
export function watchQueue(onCount: (n: number) => void, onSent: (n: number) => void): () => void {
  listeners.add(onCount);
  const go = () => void flush().then((n) => n && onSent(n));
  addEventListener('online', go);
  const timer = setInterval(() => navigator.onLine && go(), 60_000);
  void notify();
  if (navigator.onLine) go();
  return () => {
    listeners.delete(onCount);
    removeEventListener('online', go);
    clearInterval(timer);
  };
}
