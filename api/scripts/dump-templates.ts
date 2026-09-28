/**
 * Sinh bản file mẫu để ĐÍNH KÈM VÀO REPO (`docs/mau-du-lieu/`) — tiện cho người dùng lấy
 * file trước khi hệ thống chạy.
 *
 *   npm --prefix api run make:templates
 *
 * Định nghĩa mẫu nằm ở `src/modules/catalog/catalog-template.ts` và
 * `src/modules/devices/device-template.ts`; app cũng sinh từ đúng hai file đó
 * (`GET /catalog/template`, `GET /devices/template`) — AD-15: một định nghĩa, hai đường
 * phát hành. KHÔNG viết lại danh sách cột ở đây.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ExcelExportService } from '../src/common/excel/excel-export.service';
import { catalogTemplateSheets } from '../src/modules/catalog/catalog-template';
import { deviceTemplateSheets } from '../src/modules/devices/device-template';

const OUT_DIR = resolve(process.argv[2] ?? '../docs/mau-du-lieu');

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
  const excel = new ExcelExportService();
  await mkdir(OUT_DIR, { recursive: true });

  const catalogSheets = catalogTemplateSheets({
    // Site / tủ / NCC để TRỐNG: bản trong repo dành cho hệ thống mới cài, chưa có dữ liệu
    // riêng của công ty — mẫu tự điền vài dòng ví dụ.
    sites: [],
    cabinets: [],
    deviceTypes: SEED_DEVICE_TYPES.map(([name, hasPortMap, description], index) => ({
      id: String(index),
      name,
      hasPortMap,
      // Mẫu Excel không có cột này — cờ router bật ở màn Danh mục.
      isRouter: false,
      description,
      active: true,
      createdAt: NOW,
      updatedAt: NOW,
    })),
    vendors: [],
  });

  await write('mau-danh-muc.xlsx', await excel.buildWorkbook(catalogSheets));

  // Kho rỗng → file mẫu thiết bị tự điền 2 dòng ví dụ (SW-CORE-01, PC-KT-05).
  await write('mau-thiet-bi.xlsx', await excel.buildWorkbook(deviceTemplateSheets([])));
}

async function write(fileName: string, buffer: Buffer): Promise<void> {
  const path = resolve(OUT_DIR, fileName);
  await writeFile(path, buffer);
  console.log(`Đã tạo ${path}`);
}

main().catch((error: unknown) => {
  console.error('Sinh file mẫu thất bại:', (error as Error).message);
  process.exit(1);
});
