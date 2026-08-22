import type { ExportSheet } from '../../common/excel/excel-export.service';
import type { DeviceListItem, DeviceStatus } from './devices.types';

/**
 * File mẫu / file export THIẾT BỊ (story 2.6, FR-001 + FR-028).
 *
 * ĐỊNH NGHĨA DUY NHẤT của bộ cột: nút "Tải file mẫu", nút "Xuất Excel" và bản nằm trong
 * `docs/mau-du-lieu/` đều sinh từ đây. Nhờ vậy vòng XUẤT → SỬA → NHẬP LẠI khép kín:
 * file xuất ra luôn nhập lại được, không phải sửa cột bằng tay.
 */

export const DEVICE_EXAMPLE_MARK = 'VÍ DỤ';

/** Nhãn trạng thái ghi ra file — bộ đọc nhận lại đúng các nhãn này. */
const STATUS_LABEL: Record<DeviceStatus, string> = {
  in_use: 'Đang dùng',
  spare: 'Dự phòng',
  broken: 'Hỏng',
  retired: 'Đã thanh lý',
};

interface DeviceRowValues {
  values: (string | number | null)[];
  example?: boolean;
}

type HeaderSpec = [string, number];

/** Thứ tự cột = thứ tự người ta đọc hồ sơ: định danh → phân loại → vị trí → tiền → ghi chú. */
const HEADERS: HeaderSpec[] = [
  ['Mã thiết bị *', 20],
  ['Tên thiết bị *', 32],
  ['Loại *', 18],
  ['Model', 20],
  ['Serial', 20],
  ['Site', 14],
  ['Tủ mạng', 14],
  ['Nhà cung cấp', 26],
  ['Người sử dụng', 20],
  ['Bộ phận', 18],
  ['Ngày mua', 14],
  ['Bảo hành từ', 14],
  ['Bảo hành đến', 14],
  ['Trạng thái', 14],
  ['Ghi chú', 34],
  ['Ghi chú nhập', 14],
];

const GUIDE_HEADERS: HeaderSpec[] = [
  ['Mục', 30],
  ['Bắt buộc', 14],
  ['Giải thích', 96],
];

const GUIDE_ROWS: DeviceRowValues[] = [
  {
    values: [
      'Làm gì trước',
      '',
      'Danh mục (site, tủ, loại, NCC) phải có TRƯỚC. Cột danh mục trong file này ghi theo MÃ/TÊN; hệ thống không tự tạo mục mới, gõ sai là báo lỗi dòng đó.',
    ],
  },
  { values: ['Cột có dấu *', 'Bắt buộc', 'Thiếu là dòng đó báo lỗi và không được nhập.'] },
  {
    values: [
      'Mã thiết bị',
      'Bắt buộc',
      'Là khóa để nhập lại: import trùng mã = CẬP NHẬT thiết bị đó, không tạo bản sao. Không phân biệt hoa-thường.',
    ],
  },
  {
    values: [
      'Loại',
      'Bắt buộc',
      'Ghi đúng tên loại trong Danh mục: Switch, Firewall, Server, NAS, UPS, Access Point, PC, Laptop, Printer, Camera, Điện thoại IP, Thiết bị khác.',
    ],
  },
  {
    values: [
      'Site và Tủ mạng',
      'Không',
      'Ghi MÃ (vd PMH-HO, R01). Mã tủ chỉ duy nhất trong một site nên có tủ thì phải có site. Thiết bị không nằm trong tủ (PC, máy in, AP) để trống cột Tủ.',
    ],
  },
  {
    values: [
      'Ngày',
      'Không',
      'Ghi 30/08/2026 hoặc 2026-08-30 đều được. KHÔNG dùng kiểu tháng-trước-ngày (08/30/2026).',
    ],
  },
  {
    values: [
      'Trạng thái',
      'Không',
      'Đang dùng (mặc định) · Dự phòng · Hỏng · Đã thanh lý. Bỏ trống thì hiểu là Đang dùng.',
    ],
  },
  {
    values: [
      'Ghi chú',
      'Không',
      'TUYỆT ĐỐI không ghi mật khẩu ở đây (FR-035). Mật khẩu thiết bị vào Két sắt.',
    ],
  },
  {
    values: [
      'Cột bị xóa khỏi file',
      '',
      'Bỏ hẳn một cột = "đừng đụng tới trường đó" khi cập nhật. Để cột lại nhưng bỏ trống ô = xóa giá trị đang có.',
    ],
  },
  {
    values: [
      'Dòng có chữ VÍ DỤ',
      '',
      'Là dòng minh họa, import tự bỏ qua. Xóa đi cho gọn cũng được.',
    ],
  },
  {
    values: [
      'Xuất ra rồi nhập lại',
      '',
      'Nút "Xuất Excel" ở màn Thiết bị sinh đúng bộ cột này — xuất ra, sửa hàng loạt trong Excel, rồi nhập lại được ngay.',
    ],
  },
];

