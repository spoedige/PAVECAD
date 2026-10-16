/** Persistência no IndexedDB do navegador. Falhas viram no-ops: o app funciona sem armazenamento. */
export type Store = 'notes' | 'props';
let db: IDBDatabase | null = null;

export function abrirDb(): Promise<void> {
  return new Promise((res) => {
    try {
      const rq = indexedDB.open('pavecad', 1);
      rq.onupgradeneeded = () => {
        for (const s of ['notes', 'props'] as Store[]) if (!rq.result.objectStoreNames.contains(s)) rq.result.createObjectStore(s, { keyPath: 'id' });
      };
      rq.onsuccess = () => { db = rq.result; res(); };
      rq.onerror = () => res();
      rq.onblocked = () => res();
    } catch { res(); }
  });
}

export function todos<T>(store: Store): Promise<T[]> {
  return new Promise((res) => {
    if (!db) return res([]);
    try {
      const rq = db.transaction(store).objectStore(store).getAll();
      rq.onsuccess = () => res((rq.result as T[]) || []);
      rq.onerror = () => res([]);
    } catch { res([]); }
  });
}

export function gravar(store: Store, v: { id: string }) {
  if (!db) return;
  try { db.transaction(store, 'readwrite').objectStore(store).put(v); } catch { /* sem armazenamento */ }
}

export function apagar(store: Store, id: string) {
  if (!db) return;
  try { db.transaction(store, 'readwrite').objectStore(store).delete(id); } catch { /* sem armazenamento */ }
}
