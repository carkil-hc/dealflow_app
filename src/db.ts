import { openDB } from 'idb';

const DB_NAME = 'dealflow-files';
const DB_VERSION = 1;
const FILES_STORE = 'files';

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE);
      }
    },
  });
}

export async function saveFile(id: string, file: File): Promise<void> {
  const db = await getDB();
  await db.put(FILES_STORE, file, id);
}

export async function getFile(id: string): Promise<File | undefined> {
  const db = await getDB();
  return db.get(FILES_STORE, id);
}

export async function deleteFile(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(FILES_STORE, id);
}

export async function downloadFile(id: string, name: string): Promise<void> {
  const file = await getFile(id);
  if (!file) return;
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
