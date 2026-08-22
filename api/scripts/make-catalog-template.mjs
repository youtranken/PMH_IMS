#!/usr/bin/env node
/**
 * Sinh file mẫu KHAI BÁO DANH MỤC cho Epic 2 story 2.1 (FR-004).
 *
 *   node scripts/make-catalog-template.mjs ../docs/mau-du-lieu/mau-danh-muc.xlsx
 *
 * Người dùng điền file này TRƯỚC, import vào hệ thống, rồi mới import thiết bị —
 * vì hồ sơ thiết bị tham chiếu tới site/tủ/loại/NCC trong đây.
 *
 * Mỗi sheet có: dòng tiêu đề (khóa để import đọc đúng cột) + vài dòng ví dụ được đánh dấu
 * `VÍ DỤ` ở cột cuối. Import BỎ QUA mọi dòng có chữ VÍ DỤ nên anh không cần xóa tay,
 * nhưng xóa đi thì file gọn hơn.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import ExcelJS from 'exceljs';

const OUT = resolve(process.argv[2] ?? '../docs/mau-du-lieu/mau-danh-muc.xlsx');

const EXAMPLE = 'VÍ DỤ';

/** Loại thiết bị là thứ chung cho mọi công ty → điền sẵn, không đánh dấu VÍ DỤ. */
const DEVICE_TYPES = [
  ['Switch', 'Có', 'Thiết bị chuyển mạch — trang chi tiết có bảng port map'],
  ['Firewall', 'Có', 'Router/tường lửa biên — gắn hồ sơ ISP và sổ NAT'],
  ['Server', 'Có', 'Máy chủ vật lý'],
  ['NAS', 'Có', 'Thiết bị lưu trữ mạng'],
  ['UPS', 'Có', 'Bộ lưu điện'],
  ['Access Point', 'Không', 'Điểm phát Wi-Fi'],
  ['PC', 'Không', 'Máy trạm người dùng'],
  ['Laptop', 'Không', 'Máy tính xách tay'],
  ['Printer', 'Không', 'Máy in / máy scan'],
  ['Camera', 'Không', 'Camera giám sát'],
  ['Điện thoại IP', 'Không', 'Máy nhánh IP'],
  ['Thiết bị khác', 'Không', 'Không thuộc các loại trên'],
];

const SHEETS = [
  {
    name: 'Site',
    widths: [16, 34, 40, 12],
    headers: ['Mã site *', 'Tên site *', 'Địa chỉ / ghi chú', 'Ghi chú nhập'],
    rows: [
      ['PMH-HO', 'Văn phòng chính', 'Phòng máy chủ tầng 1', EXAMPLE],
      ['PMH-NM', 'Nhà máy', 'Tủ mạng phòng kỹ thuật', EXAMPLE],
    ],
  },
  {
    name: 'Tủ mạng',
    widths: [16, 16, 40, 10, 12],
    headers: ['Mã tủ *', 'Thuộc site *', 'Mô tả / vị trí', 'Số U', 'Ghi chú nhập'],
    rows: [
      ['R01', 'PMH-HO', 'Tủ mạng chính — Internet, core switch, UPS', 42, EXAMPLE],
      ['R02', 'PMH-HO', 'Tủ máy chủ — server, NAS', 42, EXAMPLE],
      ['RNM1', 'PMH-NM', 'Tủ mạng nhà máy', 24, EXAMPLE],
    ],
  },
  {
    name: 'Loại thiết bị',
    widths: [24, 14, 52, 12],
    headers: ['Tên loại *', 'Có port map?', 'Mô tả', 'Ghi chú nhập'],
    rows: DEVICE_TYPES.map((r) => [...r, '']),
  },
  {
    name: 'Nhà cung cấp',
    widths: [36, 30, 22, 26, 12],
    headers: ['Tên nhà cung cấp *', 'Cung cấp gì', 'Điện thoại', 'Email / người liên hệ', 'Ghi chú nhập'],
    rows: [
      ['Công ty TNHH ABC Networks', 'Thiết bị mạng Cisco/Aruba', '0909 xxx xxx', 'anh Nam — sales', EXAMPLE],
      ['Dell Partner VN', 'Máy chủ Dell', '0909 xxx xxx', '', EXAMPLE],
    ],
  },
];

