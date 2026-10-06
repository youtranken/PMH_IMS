import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { PDFDocument } from 'pdf-lib';
import { EXPORT_UNSAFE_CODE, pngToPdf, renderPng } from './diagram-render';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#ffffff"/><text x="10" y="50" font-family="Helvetica" font-size="14">Tủ mạng Lầu 3</text></svg>';

describe('renderPng / pngToPdf — raster hoá phía server, không mạng, phông tiếng Việt kèm gói', () => {
  it('PNG đúng chữ ký và đúng kích thước theo độ nét', async () => {
    const png = await renderPng(SVG, 2, 10_000);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(400);
    expect(png.readUInt32BE(20)).toBe(200);
  });

  describe('không đọc tệp cục bộ của container api', () => {
    let dir: string;
    let redPng: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'ims-render-'));
      redPng = join(dir, 'secret.png');
      writeFileSync(redPng, new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="red"/></svg>').render().asPng());
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    const attack = (href: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink" width="4" height="4"><image x:href="${href}" width="4" height="4"/></svg>`;

    it('resvg tự đọc tệp theo đường tuyệt đối — lý do phải có chặn trước khi vẽ', () => {
      const pixels = new Resvg(attack(redPng)).render().pixels;
      expect(pixels[0]).toBe(255);
    });

    it('renderPng từ chối SVG có href (ở mọi không gian tên) trỏ tệp, không vẽ', async () => {
      await expect(renderPng(attack(redPng), 1, 10_000)).rejects.toThrow(EXPORT_UNSAFE_CODE);
      const nested = `data:image/svg+xml;base64,${Buffer.from(attack(redPng)).toString('base64')}`;
      await expect(renderPng(attack(nested), 1, 10_000)).rejects.toThrow(EXPORT_UNSAFE_CODE);
    });
  });

  it('quá thời gian cho phép: ném lỗi hết giờ, không treo', async () => {
    await expect(renderPng(SVG, 2, 0)).rejects.toThrow('DIAGRAM_EXPORT_TIMEOUT');
  });

  it('PDF một trang chứa ảnh, cỡ trang theo điểm ảnh CSS, thông tin tài liệu là chân trang', async () => {
    const png = await renderPng(SVG, 2, 10_000);
    const pdf = await pngToPdf(png, { width: 200, height: 100 }, { title: 'Bản vẽ E2E — phiên bản #3', subject: 'Chân trang', author: 'Nguyễn Xuất' });
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getSize()).toEqual({ width: 150, height: 75 });
    expect(doc.getTitle()).toBe('Bản vẽ E2E — phiên bản #3');
    expect(doc.getAuthor()).toBe('Nguyễn Xuất');
  });
});
