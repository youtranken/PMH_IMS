import { readResponse } from '@/lib/api-client';
import { saveResponse } from '@/lib/download-file';

/**
 * Gửi MỘT file lên endpoint multipart (AD-15) — import danh mục (2.1), import thiết bị (2.6),
 * đính kèm giấy tờ (2.3) dùng chung.
 *
 * KHÔNG tự đặt `Content-Type`: trình duyệt phải tự sinh `multipart/form-data; boundary=…`.
 * Đặt tay là mất boundary và server trả 400 "Unexpected end of form" rất khó lần ra.
 */
export async function uploadFile<T>(
  path: string,
  file: File,
  csrfToken: string,
  fields: Record<string, string> = {},
  fieldName = 'file',
  /** Hủy giữa chừng (nút "Hủy" từng file của khu đính kèm) — fetch ném `AbortError`. */
  signal?: AbortSignal,
): Promise<T> {
  // Cùng luật với `apiFetch`, kể cả 401-phiên-chết → về màn đăng nhập.
  return readResponse<T>(await postFile(path, file, csrfToken, fields, fieldName, signal));
}

/**
 * Gửi một file lên và nhận một FILE về (lưu xuống máy) — "Tải danh sách dòng lỗi" của hộp nhập
 * Excel: server đọc lại chính file vừa chọn rồi trả file lỗi, không giữ gì giữa hai lượt.
 */
export async function uploadForDownload(
  path: string,
  file: File,
  csrfToken: string,
  fallbackName: string,
): Promise<void> {
  await saveResponse(await postFile(path, file, csrfToken, {}, 'file'), fallbackName);
}

function postFile(
  path: string,
  file: File,
  csrfToken: string,
  fields: Record<string, string>,
  fieldName: string,
  signal?: AbortSignal,
): Promise<Response> {
  const form = new FormData();
  form.append(fieldName, file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
    body: form,
    signal,
  });
}
