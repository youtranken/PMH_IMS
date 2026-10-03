import { Resvg } from '@resvg/resvg-js';
import { photoThumbnail } from './photo-thumbnail';

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
    const out = await photoThumbnail(png(1200, 300), 'image/png', 480);
    expect(out?.mime).toBe('image/png');
    expect(sizeOf(out!.bytes)).toEqual({ width: 480, height: 120 });
  });

  it('ảnh dọc lớn → cao đúng trần', async () => {
    const out = await photoThumbnail(png(300, 900), 'image/png', 480);
    expect(sizeOf(out!.bytes)).toEqual({ width: 160, height: 480 });
  });

  it('ảnh đã nhỏ hơn trần → giữ nguyên tệp gốc (không nén lại)', async () => {
    const source = png(200, 50);
    const out = await photoThumbnail(source, 'image/png', 480);
    expect(out?.bytes.equals(source)).toBe(true);
  });

  it('không phải ảnh png/jpeg/webp → null', async () => {
    await expect(photoThumbnail(Buffer.from('%PDF-1.4'), 'application/pdf', 480)).resolves.toBeNull();
  });

  it('nội dung hỏng → null, không ném', async () => {
    await expect(photoThumbnail(Buffer.from('không phải ảnh'), 'image/png', 480)).resolves.toBeNull();
  });
});
