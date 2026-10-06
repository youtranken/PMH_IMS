import { readResponse } from '@/lib/api-client';

/**
 * Tải file từ 1 endpoint (kèm cookie) và ÉP tên file đúng.
 *
 * Vì sao không dùng `<a href download>` thẳng: khi điều hướng tới response
 * `application/octet-stream`, một số trình duyệt bỏ qua tên trong Content-Disposition
 * và đặt tên hash (vd "f01df85…") không có đuôi .xlsx. Fetch → blob → a.download giữ
 * đúng tên (ưu tiên tên server gửi, fallback tên truyền vào) trên mọi trình duyệt.
 */
export async function downloadFile(
  url: string,
  fallbackName: string,
): Promise<void> {
  await saveResponse(await fetch(url, { credentials: 'include' }), fallbackName);
}

/**
 * POST một thân JSON (kèm CSRF) rồi lưu file server trả về — xuất có ghi nhật ký (bản vẽ PNG/PDF),
 * nơi GET là sai: một thẻ `<img src>` ở trang khác không được tự xuất hộ người đang đăng nhập.
 * Lỗi ném `ApiError` như `apiFetch`, nên `useStepUpRetry` bắt được `STEPUP_REQUIRED`.
 */
export async function postForDownload(url: string, body: unknown, csrfToken: string, fallbackName: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  });
  await saveResponse(res, fallbackName);
}

/**
 * Tên file từ Content-Disposition: `filename*` (UTF-8, RFC 5987) thắng `filename` — server gửi
 * kèm bản ASCII cho trình duyệt cũ, lấy nó là mất dấu tiếng Việt trong tên file.
 */
export function fileNameFrom(contentDisposition: string, fallbackName: string): string {
  const utf8 = /filename\*=(?:UTF-8'')?"?([^";]+)"?/i.exec(contentDisposition);
  if (utf8) return decodeURIComponent(utf8[1]);
  const plain = /filename="?([^"();]+)"?/i.exec(contentDisposition);
  return plain ? plain[1] : fallbackName;
}

/**
 * Lưu một response file xuống máy (tên server gửi, lùi về `fallbackName`) — phần chung của
 * `downloadFile` (GET) và `uploadForDownload` (POST file, nhận file về).
 */
export async function saveResponse(res: Response, fallbackName: string): Promise<void> {
  // Lỗi đi qua luật chung: phiên hết hạn thì về màn đăng nhập, không phải một lỗi câm.
  if (!res.ok) await readResponse(res);
  const name = fileNameFrom(res.headers.get('content-disposition') ?? '', fallbackName);
  const objUrl = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
}
