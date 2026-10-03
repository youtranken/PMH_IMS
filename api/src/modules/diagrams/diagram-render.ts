import { dirname, join } from 'node:path';
import { renderAsync } from '@resvg/resvg-js';
import { PDFDocument } from 'pdf-lib';
import { svgRenderReason } from '../../common/svg-sanitize';

/**
 * Raster hoá file xuất bản vẽ (FR-044) ngay trong api — KHÔNG gọi servlet `/export` của draw.io
 * (AD-17: không tồn tại) và không cần mạng lúc chạy.
 *
 * - `@resvg/resvg-js` (MPL-2.0): trình vẽ SVG viết bằng Rust, gói nhị phân dựng sẵn cho cả glibc
 *   lẫn musl (image `node:alpine`), không phụ thuộc thư viện hệ thống; `renderAsync` chạy trên
 *   threadpool của libuv nên một bản vẽ lớn không chặn vòng lặp sự kiện.
 * - Phông: image alpine không có phông nào, nên nạp tường minh DejaVu Sans từ gói
 *   `dejavu-fonts-ttf` (giấy phép Bitstream Vera/public domain, đủ dấu tiếng Việt) và tắt phông hệ
 *   thống — máy dev và container ra CÙNG một ảnh. Nhãn draw.io ghi "Helvetica" rơi về phông này.
 * - `pdf-lib` (MIT, thuần JS): PDF một trang nhúng đúng ảnh PNG đó, nên PNG và PDF không bao giờ
 *   lệch nhau về chân trang hay watermark.
 */

const FONT_DIR = join(dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT_FILES = [join(FONT_DIR, 'DejaVuSans.ttf'), join(FONT_DIR, 'DejaVuSans-Bold.ttf')];

export const EXPORT_TIMEOUT_CODE = 'DIAGRAM_EXPORT_TIMEOUT';
export const EXPORT_UNSAFE_CODE = 'DIAGRAM_EXPORT_UNSAFE';

/**
 * SVG → PNG ở độ nét `scale`. Quá `timeoutMs` thì ném `DIAGRAM_EXPORT_TIMEOUT`: luồng vẽ chạy nốt
 * trong threadpool (không huỷ được) nhưng người xuất nhận lỗi thay vì treo request.
 */
export async function renderPng(svg: string, scale: number, timeoutMs: number): Promise<Buffer> {
  // resvg đọc thẳng tệp cục bộ theo href và không có tuỳ chọn tắt — soi lại ngay trước khi vẽ,
  // không tin rằng SVG đã qua cổng lúc lưu (dữ liệu có thể bị sửa ngoài ứng dụng).
  if (svgRenderReason(svg) !== null) throw new Error(EXPORT_UNSAFE_CODE);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(EXPORT_TIMEOUT_CODE)), timeoutMs);
  });
  try {
    const rendered = await Promise.race([
      renderAsync(svg, {
        fitTo: { mode: 'zoom', value: scale },
        font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans', sansSerifFamily: 'DejaVu Sans' },
        shapeRendering: 2,
        textRendering: 1,
      }),
      timeout,
    ]);
    return Buffer.from(rendered.asPng());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * PNG → PDF một trang. Cỡ trang theo điểm ảnh CSS của hình (1px = 0,75pt) chứ không theo độ nét
 * raster, để in ra đúng tỉ lệ người vẽ thấy; thông tin tài liệu mang chân trang cho trình đọc PDF.
 */
export async function pngToPdf(
  png: Buffer,
  size: { width: number; height: number },
  info: { title: string; subject: string; author: string },
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(info.title);
  doc.setSubject(info.subject);
  doc.setAuthor(info.author);
  doc.setCreator('IMS');
  doc.setProducer('IMS');
  const image = await doc.embedPng(png);
  const width = size.width * 0.75;
  const height = size.height * 0.75;
  const page = doc.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });
  return Buffer.from(await doc.save());
}
