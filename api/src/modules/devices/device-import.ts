import {
  cellText,
  isBlankRow,
  isExampleRow,
  normalizeHeader,
  normalizeKey,
  parseDateCell,
  pickCell,
  summarize,
  type ImportAction,
  type ImportSummary,
  type ParsedRow,
  type ParsedSheets,
} from '../../common/import-plan';
import { effectiveOf } from '../../common/merge-effective';
import { cabinetWithoutSiteMessage } from '../catalog/catalog.api';
import type { DeviceStatus } from './devices.types';

/**
 * Lõi ĐỐI CHIẾU file thiết bị (story 2.6) — hàm THUẦN, không chạm DB, không chạm exceljs.
 * Bước xem trước và bước ghi dùng CHUNG kết quả này: duyệt cái gì thì ghi đúng cái đó.
 */

/** Ảnh chụp danh mục để tra id theo mã/tên người dùng gõ (đã chuẩn hóa khóa). */
export interface DeviceImportCatalog {
  sites: Map<string, { id: string; code: string }>;
  /** Khóa: `${siteKey} ${cabinetKey}` — mã tủ chỉ duy nhất trong một site. */
  cabinets: Map<string, { id: string; code: string; siteId: string; siteCode?: string }>;
  deviceTypes: Map<string, { id: string; name: string }>;
  vendors: Map<string, { id: string; name: string }>;
}

export interface ExistingDevice {
  id: string;
  code: string;
  name: string;
  deviceTypeId: string;
  model: string | null;
  serial: string | null;
  siteId: string | null;
  cabinetId: string | null;
  vendorId: string | null;
  assignedTo: string | null;
  department: string | null;
  purchaseDate: string | null;
  warrantyStart: string | null;
  warrantyEnd: string | null;
  status: string;
  note: string | null;
}

export interface DeviceImportContext {
  catalog: DeviceImportCatalog;
  /** Mã thiết bị (đã chuẩn hóa) → bản ghi đang có. */
  devices: Map<string, ExistingDevice>;
}

export interface DeviceImportRow {
  rowNumber: number;
  action: ImportAction;
  /** Mã thiết bị — hiện ở bảng đối chiếu. */
  label: string;
  message?: string;
  values?: Record<string, unknown>;
  existingId?: string;
}

export interface DeviceImportPlan {
  rows: DeviceImportRow[];
  summary: ImportSummary;
  /** false = file không có sheet nào tên "Thiết bị". */
  hasRecognizedSheet: boolean;
}

const SHEET_ALIASES = ['thiết bị', 'thiet bi', 'devices', 'device', 'danh sách thiết bị'];

/** Nhãn trạng thái người dùng gõ → mã trong DB. */
const STATUS_ALIASES: Record<string, DeviceStatus> = {
  'dang dung': 'in_use',
  'đang dùng': 'in_use',
  'in_use': 'in_use',
  'du phong': 'spare',
  'dự phòng': 'spare',
  kho: 'spare',
  spare: 'spare',
  hong: 'broken',
  'hỏng': 'broken',
  broken: 'broken',
  'da thanh ly': 'retired',
  'đã thanh lý': 'retired',
  'thanh ly': 'retired',
  retired: 'retired',
};

interface FieldSpec {
  key: string;
  label: string;
  aliases: string[];
  required?: boolean;
  kind: 'text' | 'date' | 'status' | 'siteCode' | 'cabinetCode' | 'typeName' | 'vendorName';
}

