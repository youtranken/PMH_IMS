import type { ExportSheet } from '../../common/excel/excel-export.service';
import type {
  CabinetRecord,
  DeviceTypeRecord,
  SiteRecord,
  VendorRecord,
} from './catalog.types';

/**
 * File MẪU khai báo danh mục (story 2.1, FR-004).
 *
 * Đây là ĐỊNH NGHĨA DUY NHẤT của file mẫu — endpoint `/catalog/template` sinh từ đây,
 * bản nằm trong `docs/mau-du-lieu/` cũng sinh từ đây (`npm run make:templates`).
 * Không phục vụ file tĩnh: mẫu và bộ đọc file phải luôn khớp nhau, nếu không người dùng
 * điền đúng mẫu mà hệ thống vẫn báo "thiếu cột".
 *
 * Danh mục ĐANG CÓ được đổ thẳng vào file, nên nút này kiêm luôn việc "xuất danh mục
 * hiện tại ra sửa rồi nhập lại". Chỗ nào chưa có dữ liệu thì điền vài dòng ví dụ
 * (đánh dấu `VÍ DỤ` ở cột cuối — bước import tự bỏ qua, không cần xóa tay).
 */

export const EXAMPLE_MARK = 'VÍ DỤ';

export interface CatalogTemplateData {
  sites: SiteRecord[];
  cabinets: CabinetRecord[];
  deviceTypes: DeviceTypeRecord[];
  vendors: VendorRecord[];
}

interface TemplateRow {
  values: (string | number | null)[];
  example?: boolean;
}

/** [tiêu đề, độ rộng cột] */
type HeaderSpec = [string, number];

const SITE_HEADERS: HeaderSpec[] = [
  ['Mã site *', 16],
  ['Tên site *', 34],
  ['Địa chỉ / ghi chú', 40],
  ['Ghi chú nhập', 14],
];

const CABINET_HEADERS: HeaderSpec[] = [
  ['Mã tủ *', 16],
  ['Thuộc site *', 16],
  ['Mô tả / vị trí', 40],
  ['Số U', 10],
  ['Ghi chú nhập', 14],
];

const DEVICE_TYPE_HEADERS: HeaderSpec[] = [
  ['Tên loại *', 24],
  ['Có port map?', 14],
  ['Mô tả', 52],
  ['Ghi chú nhập', 14],
];

const VENDOR_HEADERS: HeaderSpec[] = [
  ['Tên nhà cung cấp *', 36],
  ['Cung cấp gì', 30],
  ['Điện thoại', 22],
  ['Email / người liên hệ', 26],
  ['Ghi chú nhập', 14],
];

const GUIDE_HEADERS: HeaderSpec[] = [
  ['Mục', 32],
  ['Bắt buộc', 14],
  ['Giải thích', 96],
];

const EXAMPLE_SITES: TemplateRow[] = [
  { values: ['PMH-HO', 'Văn phòng chính', 'Phòng máy chủ tầng 1', EXAMPLE_MARK], example: true },
  { values: ['PMH-NM', 'Nhà máy', 'Tủ mạng phòng kỹ thuật', EXAMPLE_MARK], example: true },
];

const EXAMPLE_CABINETS: TemplateRow[] = [
  {
    values: ['R01', 'PMH-HO', 'Tủ mạng chính — Internet, core switch, UPS', 42, EXAMPLE_MARK],
    example: true,
  },
  { values: ['R02', 'PMH-HO', 'Tủ máy chủ — server, NAS', 42, EXAMPLE_MARK], example: true },
  { values: ['RNM1', 'PMH-NM', 'Tủ mạng nhà máy', 24, EXAMPLE_MARK], example: true },
];

const EXAMPLE_VENDORS: TemplateRow[] = [
  {
    values: [
      'Công ty TNHH ABC Networks',
      'Thiết bị mạng Cisco/Aruba',
      '0909 xxx xxx',
      'anh Nam — sales',
      EXAMPLE_MARK,
    ],
    example: true,
  },
  { values: ['Dell Partner VN', 'Máy chủ Dell', '0909 xxx xxx', '', EXAMPLE_MARK], example: true },
];

