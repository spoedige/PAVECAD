/** Persistência no IndexedDB do navegador. Falhas viram no-ops: o app funciona sem armazenamento. */
export type Store = 'notes' | 'props' | 'config' | 'projetos';
const STORES: Store[] = ['notes', 'props', 'config', 'projetos'];
let db: IDBDatabase | null = null;

/** Espera máxima pelo banco. Em alguns navegadores de celular (aba privada, bloqueio de armazenamento) o `open` nunca responde: sem limite, a inicialização inteira ficava parada. */
export const LIMITE_BANCO_MS = 3000;
export let bancoIndisponivel = false;

export function abrirDb(): Promise<void> {
  return new Promise((res) => {
    const t = setTimeout(() => { if (!db) bancoIndisponivel = true; res(); }, LIMITE_BANCO_MS);
    const fim = res;
    res = () => { clearTimeout(t); fim(); };
    try {
      const rq = indexedDB.open('pavecad', 2);
      rq.onupgradeneeded = () => {
        for (const s of STORES) if (!rq.result.objectStoreNames.contains(s)) rq.result.createObjectStore(s, { keyPath: 'id' });
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

export function gravar<T extends { id: string }>(store: Store, v: T) {
  if (!db) return;
  try { db.transaction(store, 'readwrite').objectStore(store).put(v); } catch { /* sem armazenamento */ }
}

export function apagar(store: Store, id: string) {
  if (!db) return;
  try { db.transaction(store, 'readwrite').objectStore(store).delete(id); } catch { /* sem armazenamento */ }
}

/** Grava e espera a transação terminar. Útil quando o próximo passo depende de o dado já estar salvo. */
export function gravarAguardando<T extends { id: string }>(store: Store, v: T): Promise<boolean> {
  return new Promise((res) => {
    if (!db) return res(false);
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(v);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
      tx.onabort = () => res(false);
    } catch { res(false); }
  });
}

export function limparStore(store: Store) {
  if (!db) return;
  try { db.transaction(store, 'readwrite').objectStore(store).clear(); } catch { /* sem armazenamento */ }
}
