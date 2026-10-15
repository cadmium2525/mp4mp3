/* IndexedDB にプロジェクトと素材を保存する（端末内のみ） */

const DB_NAME = 'tsunagu';
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('projects', { keyPath: 'id' });
        const m = d.createObjectStore('media', { keyPath: 'id' });
        m.createIndex('projectId', 'projectId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('保存できませんでした（容量不足の可能性があります）'));
  });
}

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

export async function listProjects() {
  const all = await tx('projects', 'readonly', (s) => req(s.getAll()));
  return (all || []).map(({ id, name, updatedAt, thumb, duration, ratio }) => ({ id, name, updatedAt, thumb, duration, ratio }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id) {
  const rec = await tx('projects', 'readonly', (s) => req(s.get(id)));
  return rec ? rec.data : null;
}

export async function saveProject(project, extra = {}) {
  project.updatedAt = Date.now();
  const rec = { id: project.id, name: project.name, updatedAt: project.updatedAt, data: JSON.parse(JSON.stringify(project)), ...extra };
  await tx('projects', 'readwrite', (s) => s.put(rec));
}

export async function deleteProject(id) {
  await tx('projects', 'readwrite', (s) => s.delete(id));
  const keys = await tx('media', 'readonly', (s) => req(s.index('projectId').getAllKeys(id)));
  await tx('media', 'readwrite', (s) => { for (const k of keys) s.delete(k); });
}

export async function putMedia(projectId, meta, blob) {
  await tx('media', 'readwrite', (s) => s.put({ id: meta.id, projectId, meta, blob }));
}

export async function getMedia(id) {
  return tx('media', 'readonly', (s) => req(s.get(id)));
}

export async function deleteMedia(id) {
  await tx('media', 'readwrite', (s) => s.delete(id));
}

/** ブラウザに「勝手に消さないで」とお願いする（対応ブラウザのみ） */
export async function requestPersist() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* 無視 */ }
}

export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}
