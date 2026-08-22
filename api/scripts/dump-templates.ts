/**
 * Sinh bản file mẫu để ĐÍNH KÈM VÀO REPO (`docs/mau-du-lieu/`) — tiện cho người dùng lấy
 * file trước khi hệ thống chạy.
 *
 *   npm --prefix api run make:templates
 *
 * Định nghĩa mẫu nằm ở `src/modules/catalog/catalog-template.ts` và app cũng sinh từ đúng
 * file đó (`GET /api/v1/catalog/template`) — AD-15: một định nghĩa, hai đường phát hành.
 * KHÔNG viết lại danh sách cột ở đây.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ExcelExportService } from '../src/common/excel/excel-export.service';
import { catalogTemplateSheets } from '../src/modules/catalog/catalog-template';

const OUT = resolve(
  process.argv[2] ?? '../docs/mau-du-lieu/mau-danh-muc.xlsx',
);

/** 12 loại thiết bị khớp migration 0011 — bản trong repo phải giống hệ thống mới cài. */
const SEED_DEVICE_TYPES: [string, boolean, string][] = [
  ['Switch', true, 'Thiết bị chuyển mạch — trang chi tiết có bảng port map'],
  ['Firewall', true, 'Router/tường lửa biên — gắn hồ sơ ISP và sổ NAT'],
  ['Server', true, 'Máy chủ vật lý'],
  ['NAS', true, 'Thiết bị lưu trữ mạng'],
  ['UPS', true, 'Bộ lưu điện'],
  ['Access Point', false, 'Điểm phát Wi-Fi'],
  ['PC', false, 'Máy trạm người dùng'],
  ['Laptop', false, 'Máy tính xách tay'],
  ['Printer', false, 'Máy in / máy scan'],
  ['Camera', false, 'Camera giám sát'],
  ['Điện thoại IP', false, 'Máy nhánh IP'],
  ['Thiết bị khác', false, 'Không thuộc các loại trên'],
];

const NOW = new Date('2026-08-22T00:00:00Z');

async function main(): Promise<void> {
  const sheets = catalogTemplateSheets({
    // Site / tủ / NCC để TRỐNG: bản trong repo dành cho hệ thống mới cài, chưa có dữ liệu
    // riêng của công ty — mẫu tự điền vài dòng ví dụ.
    sites: [],
    cabinets: [],
    deviceTypes: SEED_DEVICE_TYPES.map(([name, hasPortMap, description], index) => ({
      id: String(index),
      name,
      hasPortMap,
      description,
      active: true,
      createdAt: NOW,
      updatedAt: NOW,
    })),
    vendors: [],
  });

  const buffer = await new ExcelExportService().buildWorkbook(sheets);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, buffer);
  console.log(`Đã tạo ${OUT}`);
}

main().catch((error: unknown) => {
  console.error('Sinh file mẫu thất bại:', (error as Error).message);
  process.exit(1);
});
