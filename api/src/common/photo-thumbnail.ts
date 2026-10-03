import { Resvg, renderAsync } from '@resvg/resvg-js';

/** Ảnh thật nhận vào bản vẽ — đúng tập ảnh `files` cho tải lên (kiểm theo nội dung). */
const PHOTO_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface PhotoImage {
  mime: string;
  bytes: Buffer;
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
export async function photoThumbnail(bytes: Buffer, mime: string, maxPx: number): Promise<PhotoImage | null> {
  if (!PHOTO_MIMES.has(mime)) return null;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
    `<image xlink:href="data:${mime};base64,${bytes.toString('base64')}"/></svg>`;
  let width = 0;
  let height = 0;
  try {
    const probe = new Resvg(svg);
    // Ảnh không giải mã được thì resvg bỏ thẻ <image> và dựng khung mặc định 100×100 — nhận ra
    // bằng việc không còn gì để vẽ.
    if (!probe.getBBox()) return null;
    width = probe.width;
    height = probe.height;
  } catch {
    return null;
  }
  if (!(width > 0 && height > 0)) return null;
  if (Math.max(width, height) <= maxPx) return { mime, bytes };
  try {
    const rendered = await renderAsync(svg, { fitTo: { mode: width >= height ? 'width' : 'height', value: maxPx } });
    return { mime: 'image/png', bytes: rendered.asPng() };
  } catch {
    return null;
  }
}
