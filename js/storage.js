const DB_NAME = 'surjotube-local';
const DB_VERSION = 2;
let databasePromise;

function openDatabase() {
  if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable in this browser.'));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('videos')) database.createObjectStore('videos', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('history')) database.createObjectStore('history', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the local library.'));
      request.onblocked = () => reject(new Error('Close other Local YouTube tabs to upgrade the local library.'));
    });
  }
  return databasePromise;
}

async function requestStore(storeName, mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const request = action(transaction.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local storage request failed.'));
    transaction.onabort = () => reject(transaction.error || new Error('Local storage transaction was aborted.'));
  });
}

export const getVideos = () => requestStore('videos', 'readonly', store => store.getAll());
export const getVideo = id => requestStore('videos', 'readonly', store => store.get(id));
export const saveVideo = video => requestStore('videos', 'readwrite', store => store.put(video));
export const removeVideo = id => requestStore('videos', 'readwrite', store => store.delete(id));
export const getHistory = () => requestStore('history', 'readonly', store => store.getAll());
export const saveHistory = record => requestStore('history', 'readwrite', store => store.put(record));
export const clearHistory = () => requestStore('history', 'readwrite', store => store.clear());
export const getDirectoryHandle = () => requestStore('settings', 'readonly', store => store.get('directoryHandle')).catch(() => null);
export const saveDirectoryHandle = handle => requestStore('settings', 'readwrite', store => store.put(handle, 'directoryHandle'));
export const clearDirectoryHandle = () => requestStore('settings', 'readwrite', store => store.delete('directoryHandle'));
export const getPreference = (key, fallback = null) => {
  try { const value = localStorage.getItem(`surjotube:${key}`); return value === null ? fallback : JSON.parse(value); }
  catch { return fallback; }
};
export const setPreference = (key, value) => localStorage.setItem(`surjotube:${key}`, JSON.stringify(value));