const GUIDE = [
  ['KHAI BÁO DANH MỤC — HƯỚNG DẪN', '', ''],
  ['', '', ''],
  ['Vì sao phải điền file này trước', '', 'Hồ sơ thiết bị tham chiếu tới site / tủ / loại / nhà cung cấp. Danh mục vào trước thì lúc import 300 thiết bị hệ thống mới đối chiếu được và chặn được lỗi gõ sai.'],
  ['Thứ tự làm', '', '1) Điền 4 sheet trong file này  →  2) Import danh mục  →  3) Điền file mau-import-thiet-bi.xlsx  →  4) Import thiết bị'],
  ['Dòng có chữ VÍ DỤ', '', 'Là dòng minh họa. Import tự bỏ qua, không cần xóa — nhưng xóa đi thì dễ nhìn hơn.'],
  ['Cột có dấu *', '', 'Bắt buộc. Thiếu là dòng đó bị báo lỗi và không được nhập.'],
  ['', '', ''],
  ['Sheet Site', '', ''],
  ['Mã site', 'Bắt buộc', 'VIẾT HOA, không dấu, không khoảng trắng. Đây là mã anh gõ khi tra cứu, đổi về sau rất phiền — chốt kỹ. Vd: PMH-HO, PMH-NM, PMH-KHO.'],
  ['Tên site', 'Bắt buộc', 'Tên tiếng Việt có dấu, hiện trên màn hình.'],
  ['', '', ''],
  ['Sheet Tủ mạng', '', ''],
  ['Mã tủ', 'Bắt buộc', 'Duy nhất TRONG một site. Vd R01, R02, RNM1.'],
  ['Thuộc site', 'Bắt buộc', 'Phải khớp một Mã site ở sheet Site.'],
  ['Số U', 'Không', 'Chiều cao tủ (số U). Bỏ trống nếu không rõ.'],
  ['Thiết bị không nằm trong tủ', '', 'PC, máy in, AP treo tường… không cần khai tủ — để trống cột Tủ khi nhập thiết bị.'],
  ['', '', ''],
  ['Sheet Loại thiết bị', '', ''],
  ['Đã điền sẵn 12 loại', '', 'Sửa/xóa/thêm thoải mái. Loại nào công ty không có thì xóa cho gọn danh sách chọn.'],
  ['Có port map?', 'Có/Không', 'Ghi "Có" thì trang chi tiết thiết bị loại đó hiện bảng port map (FR-006). Thường chỉ Switch, Firewall, Server, NAS, UPS cần.'],
  ['', '', ''],
  ['Sheet Nhà cung cấp', '', ''],
  ['Tên nhà cung cấp', 'Bắt buộc', 'Ghi đúng tên hay dùng khi liên hệ bảo hành. Trùng tên sẽ bị gộp.'],
  ['Điện thoại / liên hệ', 'Không', 'Có thì lúc thiết bị hỏng khỏi phải đi tìm số.'],
  ['', '', ''],
  ['Sau khi điền xong', '', 'Vào màn Quản trị › Danh mục › Import, chọn file này. Hệ thống hiện bảng đối chiếu (thêm mới / cập nhật / lỗi) để anh duyệt TRƯỚC khi ghi.'],
  ['Import lại lần nữa', '', 'Trùng mã = CẬP NHẬT mục đó, không tạo bản sao. Mục đang có thiết bị dùng thì không xóa được, chỉ vô hiệu hóa.'],
];

async function main() {
  await mkdir(dirname(OUT), { recursive: true });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'IMS — PMH';
  wb.created = new Date('2026-08-22T00:00:00Z');

  const guide = wb.addWorksheet('Hướng dẫn', { views: [{ state: 'frozen', ySplit: 1 }] });
  for (const row of GUIDE) guide.addRow(row);
  guide.getRow(1).font = { bold: true, size: 13 };
  guide.getColumn(1).width = 32;
  guide.getColumn(2).width = 14;
  guide.getColumn(3).width = 96;
  guide.getColumn(3).alignment = { wrapText: true, vertical: 'top' };
  guide.eachRow((row) => {
    const first = String(row.getCell(1).value ?? '');
    if (first.startsWith('Sheet ')) row.font = { bold: true };
  });

  for (const spec of SHEETS) {
    const sheet = wb.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.addRow(spec.headers);
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true };
    spec.widths.forEach((w, i) => {
      sheet.getColumn(i + 1).width = w;
    });

    for (const row of spec.rows) {
      const added = sheet.addRow(row);
      if (row[row.length - 1] === EXAMPLE) {
        // Dòng ví dụ để chữ xám nghiêng — nhìn là biết không phải dữ liệu thật.
        added.font = { italic: true, color: { argb: 'FF8A908A' } };
      }
    }
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: spec.headers.length },
    };
  }

  await wb.xlsx.writeFile(OUT);
  console.log(`Đã tạo ${OUT}`);
}

main().catch((error) => {
  console.error('Tạo file mẫu thất bại:', error.message);
  process.exit(1);
});