/** Cột của file mẫu thiết bị — khớp FR-001. */
const FIELDS: FieldSpec[] = [
  {
    key: 'code',
    label: 'Mã thiết bị',
    aliases: ['mã thiết bị', 'ma thiet bi', 'mã', 'code'],
    required: true,
    kind: 'text',
  },
  {
    key: 'name',
    label: 'Tên thiết bị',
    aliases: ['tên thiết bị', 'ten thiet bi', 'tên', 'name'],
    required: true,
    kind: 'text',
  },
  {
    key: 'deviceTypeId',
    label: 'Loại',
    aliases: ['loại', 'loai', 'loại thiết bị', 'type'],
    required: true,
    kind: 'typeName',
  },
  { key: 'model', label: 'Model', aliases: ['model'], kind: 'text' },
  { key: 'serial', label: 'Serial', aliases: ['serial', 'số serial'], kind: 'text' },
  { key: 'siteId', label: 'Site', aliases: ['site', 'mã site', 'ma site'], kind: 'siteCode' },
  {
    key: 'cabinetId',
    label: 'Tủ mạng',
    aliases: ['tủ mạng', 'tu mang', 'tủ', 'mã tủ'],
    kind: 'cabinetCode',
  },
  {
    key: 'vendorId',
    label: 'Nhà cung cấp',
    aliases: ['nhà cung cấp', 'nha cung cap', 'ncc'],
    kind: 'vendorName',
  },
  {
    key: 'assignedTo',
    label: 'Người sử dụng',
    aliases: ['người sử dụng', 'nguoi su dung', 'người dùng', 'sử dụng'],
    kind: 'text',
  },
  {
    key: 'department',
    label: 'Bộ phận',
    aliases: ['bộ phận', 'bo phan', 'phòng ban'],
    kind: 'text',
  },
  {
    key: 'purchaseDate',
    label: 'Ngày mua',
    aliases: ['ngày mua', 'ngay mua'],
    kind: 'date',
  },
  {
    key: 'warrantyStart',
    label: 'Bảo hành từ',
    aliases: ['bảo hành từ', 'bao hanh tu', 'bắt đầu bảo hành'],
    kind: 'date',
  },
  {
    key: 'warrantyEnd',
    label: 'Bảo hành đến',
    aliases: ['bảo hành đến', 'bao hanh den', 'hết bảo hành', 'hạn bảo hành'],
    kind: 'date',
  },
  {
    key: 'status',
    label: 'Trạng thái',
    aliases: ['trạng thái', 'trang thai', 'status'],
    kind: 'status',
  },
  { key: 'note', label: 'Ghi chú', aliases: ['ghi chú', 'ghi chu', 'note'], kind: 'text' },
];

export function planDeviceImport(
  sheets: ParsedSheets,
  context: DeviceImportContext,
): DeviceImportPlan {
  const parsed: ParsedRow[] = [];
  let recognized = false;
  for (const [name, rows] of Object.entries(sheets)) {
    if (!SHEET_ALIASES.includes(normalizeHeader(name))) continue;
    recognized = true;
    parsed.push(...rows);
  }

  const rows: DeviceImportRow[] = [];
  const seen = new Set<string>();
  for (const row of parsed) {
    if (isBlankRow(row.cells)) continue;
    rows.push(planRow(row, context, seen));
  }

  return { rows, summary: summarize(rows), hasRecognizedSheet: recognized };
}

