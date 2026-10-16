/*
 * かなでる：曲と効果音を端末内（IndexedDB）に保存する。
 */
const DB = 'kanaderu';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('sfx')) d.createObjectStore('sfx', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}

export const store = {
  async list(kind = 'songs') {
    const all = await tx(kind, 'readonly', (s) => s.getAll());
    return all.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  },
  get: (id, kind = 'songs') => tx(kind, 'readonly', (s) => s.get(id)),
  put: (obj, kind = 'songs') => tx(kind, 'readwrite', (s) => s.put({ ...obj, updated: Date.now() })),
  del: (id, kind = 'songs') => tx(kind, 'readwrite', (s) => s.delete(id)),
};
