/**
 * Kho bản đang làm dở ở TRÌNH DUYỆT, đã mã hoá (Q-23: bản vẽ sơ đồ mạng đang vẽ dở khi tab
 * đóng, mất mạng hay hết phiên). Nội dung sơ đồ chỉ xem được sau khi nhập mã sơ đồ, nên KHÔNG cất
 * chữ rõ: AES-GCM bằng khoá server cấp kèm nội dung (chỉ có sau khi nhập mã), dữ liệu gắn thêm
 * (AAD) là khoá ghi — bản mã không bê được sang bản vẽ khác. Khoá không bao giờ được cất.
 *
 * Mọi hàm KHÔNG ném: kho của trình duyệt có thể bị chặn (cửa sổ ẩn danh, chính sách máy) — khi đó
 * tính năng tắt lặng lẽ, việc vẽ không bị ảnh hưởng. Hàm nhận `backend` để bài kiểm chạy không cần
 * IndexedDB; màn dùng `browserDraftBackend()`.
 */

export interface DraftRow {
  id: string;
  owner: string;
  savedAt: number;
  basedOn: string | null;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

export interface DraftBackend {
  get: (id: string) => Promise<DraftRow | undefined>;
  put: (row: DraftRow) => Promise<void>;
  delete: (id: string) => Promise<void>;
  clear: () => Promise<void>;
}

/** Khoá ghi của một bản dở: theo người + đối tượng — hai người dùng chung máy không đụng nhau. */
export function draftKeyOf(owner: string, objectId: string): string {
  return `${owner}:${objectId}`;
}

function aesKey(rawKey: string): Promise<CryptoKey> {
  const bytes = Uint8Array.from(atob(rawKey), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function saveDraft(
  backend: DraftBackend,
  draft: { id: string; owner: string; basedOn: string | null; text: string; rawKey: string; now?: number },
): Promise<boolean> {
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(draft.id) },
      await aesKey(draft.rawKey),
      new TextEncoder().encode(draft.text),
    );
    await backend.put({ id: draft.id, owner: draft.owner, savedAt: draft.now ?? Date.now(), basedOn: draft.basedOn, iv, data });
    return true;
  } catch {
    return false;
  }
}

/**
 * MỘT hình dạng trả về (web không bật `strict`): `value` = bản dở; `reason` khi không có —
 * `none` (chưa có / của người khác), `expired` (quá hạn giữ, đã xoá), `undecryptable` (khoá đã đổi
 * hay bản mã bị sửa, đã xoá), `unavailable` (kho trình duyệt hỏng / bị chặn).
 */
export async function loadDraft(
  backend: DraftBackend,
  query: { id: string; owner: string; rawKey: string; keepHours: number; now?: number },
): Promise<{ value: { text: string; savedAt: number; basedOn: string | null } | null; reason: 'none' | 'expired' | 'undecryptable' | 'unavailable' | null }> {
  let row: DraftRow | undefined;
  try {
    row = await backend.get(query.id);
  } catch {
    return { value: null, reason: 'unavailable' };
  }
  if (!row || row.owner !== query.owner) return { value: null, reason: 'none' };
  if ((query.now ?? Date.now()) - row.savedAt > query.keepHours * 3_600_000) {
    await deleteDraft(backend, query.id);
    return { value: null, reason: 'expired' };
  }
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: row.iv, additionalData: new TextEncoder().encode(query.id) },
      await aesKey(query.rawKey),
      row.data,
    );
    return { value: { text: new TextDecoder().decode(plain), savedAt: row.savedAt, basedOn: row.basedOn }, reason: null };
  } catch {
    await deleteDraft(backend, query.id);
    return { value: null, reason: 'undecryptable' };
  }
}

export async function deleteDraft(backend: DraftBackend, id: string): Promise<void> {
  try {
    await backend.delete(id);
  } catch {
    // Kho bị chặn thì cũng không có gì đã cất để xoá.
  }
}

/** Đăng xuất: bỏ MỌI bản dở trên máy này — máy dùng chung không giữ gì của người vừa ra. */
export async function clearAllDrafts(backend: DraftBackend = browserDraftBackend()): Promise<void> {
  try {
    await backend.clear();
  } catch {
    // Kho bị chặn thì cũng không có gì đã cất để xoá.
  }
}

/** Kho trong bộ nhớ — cho bài kiểm. */
export function memoryDraftBackend(): DraftBackend & { rows: Map<string, DraftRow> } {
  const rows = new Map<string, DraftRow>();
  return {
    rows,
    get: (id) => Promise.resolve(rows.get(id)),
    put: (row) => {
      rows.set(row.id, row);
      return Promise.resolve();
    },
    delete: (id) => {
      rows.delete(id);
      return Promise.resolve();
    },
    clear: () => {
      rows.clear();
      return Promise.resolve();
    },
  };
}

const DB_NAME = 'ims-drafts';
const STORE = 'drafts';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no-indexeddb'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('idb-open'));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(request.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('idb-tx'));
        };
      }),
  );
}

/** IndexedDB của trình duyệt: bản vẽ có ảnh nhúng có thể vài MB — quá trần của localStorage. */
export function browserDraftBackend(): DraftBackend {
  return {
    get: (id) => run('readonly', (store) => store.get(id) as IDBRequest<DraftRow | undefined>),
    put: (row) => run('readwrite', (store) => store.put(row)).then(() => undefined),
    delete: (id) => run('readwrite', (store) => store.delete(id)).then(() => undefined),
    clear: () => run('readwrite', (store) => store.clear()).then(() => undefined),
  };
}