function planRow(
  row: ParsedRow,
  context: DeviceImportContext,
  seen: Set<string>,
): DeviceImportRow {
  const base = { rowNumber: row.rowNumber };
  const label = cellText(pickCell(row.cells, FIELDS[0].aliases)) || '(chưa có mã)';

  if (isExampleRow(row.cells)) {
    return { ...base, action: 'skip', label, message: 'Dòng ví dụ trong file mẫu — bỏ qua.' };
  }

  const values: Record<string, unknown> = {};
  // Site phải xử lý TRƯỚC tủ: tủ chỉ duy nhất trong một site nên phải biết site mới tra được.
  let siteKey: string | null = null;

  for (const field of FIELDS) {
    const raw = pickCell(row.cells, field.aliases);
    // Không có cột = "đừng đụng tới trường này"; có cột mà ô trống = "xóa giá trị".
    if (raw === undefined) continue;
    const text = cellText(raw);

    if (field.required && text === '') {
      return { ...base, action: 'error', label, message: `Thiếu cột bắt buộc "${field.label}".` };
    }

    switch (field.kind) {
      case 'text':
        values[field.key] = text === '' ? null : text;
        break;

      case 'date': {
        const parsedDate = parseDateCell(text);
        if (!parsedDate.ok) {
          return {
            ...base,
            action: 'error',
            label,
            message: `Cột "${field.label}" không đọc được ngày "${text}". Ghi kiểu 30/08/2026 hoặc 2026-08-30.`,
          };
        }
        values[field.key] = parsedDate.value;
        break;
      }

      case 'status': {
        if (text === '') {
          // KHÔNG ép về 'in_use': cột có mà ô trống thì để nguyên trạng thái đang có.
          // Ép ở đây là file sửa tay bỏ trống một ô sẽ âm thầm "hồi sinh" thiết bị đã
          // thanh lý và đẩy nó trở lại danh sách nhắc bảo hành (code review Epic 2).
          // Thiết bị mới thì DB tự dùng mặc định 'in_use'.
          break;
        }
        const status = STATUS_ALIASES[normalizeKey(text)];
        if (!status) {
          return {
            ...base,
            action: 'error',
            label,
            message: `Trạng thái "${text}" không hợp lệ. Dùng: Đang dùng, Dự phòng, Hỏng, Đã thanh lý.`,
          };
        }
        values.status = status;
        break;
      }

      case 'typeName': {
        const type = context.catalog.deviceTypes.get(normalizeKey(text));
        if (!type) {
          return {
            ...base,
            action: 'error',
            label,
            // KHÔNG tự tạo loại mới (AC 2.6): gõ sai một chữ mà hệ thống tạo im lặng thì
            // hôm sau danh sách loại có cả "Switch" lẫn "Swich".
            message: `Không có loại thiết bị "${text}". Thêm loại đó ở màn Danh mục trước, hoặc sửa lại cho khớp.`,
          };
        }
        values.deviceTypeId = type.id;
        break;
      }

      case 'siteCode': {
        if (text === '') {
          values.siteId = null;
          break;
        }
        const site = context.catalog.sites.get(normalizeKey(text));
        if (!site) {
          return {
            ...base,
            action: 'error',
            label,
            message: `Không có site mã "${text}". Khai site ở màn Danh mục trước.`,
          };
        }
        values.siteId = site.id;
        siteKey = normalizeKey(text);
        break;
      }

      case 'cabinetCode': {
        if (text === '') {
          values.cabinetId = null;
          break;
        }
        if (!siteKey) {
          return {
            ...base,
            action: 'error',
            label,
            message: `Có tủ "${text}" nhưng chưa ghi Site. Mã tủ chỉ duy nhất trong một site nên phải có cả hai.`,
          };
        }
        const cabinet = context.catalog.cabinets.get(`${siteKey} ${normalizeKey(text)}`);
        if (!cabinet) {
          return {
            ...base,
            action: 'error',
            label,
            message: `Site này không có tủ mã "${text}". Khai tủ ở màn Danh mục trước.`,
          };
        }
        values.cabinetId = cabinet.id;
        break;
      }

      case 'vendorName': {
        if (text === '') {
          values.vendorId = null;
          break;
        }
        const vendor = context.catalog.vendors.get(normalizeKey(text));
        if (!vendor) {
          return {
            ...base,
            action: 'error',
            label,
            message: `Không có nhà cung cấp "${text}". Khai NCC ở màn Danh mục trước.`,
          };
        }
        values.vendorId = vendor.id;
        break;
      }
    }
  }

  for (const field of FIELDS) {
    if (field.required && values[field.key] === undefined) {
      return {
        ...base,
        action: 'error',
        label,
        message: `File thiếu cột bắt buộc "${field.label}".`,
      };
    }
  }

  const key = normalizeKey(String(values.code));
  if (seen.has(key)) {
    return {
      ...base,
      action: 'error',
      label,
      message: `Mã "${String(values.code)}" bị trùng ngay trong file — mỗi thiết bị chỉ khai một dòng.`,
    };
  }
  seen.add(key);

  const existing = context.devices.get(key);

  /*
   * Kiểm tra phải chạy trên GIÁ TRỊ SAU KHI GHÉP với hồ sơ đang có, không chỉ trên các ô
   * có mặt trong file. File chỉ có cột Site (không có cột Tủ) mà đổi sang site khác thì
   * thiết bị sẽ mang tủ của site cũ — form nhập chặn chuyện này, import cũng phải chặn.
   * Cùng lẽ đó với cặp ngày bảo hành: file chỉ sửa một đầu vẫn có thể thành khoảng ngược.
   * (Trước đây hai lỗi này lọt xuống DB: một cái sai lặng lẽ, một cái bung 500 không rõ dòng.)
   *
   * Phép ghép chuyển sang `common/merge-effective.ts` ngày 20/09: ba service HTTP viết sau
   * file này đều dùng `??` và đều sai theo cùng một kiểu (A-03). Một bản đúng nằm riêng
   * trong một module thì bản thứ hai sẽ được viết lại từ đầu — và viết sai.
   */
  const effective = effectiveOf(values);

  const siteId = effective<string | null>('siteId', existing?.siteId ?? null);
  const cabinetId = effective<string | null>('cabinetId', existing?.cabinetId ?? null);
  if (cabinetId) {
    const cabinet = [...context.catalog.cabinets.values()].find(
      (item) => item.id === cabinetId,
    );
    if (!cabinet) {
      return { ...base, action: 'error', label, message: 'Tủ mạng không còn tồn tại.' };
    }
    if (!siteId) {
      return {
        ...base,
        action: 'error',
        label,
        // MỘT bản chữ cho cả cửa Excel lẫn cửa HTTP (AD-15) — xem `cabinetWithoutSiteMessage`.
        message: cabinetWithoutSiteMessage(cabinet.code),
      };
    }
    if (cabinet.siteId !== siteId) {
      return {
        ...base,
        action: 'error',
        label,
        message: `Tủ "${cabinet.code}" không thuộc site đã ghi. Sửa cột Site hoặc cột Tủ mạng cho khớp nhau.`,
      };
    }
  }

  const start = effective<string | null>('warrantyStart', existing?.warrantyStart ?? null);
  const end = effective<string | null>('warrantyEnd', existing?.warrantyEnd ?? null);
  if (start && end && end < start) {
    return {
      ...base,
      action: 'error',
      label,
      message: `Bảo hành đến (${end}) sớm hơn Bảo hành từ (${start}) — kiểm lại hai cột ngày.`,
    };
  }

  if (!existing) {
    /*
     * Tạo MỚI một máy đã ở trạng thái "đã thanh lý" thì hợp lệ: nạp kho lịch sử lần đầu là
     * việc thật, và một bản ghi vừa sinh ra thì chưa giữ IP/NAT/ghế license nào để mà dọn.
     */
    return { ...base, action: 'create', label, values };
  }

  const changed = Object.entries(values).some(([field, value]) => {
    const before = (existing as unknown as Record<string, unknown>)[field] ?? null;
    const after = value ?? null;
    if (field === 'code' && typeof before === 'string' && typeof after === 'string') {
      // citext: "sw-core-01" và "SW-CORE-01" là CÙNG một mã, không phải sửa đổi.
      return normalizeKey(before) !== normalizeKey(after);
    }
    return before !== after;
  });

  /*
   * Dòng KHÔNG đổi gì thì cho qua, kể cả khi hồ sơ đã thanh lý.
   *
   * Bản đầu của tôi chặn ngay khi thấy `existing.status === 'retired'`, trước cả khi biết
   * dòng đó có đổi gì không. Hệ quả: tải lại nguyên file kiểm kê — việc bình thường nhất của
   * import — biến MỌI máy đã thanh lý thành dòng lỗi, và vì `commit` từ chối cả file khi còn
   * lỗi, cả lượt nhập 300 dòng đứng im. Đúng chế độ hỏng tôi đã gây ra ở đợt C: hàng rào chặn
   * luôn việc hợp lệ. Bài kiểm đơn vị "ô Trạng thái để trống" bắt được, và nó đúng.
   */
  if (!changed) {
    return { ...base, action: 'unchanged', label, values, existingId: existing.id };
  }

  /*
   * HAI HÀNG RÀO CHO ĐƯỜNG IMPORT — cả hai đều là cửa sau của cùng một quyết định.
   *
   * 1. Hồ sơ ĐÃ THANH LÝ thì khóa, y như nút Sửa trên web. Import là đường ghi hàng loạt nên
   *    nó là chỗ dễ vô tình cán qua nhất.
   *
   * 2. Không được ĐỔI SANG "đã thanh lý" bằng một ô Excel. Thanh lý là một CHỐT (xem
   *    `devices.service.setStatus`): nó hỏi máy còn giữ IP · rule NAT · ghế license nào,
   *    chặn nếu còn, và chỉ dọn khi người dùng nói ra. `updateWithin` mà import gọi đi vòng
   *    qua trọn vẹn cái chốt đó — hàng rào chặn ở màn hình, còn Excel thì mở cửa sau.
   *
   * Báo ở tầng ĐỐI CHIẾU chứ không để `commit` ném: cả file là một transaction (AC 2.6), nên
   * một lỗi lúc ghi sẽ giết cả 300 dòng mà không nói dòng nào hỏng.
   */
  if (existing.status === 'retired') {
    return {
      ...base,
      action: 'error',
      label,
      message: `Thiết bị ${existing.code} đã thanh lý — hồ sơ khóa lại, import không sửa được. Mở lại hồ sơ trong Kho thanh lý trước nếu thanh lý nhầm.`,
    };
  }
  if (values.status === 'retired') {
    return {
      ...base,
      action: 'error',
      label,
      message: `Không thanh lý được bằng Excel: thanh lý phải đi qua nút "Thanh lý" để hệ thống còn hỏi thiết bị ${existing.code} có đang giữ IP, luật NAT hay ghế license nào không.`,
    };
  }

  return { ...base, action: 'update', label, values, existingId: existing.id };
}