const GUIDE_ROWS: TemplateRow[] = [
  {
    values: [
      'Vì sao điền file này trước',
      '',
      'Hồ sơ thiết bị tham chiếu tới site / tủ / loại / nhà cung cấp. Danh mục vào trước thì lúc import thiết bị hệ thống mới đối chiếu được và chặn được lỗi gõ sai.',
    ],
  },
  {
    values: [
      'Thứ tự làm',
      '',
      '1) Điền 4 sheet trong file này → 2) Quản trị › Danh mục › Nhập từ Excel → 3) Điền file mẫu thiết bị → 4) Import thiết bị',
    ],
  },
  {
    values: [
      'Dòng có chữ VÍ DỤ',
      '',
      'Là dòng minh họa. Import tự bỏ qua, không cần xóa — nhưng xóa đi thì dễ nhìn hơn.',
    ],
  },
  {
    values: ['Cột có dấu *', '', 'Bắt buộc. Thiếu là dòng đó báo lỗi và không được nhập.'],
  },
  {
    values: [
      'Cột bị xóa khỏi file',
      '',
      'Bỏ hẳn một cột = "đừng đụng tới trường đó" (giữ nguyên giá trị đang có). Để cột lại nhưng bỏ trống ô = xóa giá trị đó đi.',
    ],
  },
  { values: ['', '', ''] },
  { values: ['Sheet Site', '', ''] },
  {
    values: [
      'Mã site',
      'Bắt buộc',
      'VIẾT HOA, không dấu, không khoảng trắng. Đây là mã gõ khi tra cứu, đổi về sau rất phiền — chốt kỹ. Vd: PMH-HO, PMH-NM, PMH-KHO.',
    ],
  },
  { values: ['Tên site', 'Bắt buộc', 'Tên tiếng Việt có dấu, hiện trên màn hình.'] },
  { values: ['', '', ''] },
  { values: ['Sheet Tủ mạng', '', ''] },
  { values: ['Mã tủ', 'Bắt buộc', 'Duy nhất TRONG một site. Vd R01, R02, RNM1.'] },
  {
    values: [
      'Thuộc site',
      'Bắt buộc',
      'Phải khớp một Mã site ở sheet Site (hoặc site đã có trong hệ thống). Hệ thống KHÔNG tự tạo site mới từ đây.',
    ],
  },
  { values: ['Số U', 'Không', 'Chiều cao tủ (số nguyên dương). Bỏ trống nếu không rõ.'] },
  {
    values: [
      'Thiết bị không nằm trong tủ',
      '',
      'PC, máy in, AP treo tường… không cần khai tủ — để trống cột Tủ khi nhập thiết bị.',
    ],
  },
  { values: ['', '', ''] },
  { values: ['Sheet Loại thiết bị', '', ''] },
  {
    values: [
      'Có sẵn 12 loại',
      '',
      'Sửa/xóa/thêm thoải mái. Loại nào công ty không có thì xóa cho gọn danh sách chọn.',
    ],
  },
  {
    values: [
      'Có port map?',
      'Có/Không',
      'Ghi "Có" thì trang chi tiết thiết bị loại đó hiện bảng port map (FR-006). Thường chỉ Switch, Firewall, Server, NAS, UPS cần.',
    ],
  },
  { values: ['', '', ''] },
  { values: ['Sheet Nhà cung cấp', '', ''] },
  {
    values: [
      'Tên nhà cung cấp',
      'Bắt buộc',
      'Ghi đúng tên hay dùng khi liên hệ bảo hành. Trùng tên sẽ được coi là cùng một NCC.',
    ],
  },
  {
    values: [
      'Điện thoại / liên hệ',
      'Không',
      'Có thì lúc thiết bị hỏng khỏi phải đi tìm số.',
    ],
  },
  { values: ['', '', ''] },
  {
    values: [
      'Sau khi điền xong',
      '',
      'Vào Quản trị › Danh mục › Nhập từ Excel, chọn file này. Hệ thống hiện bảng đối chiếu (thêm mới / cập nhật / lỗi) để duyệt TRƯỚC khi ghi.',
    ],
  },
  {
    values: [
      'Import lại lần nữa',
      '',
      'Trùng mã = CẬP NHẬT mục đó, không tạo bản sao. Mục đang có thiết bị dùng thì không xóa được, chỉ ngừng dùng.',
    ],
  },
];

/** Dựng đặc tả sheet cho `ExcelExportService.buildWorkbook`. */
export function catalogTemplateSheets(data: CatalogTemplateData): ExportSheet<TemplateRow>[] {
  const sites = data.sites.length
    ? data.sites.map<TemplateRow>((s) => ({ values: [s.code, s.name, s.address ?? '', ''] }))
    : EXAMPLE_SITES;

  const cabinets = data.cabinets.length
    ? data.cabinets.map<TemplateRow>((c) => ({
        values: [c.code, c.siteCode, c.description ?? '', c.uHeight ?? '', ''],
      }))
    : EXAMPLE_CABINETS;

  const deviceTypes = data.deviceTypes.map<TemplateRow>((t) => ({
    values: [t.name, t.hasPortMap ? 'Có' : 'Không', t.description ?? '', ''],
  }));

  const vendors = data.vendors.length
    ? data.vendors.map<TemplateRow>((v) => ({
        values: [v.name, v.supplies ?? '', v.phone ?? '', v.contact ?? '', ''],
      }))
    : EXAMPLE_VENDORS;

  return [
    sheet('Hướng dẫn', GUIDE_HEADERS, GUIDE_ROWS, { noFilter: true }),
    sheet('Site', SITE_HEADERS, sites),
    sheet('Tủ mạng', CABINET_HEADERS, cabinets),
    sheet('Loại thiết bị', DEVICE_TYPE_HEADERS, deviceTypes),
    sheet('Nhà cung cấp', VENDOR_HEADERS, vendors),
  ];
}

function sheet(
  name: string,
  headers: HeaderSpec[],
  rows: TemplateRow[],
  options: { noFilter?: boolean } = {},
): ExportSheet<TemplateRow> {
  return {
    name,
    noFilter: options.noFilter,
    columns: headers.map(([header, width], index) => ({
      header,
      width,
      value: (row: TemplateRow) => row.values[index] ?? null,
    })),
    rows,
    isExample: (row: TemplateRow) => row.example === true,
  };
}
