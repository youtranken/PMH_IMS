#!/usr/bin/env node
/**
 * Sinh file mẫu import thiết bị cho Epic 2 (FR-003).
 *
 *   node scripts/make-import-template.mjs ../docs/mau-du-lieu/mau-import-thiet-bi.xlsx
 *
 * File gồm 3 sheet:
 *   1. "Thiết bị"  — nơi nhập dữ liệu, có sẵn 12 dòng mẫu để đối chiếu định dạng.
 *   2. "Danh mục"  — site / tủ / loại / nhà cung cấp hợp lệ (import sẽ đối chiếu cột này).
 *   3. "Hướng dẫn" — ý nghĩa từng cột và quy tắc bắt buộc.
 *
 * Giữ file này trong repo để mẫu luôn tái tạo được và khớp với validate lúc import.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import ExcelJS from 'exceljs';

const OUT = resolve(process.argv[2] ?? '../docs/mau-du-lieu/mau-import-thiet-bi.xlsx');

const COLUMNS = [
  { header: 'Mã thiết bị *', key: 'code', width: 18 },
  { header: 'Tên thiết bị *', key: 'name', width: 30 },
  { header: 'Loại thiết bị *', key: 'type', width: 18 },
  { header: 'Hãng', key: 'vendor', width: 14 },
  { header: 'Model', key: 'model', width: 22 },
  { header: 'Serial', key: 'serial', width: 20 },
  { header: 'Site *', key: 'site', width: 12 },
  { header: 'Tủ', key: 'cabinet', width: 12 },
  { header: 'Vị trí U', key: 'rackUnit', width: 10 },
  { header: 'Người/Bộ phận sử dụng', key: 'user', width: 24 },
  { header: 'Nhà cung cấp', key: 'supplier', width: 22 },
  { header: 'Ngày mua', key: 'purchasedAt', width: 12 },
  { header: 'Bảo hành (tháng)', key: 'warrantyMonths', width: 16 },
  { header: 'IP quản trị', key: 'mgmtIp', width: 16 },
  { header: 'Ghi chú', key: 'note', width: 34 },
];

const SAMPLE_ROWS = [
  ['SW-CORE-01', 'Switch lõi phòng máy chủ', 'Switch', 'Cisco', 'C9300-24T', 'FOC2412X1AB', 'PMH-HO', 'R01', '20-21', 'Phòng IT', 'Công ty TNHH ABC Networks', '2024-03-15', 36, '172.16.10.2', 'Uplink 10G tới SW-ACC các tầng'],
  ['SW-ACC-3F-01', 'Switch tầng 3 khu A', 'Switch', 'Aruba', '2930F-48G', 'CN31GX20YZ', 'PMH-HO', 'R03', '12', 'Phòng IT', 'Công ty TNHH ABC Networks', '2024-03-15', 36, '172.16.10.13', ''],
  ['SW-ACC-3F-02', 'Switch tầng 3 khu B', 'Switch', 'Aruba', '2930F-24G', 'CN31GX21AA', 'PMH-HO', 'R03', '13', 'Phòng IT', 'Công ty TNHH ABC Networks', '2024-03-15', 36, '172.16.10.14', ''],
  ['FW-DRAYTEK-01', 'Router/Firewall Internet chính', 'Firewall', 'Draytek', 'Vigor3910', 'DT2410-0091', 'PMH-HO', 'R01', '2', 'Phòng IT', 'Nhà phân phối Draytek VN', '2023-11-02', 24, '172.16.10.1', 'NAT + VPN site-to-site nhà máy'],
  ['SRV-APP-01', 'Máy chủ ứng dụng nội bộ', 'Server', 'Dell', 'PowerEdge R650', 'CN7052-XY12', 'PMH-HO', 'R02', '5-6', 'Phòng IT', 'Dell Partner VN', '2024-06-20', 36, '172.16.20.11', 'Chạy Docker: QLTS, IMS'],
  ['SRV-DB-01', 'Máy chủ CSDL', 'Server', 'Dell', 'PowerEdge R750', 'CN7052-XY44', 'PMH-HO', 'R02', '8-9', 'Phòng IT', 'Dell Partner VN', '2024-06-20', 36, '172.16.20.12', 'Postgres chính'],
  ['NAS-BACKUP-01', 'NAS lưu backup đêm', 'NAS', 'Synology', 'RS1221+', 'SYN2309-114', 'PMH-HO', 'R02', '14', 'Phòng IT', 'Synology Reseller', '2024-01-10', 24, '172.16.20.50', 'Tách máy với máy chủ chính (NFR-05)'],
  ['UPS-R01-01', 'UPS tủ R01', 'UPS', 'APC', 'SRT5KRMXLI', 'AP2314-778', 'PMH-HO', 'R01', '1', 'Phòng IT', 'Schneider Partner', '2023-08-05', 24, '', 'Thay bình quý 2 hằng năm'],
  ['AP-3F-01', 'Access Point tầng 3 sảnh', 'Access Point', 'Ubiquiti', 'U6-Pro', 'UBNT-6P-2201', 'PMH-HO', '', '', 'Toàn công ty', 'Ubiquiti Reseller', '2025-02-18', 12, '172.16.30.21', 'PoE từ SW-ACC-3F-01 port 24'],
  ['PC-KT-05', 'Máy trạm phòng Kế toán', 'PC', 'HP', 'ProDesk 400 G9', 'HP2405-KT05', 'PMH-HO', '', '', 'Nguyễn Thị B — Kế toán', 'CTY Máy tính XYZ', '2025-05-09', 36, '172.16.40.35', ''],
  ['PRN-KT-01', 'Máy in phòng Kế toán', 'Printer', 'Canon', 'LBP664Cx', 'CN2405-PR01', 'PMH-HO', '', '', 'Phòng Kế toán', 'CTY Máy tính XYZ', '2025-05-09', 12, '172.16.40.90', ''],
  ['SW-NM-01', 'Switch nhà máy khu sản xuất', 'Switch', 'Cisco', 'CBS350-24T', 'FOC2501NM01', 'PMH-NM', 'RNM1', '10', 'Phòng IT', 'Công ty TNHH ABC Networks', '2025-01-20', 36, '172.16.50.2', 'Qua VPN site-to-site về HO'],
];

const CATALOG = {
  sites: [
    ['PMH-HO', 'Văn phòng chính', 'Trụ sở — phòng máy chủ tầng 1'],
    ['PMH-NM', 'Nhà máy', 'Khu sản xuất — tủ mạng phòng kỹ thuật'],
  ],
  cabinets: [
    ['R01', 'PMH-HO', 'Tủ mạng chính (Internet, core switch, UPS)', 42],
    ['R02', 'PMH-HO', 'Tủ máy chủ (server, NAS)', 42],
    ['R03', 'PMH-HO', 'Tủ tầng 3 (switch tầng)', 12],
    ['R04', 'PMH-HO', 'Tủ tầng 4 (switch tầng)', 12],
    ['RNM1', 'PMH-NM', 'Tủ mạng nhà máy', 24],
  ],
  deviceTypes: [
    ['Switch', 'Thiết bị chuyển mạch — có port map'],
    ['Firewall', 'Tường lửa / router biên — gắn hồ sơ ISP và NAT'],
    ['Server', 'Máy chủ vật lý'],
    ['NAS', 'Thiết bị lưu trữ mạng'],
    ['UPS', 'Bộ lưu điện'],
    ['Access Point', 'Điểm phát Wi-Fi'],
    ['PC', 'Máy trạm người dùng'],
    ['Laptop', 'Máy tính xách tay'],
    ['Printer', 'Máy in / máy scan'],
    ['Camera', 'Camera giám sát'],
    ['Điện thoại IP', 'Máy nhánh IP'],
    ['Thiết bị khác', 'Không thuộc các loại trên'],
  ],
  suppliers: [
    ['Công ty TNHH ABC Networks', 'Thiết bị mạng Cisco/Aruba', '0909 xxx xxx'],
    ['Nhà phân phối Draytek VN', 'Draytek, thiết bị biên', '0909 xxx xxx'],
    ['Dell Partner VN', 'Máy chủ Dell', '0909 xxx xxx'],
    ['Synology Reseller', 'NAS Synology', '0909 xxx xxx'],
    ['Schneider Partner', 'UPS APC', '0909 xxx xxx'],
    ['Ubiquiti Reseller', 'Access Point Ubiquiti', '0909 xxx xxx'],
    ['CTY Máy tính XYZ', 'PC, máy in, vật tư', '0909 xxx xxx'],
  ],
};

const GUIDE = [
  ['Cột', 'Bắt buộc', 'Quy tắc'],
  ['Mã thiết bị', 'Có', 'Duy nhất toàn hệ thống. Gợi ý: <LOẠI>-<VỊ TRÍ>-<SỐ>, vd SW-ACC-3F-01.'],
  ['Tên thiết bị', 'Có', 'Mô tả người đọc hiểu, không viết tắt khó đoán.'],
  ['Loại thiết bị', 'Có', 'Phải khớp một dòng ở sheet "Danh mục" (cột Loại thiết bị).'],
  ['Hãng / Model / Serial', 'Không', 'Serial nên có với thiết bị còn bảo hành.'],
  ['Site', 'Có', 'Mã site ở sheet "Danh mục".'],
  ['Tủ', 'Không', 'Chỉ thiết bị đặt trong tủ. Phải thuộc đúng site.'],
  ['Vị trí U', 'Không', 'Số U hoặc khoảng, vd "20-21".'],
  ['Người/Bộ phận sử dụng', 'Không', 'Người giữ hoặc phòng ban dùng.'],
  ['Nhà cung cấp', 'Không', 'Khớp sheet "Danh mục" nếu có.'],
  ['Ngày mua', 'Không', 'Định dạng YYYY-MM-DD.'],
  ['Bảo hành (tháng)', 'Không', 'Số tháng. Hệ thống TỰ TÍNH ngày hết bảo hành = ngày mua + số tháng (FR-001).'],
  ['IP quản trị', 'Không', 'IP static. Epic 5 sẽ đối chiếu với sổ IP; trùng IP sẽ bị cảnh báo.'],
  ['Ghi chú', 'Không', 'Thông tin thêm. TUYỆT ĐỐI KHÔNG ghi mật khẩu ở đây — mật khẩu vào Két sắt (FR-021).'],
  ['', '', ''],
  ['Import hoạt động thế nào', '', ''],
  ['1', '', 'Tải file này, điền dữ liệu vào sheet "Thiết bị" (xóa 12 dòng mẫu).'],
  ['2', '', 'Vào màn Thiết bị → Import → chọn file. Hệ thống kiểm tra và hiện bảng lỗi trước.'],
  ['3', '', 'Sửa các dòng lỗi rồi import lại. Chỉ khi không còn lỗi mới ghi vào hệ thống.'],
  ['4', '', 'Import lại cùng Mã thiết bị = CẬP NHẬT hồ sơ đó, không tạo bản trùng.'],
];

async function main() {
  await mkdir(dirname(OUT), { recursive: true });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IMS — PMH';
  wb.created = new Date('2026-08-22T00:00:00Z');

  const sheet = wb.addWorksheet('Thiết bị', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = COLUMNS;
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
  for (const row of SAMPLE_ROWS) sheet.addRow(row);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  const catalog = wb.addWorksheet('Danh mục');
  addBlock(catalog, 'SITE', ['Mã site', 'Tên', 'Ghi chú'], CATALOG.sites);
  addBlock(catalog, 'TỦ MẠNG', ['Mã tủ', 'Thuộc site', 'Mô tả', 'Số U'], CATALOG.cabinets);
  addBlock(catalog, 'LOẠI THIẾT BỊ', ['Loại thiết bị', 'Mô tả'], CATALOG.deviceTypes);
  addBlock(catalog, 'NHÀ CUNG CẤP', ['Tên', 'Cung cấp gì', 'Liên hệ'], CATALOG.suppliers);
  catalog.columns.forEach((c) => {
    c.width = 32;
  });

  const guide = wb.addWorksheet('Hướng dẫn');
  for (const row of GUIDE) guide.addRow(row);
  guide.getRow(1).font = { bold: true };
  guide.getColumn(1).width = 26;
  guide.getColumn(2).width = 12;
  guide.getColumn(3).width = 90;
  guide.getColumn(3).alignment = { wrapText: true, vertical: 'top' };

  await wb.xlsx.writeFile(OUT);
  console.log(`Đã tạo ${OUT}`);
}

function addBlock(sheet, title, headers, rows) {
  const titleRow = sheet.addRow([title]);
  titleRow.font = { bold: true, size: 12 };
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  sheet.addRow([]);
}

main().catch((error) => {
  console.error('Tạo file mẫu thất bại:', error.message);
  process.exit(1);
});
