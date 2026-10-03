import { PDFDocument } from 'pdf-lib';
import { pngToPdf, renderPng } from './diagram-render';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#ffffff"/><text x="10" y="50" font-family="Helvetica" font-size="14">Tủ mạng Lầu 3</text></svg>';

describe('renderPng / pngToPdf — raster hoá phía server, không mạng, phông tiếng Việt kèm gói', () => {
  it('PNG đúng chữ ký và đúng kích thước theo độ nét', async () => {
    const png = await renderPng(SVG, 2, 10_000);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(400);
    expect(png.readUInt32BE(20)).toBe(200);
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
