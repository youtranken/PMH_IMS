import { Resvg } from '@resvg/resvg-js';
import { photoSize, photoThumbnail } from './photo-thumbnail';

function png(width: number, height: number): Buffer {
  return new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="red"/><circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) / 3}" fill="blue"/></svg>`,
  )
    .render()
    .asPng();
}

function sizeOf(image: Buffer): { width: number; height: number } {
  // PNG: IHDR bắt đầu ở byte 16 (rộng, cao — 4 byte big-endian).
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

describe('photoThumbnail — ảnh thật thiết bị thu về cạnh dài tối đa', () => {
  it('ảnh ngang lớn → PNG rộng đúng trần, giữ tỉ lệ', async () => {
    const out = await photoThumbnail(png(1200, 300), 'image/png', 480, 50);
    expect(out?.mime).toBe('image/png');
    expect(sizeOf(out!.bytes)).toEqual({ width: 480, height: 120 });
    // Cỡ đi kèm ảnh: ô trên bản vẽ lấy tỉ lệ ảnh từ đây, không giải mã lại.
    expect({ width: out!.width, height: out!.height }).toEqual({ width: 480, height: 120 });
  });

  it('ảnh dọc lớn → cao đúng trần', async () => {
    const out = await photoThumbnail(png(300, 900), 'image/png', 480, 50);
    expect(sizeOf(out!.bytes)).toEqual({ width: 160, height: 480 });
  });

  it('ảnh đã nhỏ hơn trần → giữ nguyên tệp gốc (không nén lại)', async () => {
    const source = png(200, 50);
    const out = await photoThumbnail(source, 'image/png', 480, 50);
    expect(out?.bytes.equals(source)).toBe(true);
    expect({ width: out!.width, height: out!.height }).toEqual({ width: 200, height: 50 });
  });

  it('không phải ảnh png/jpeg/webp → null', async () => {
    await expect(photoThumbnail(Buffer.from('%PDF-1.4'), 'application/pdf', 480, 50)).resolves.toBeNull();
  });

  it('nội dung hỏng → null, không ném', async () => {
    await expect(photoThumbnail(Buffer.from('không phải ảnh'), 'image/png', 480, 50)).resolves.toBeNull();
  });
});

/** JPEG tối thiểu: SOI, (tuỳ chọn) một đoạn APP0, rồi SOF đúng cỡ — đủ cho bộ đọc đầu tệp. */
function jpeg(width: number, height: number, { sof = 0xc0, app0 = false } = {}): Buffer {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (app0) parts.push(Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]));
  const frame = Buffer.from([0xff, sof, 0x00, 0x11, 0x08, 0, 0, 0, 0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  parts.push(frame);
  return Buffer.concat(parts);
}

/*
 * Cỡ ảnh đọc từ đầu tệp — thay lượt dò `new Resvg(...)` đồng bộ (mỗi lần nạp cả bộ phông hệ thống,
 * ~100 ms chặn vòng sự kiện) mà kết quả phải y hệt: nhãn png/jpeg thì đọc theo nội dung PNG / JPEG,
 * nhãn WebP thì resvg không đọc nên trả null như cũ, đầu tệp cụt / lạ thì null.
 */
describe('photoSize — cỡ ảnh đọc từ đầu tệp', () => {
  it.each<[string, Buffer, string, { width: number; height: number } | null]>([
    ['PNG ngang', png(1200, 300), 'image/png', { width: 1200, height: 300 }],
    ['PNG cụt trước cỡ ảnh', png(640, 480).subarray(0, 20), 'image/png', null],
    ['JPEG baseline (SOF0)', jpeg(200, 100), 'image/jpeg', { width: 200, height: 100 }],
    ['JPEG progressive (SOF2) sau APP0', jpeg(4032, 3024, { sof: 0xc2, app0: true }), 'image/jpeg', { width: 4032, height: 3024 }],
    ['JPEG chỉ có DHT (0xC4), không có SOF', jpeg(10, 10, { sof: 0xc4 }), 'image/jpeg', null],
    ['JPEG cụt giữa đoạn', jpeg(200, 100, { app0: true }).subarray(0, 10), 'image/jpeg', null],
    ['PNG đủ 24 byte đầu', png(640, 480).subarray(0, 24), 'image/png', { width: 640, height: 480 }],
    // resvg đọc theo NỘI DUNG khi nhãn là png/jpeg — giữ đúng như thế.
    ['nhãn PNG nhưng nội dung JPEG', jpeg(200, 100), 'image/png', { width: 200, height: 100 }],
    ['nhãn WebP nhưng nội dung PNG (resvg bỏ mọi ảnh nhãn webp)', png(64, 48), 'image/webp', null],
    ['WebP (resvg không đọc)', Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'), 'image/webp', null],
    ['rác', Buffer.from('không phải ảnh'), 'image/png', null],
    ['rỗng', Buffer.alloc(0), 'image/jpeg', null],
  ])('%s', (_label, bytes, mime, expected) => {
    expect(photoSize(bytes, mime)).toEqual(expected);
  });

  it('khớp cỡ resvg đọc được cho cùng tệp', () => {
    for (const [bytes, mime] of [
      [png(333, 77), 'image/png'],
      [jpeg(200, 100), 'image/jpeg'],
    ] as const) {
      const probe = new Resvg(
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="data:${mime};base64,${bytes.toString('base64')}"/></svg>`,
      );
      expect(photoSize(bytes, mime)).toEqual({ width: probe.width, height: probe.height });
    }
  });
});

describe('photoThumbnail — trần số điểm ảnh trước khi giải mã', () => {
  /*
   * Ảnh nén toàn số 0 vài MB có thể khai 50000×50000 trong header: giải mã cần cỡ GB RAM và làm api
   * bị OOM-kill. Trần phải xét từ header, TRƯỚC khi đưa cho resvg. Bài dùng ảnh thật 2 MP với trần
   * 1 MP thay vì dựng ảnh khổng lồ trong test.
   */
  it('ảnh vượt trần megapixel → null, không giải mã', async () => {
    await expect(photoThumbnail(png(2000, 1000), 'image/png', 480, 1)).resolves.toBeNull();
  });

  it('ảnh dưới trần vẫn thu nhỏ như thường', async () => {
    const out = await photoThumbnail(png(1200, 300), 'image/png', 480, 1);
    expect(sizeOf(out!.bytes)).toEqual({ width: 480, height: 120 });
  });
});
