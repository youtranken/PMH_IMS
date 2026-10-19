import { renderAsync } from '@resvg/resvg-js';

/** Ảnh thật nhận vào bản vẽ — đúng tập ảnh `files` cho tải lên (kiểm theo nội dung). */
const PHOTO_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface PhotoImage {
  mime: string;
  bytes: Buffer;
  /** Cỡ điểm ảnh của `bytes` — ô ảnh trên bản vẽ lấy tỉ lệ từ đây thay vì giải mã lại. */
  width: number;
  height: number;
}

/**
 * Ảnh thật của thiết bị thu về cạnh dài tối đa `maxPx` (PNG), để nhúng vào bản vẽ dạng data URI.
 *
 * Ảnh chụp điện thoại vài MB nhân lên theo số máy trong tủ và theo hai mặt sẽ vượt trần dung lượng
 * bản vẽ/ảnh xem ngay; thu nhỏ ở server thì người dùng chọn thẳng ảnh đính kèm có sẵn, không phải
 * tự thu nhỏ rồi tải lại. Dùng `@resvg/resvg-js` sẵn có (xuất PNG/PDF bản vẽ) thay vì thêm thư viện
 * ảnh: nó giải mã PNG/JPEG và vẽ lại ở cỡ mới. Ảnh không giải mã được (hỏng, hay WebP mà resvg không
 * đọc) trả `null` — nơi gọi rơi về biểu tượng loại thay vì làm hỏng bản vẽ.
 */
export async function photoThumbnail(
  bytes: Buffer,
  mime: string,
  maxPx: number,
  maxMegapixels: number,
): Promise<PhotoImage | null> {
  if (!PHOTO_MIMES.has(mime)) return null;
  const size = photoSize(bytes, mime);
  if (!size || !(size.width > 0 && size.height > 0)) return null;
  const { width, height } = size;
  // Xét từ header TRƯỚC khi giải mã: ảnh nén vài MB khai 50000×50000 cần cỡ GB RAM để giải mã.
  if (width * height > maxMegapixels * 1_000_000) return null;
  if (Math.max(width, height) <= maxPx) return { mime, bytes, width, height };
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
    `<image xlink:href="data:${mime};base64,${bytes.toString('base64')}"/></svg>`;
  try {
    const rendered = await renderAsync(svg, { fitTo: { mode: width >= height ? 'width' : 'height', value: maxPx } });
    return { mime: 'image/png', bytes: rendered.asPng(), width: rendered.width, height: rendered.height };
  } catch {
    return null;
  }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Cỡ điểm ảnh đọc từ ĐẦU tệp, không giải mã. Thay lượt dò `new Resvg(svg)` đồng bộ: dựng `Resvg`
 * nạp cả bộ phông hệ thống mỗi lần (~100 ms, chặn vòng sự kiện), chỉ để hỏi cỡ.
 *
 * Phải nhận ĐÚNG tập ảnh resvg nhận, vì ảnh qua được đây mà resvg không vẽ được thì bản vẽ có ô ảnh
 * trống: nhãn `image/webp` thì resvg bỏ (null); nhãn png/jpeg thì resvg đọc theo NỘI DUNG, nên ở
 * đây cũng vậy — PNG (24 byte đầu: chữ ký + IHDR) hoặc JPEG (đoạn SOF đầu tiên). GIF trong nhãn
 * png/jpeg resvg cũng đọc, nhưng `files` không bao giờ nhận GIF nên không đọc ở đây.
 */
export function photoSize(bytes: Buffer, mime: string): { width: number; height: number } | null {
  if (mime !== 'image/png' && mime !== 'image/jpeg') return null;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);
  return null;
}

/** SOF0..SOF15 trừ DHT (C4), JPG (C8), DAC (CC) — ba mã đó cùng dải nhưng không mang cỡ ảnh. */
function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    // 0xFF đệm giữa các đoạn được phép lặp.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Mã đứng một mình, không có trường độ dài.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = bytes.readUInt16BE(at + 2);
    if (isSof(marker)) {
      if (at + 9 > bytes.length) return null;
      return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
    }
    at += 2 + length;
  }
  return null;
}
