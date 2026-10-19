// Tiny IndexedDB key/value store. Keeps the current work (clips, drawings, tracking) in this browser
// so a refresh or an app update does not lose it. Nothing leaves the device.
const DB = 'throwlab', STORE = 'kv';
let dbp = null;

function open() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
function tx(mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Storage was blocked.'));
  }));
}
export const put = (k, v) => tx('readwrite', (s) => s.put(v, k));
export const get = (k) => tx('readonly', (s) => s.get(k));
export const del = (k) => tx('readwrite', (s) => s.delete(k));
export const clearAll = () => tx('readwrite', (s) => s.clear());
