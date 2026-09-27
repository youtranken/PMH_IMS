import { readResponse } from '@/lib/api-client';

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
): Promise<T> {
  const form = new FormData();
  form.append(fieldName, file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);

  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
    body: form,
  });

  // Cùng luật với `apiFetch`, kể cả 401-phiên-chết → về màn đăng nhập.
  return readResponse<T>(res);
}
