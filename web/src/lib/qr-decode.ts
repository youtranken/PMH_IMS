import jsQR from 'jsqr';

/*
 * Đọc ảnh QR NGAY TRÊN TRÌNH DUYỆT (Q-18): ảnh QR của mã 2 lớp chính là khóa bí mật dạng rõ,
 * nên không bao giờ gửi lên server, không ghi ra đâu. Chỉ chuỗi đọc được đi vào ô Giá trị, rồi
 * đi theo đường cất két như mọi giá trị khác.
 */

/** Ảnh chụp điện thoại 4000px chỉ làm jsQR chậm; QR vẫn đọc được ở cạnh này. */
const MAX_SIDE = 1600;

/** Hình dạng giữ MỘT kiểu (`tsconfig.app.json` không bật strict — xem CLAUDE.md). */
export interface QrFileResult {
  value: string | null;
  reason: 'NOT_IMAGE' | 'READ_FAILED' | 'NO_QR' | null;
}

/** Điểm ảnh RGBA → chuỗi trong QR, hoặc `null` khi không thấy mã nào. */
export function decodeQrPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  // QR chụp từ màn hình theme tối hay bị đảo màu; thử cả hai chiều.
  const found = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  return found?.data ? found.data : null;
}

export async function decodeQrFile(file: File): Promise<QrFileResult> {
  if (!file.type.startsWith('image/')) return { value: null, reason: 'NOT_IMAGE' };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { value: null, reason: 'READ_FAILED' };
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    return { value: null, reason: 'READ_FAILED' };
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = context.getImageData(0, 0, width, height);
  const text = decodeQrPixels(pixels.data, width, height);
  // Xoá điểm ảnh khỏi bộ nhớ ngay: đó là bản sao của khóa bí mật.
  pixels.data.fill(0);
  canvas.width = 0;
  canvas.height = 0;
  return text ? { value: text, reason: null } : { value: null, reason: 'NO_QR' };
}