const EXAMPLE_ROWS: DeviceRowValues[] = [
  {
    values: [
      'SW-CORE-01',
      'Switch lõi phòng máy chủ',
      'Switch',
      'C9300-24T',
      'FOC2530X1AB',
      'PMH-HO',
      'R01',
      'Công ty TNHH ABC Networks',
      'phòng IT',
      'IT',
      '15/03/2025',
      '15/03/2025',
      '15/03/2028',
      'Đang dùng',
      'Uplink đi firewall',
      DEVICE_EXAMPLE_MARK,
    ],
    example: true,
  },
  {
    values: [
      'PC-KT-05',
      'Máy trạm Kế toán 05',
      'PC',
      'Dell OptiPlex 7010',
      'DL7010KT05',
      'PMH-HO',
      '',
      'Dell Partner VN',
      'chị Lan',
      'Kế toán',
      '02/01/2024',
      '',
      '02/01/2027',
      'Đang dùng',
      '',
      DEVICE_EXAMPLE_MARK,
    ],
    example: true,
  },
];

/** Một dòng thiết bị thật → mảng ô, đúng thứ tự HEADERS. */
function toRow(device: DeviceListItem): DeviceRowValues {
  return {
    values: [
      device.code,
      device.name,
      device.deviceTypeName,
      device.model ?? '',
      device.serial ?? '',
      device.siteCode ?? '',
      device.cabinetCode ?? '',
      device.vendorName ?? '',
      device.assignedTo ?? '',
      device.department ?? '',
      device.purchaseDate ?? '',
      device.warrantyStart ?? '',
      device.warrantyEnd ?? '',
      STATUS_LABEL[device.status],
      device.note ?? '',
      '',
    ],
  };
}

function deviceSheet(rows: DeviceRowValues[]): ExportSheet<DeviceRowValues> {
  return {
    name: 'Thiết bị',
    columns: HEADERS.map(([header, width], index) => ({
      header,
      width,
      value: (row: DeviceRowValues) => row.values[index] ?? null,
    })),
    rows,
    isExample: (row: DeviceRowValues) => row.example === true,
  };
}

/** File MẪU: kho rỗng thì điền 2 dòng ví dụ; có dữ liệu thì đổ luôn ra để sửa rồi nhập lại. */
export function deviceTemplateSheets(devices: DeviceListItem[]): ExportSheet<DeviceRowValues>[] {
  return [
    {
      name: 'Hướng dẫn',
      noFilter: true,
      columns: GUIDE_HEADERS.map(([header, width], index) => ({
        header,
        width,
        value: (row: DeviceRowValues) => row.values[index] ?? null,
      })),
      rows: GUIDE_ROWS,
    },
    deviceSheet(devices.length > 0 ? devices.map(toRow) : EXAMPLE_ROWS),
  ];
}

/**
 * File EXPORT (FR-028): CHỈ sheet dữ liệu, đúng bộ cột của file mẫu — tôn trọng bộ lọc
 * đang xem (nơi gọi truyền vào danh sách đã lọc).
 */
export function deviceExportSheets(devices: DeviceListItem[]): ExportSheet<DeviceRowValues>[] {
  return [deviceSheet(devices.map(toRow))];
}
