import {
  cellText,
  isBlankRow,
  isExampleRow,
  normalizeHeader,
  normalizeKey,
  parseBoolean,
  pickCell,
  summarize,
  type ImportAction,
  type ImportSummary,
  type ParsedRow,
  type ParsedSheets,
} from '../../common/import-plan';
import {
  IMPORTABLE_ENTITIES,
  type CatalogSnapshot,
  type ImportableEntity,
} from './catalog.types';

// Kiểu dùng chung của mọi màn import (AD-15) — export lại để nơi gọi chỉ cần một chỗ import.
export type { ImportAction, ImportSummary, ParsedRow, ParsedSheets };

/**
 * Lõi ĐỐI CHIẾU file danh mục — hàm THUẦN, không chạm DB, không chạm exceljs.
 * Tách ra để test bằng bảng dữ liệu (CLAUDE.md: logic thuần phải test table-driven,
 * không test qua HTTP) và để bước xem trước và bước ghi dùng CHUNG một kết quả:
 * xem trước hiện gì thì ghi đúng cái đó.
 */

export interface SiteValues {
  code: string;
  name?: string;
  address?: string | null;
}

export interface CabinetValues {
  code: string;
  /** Mã site đã chuẩn hóa — bước ghi tra ra `site_id` (kể cả site vừa tạo trong cùng file). */
  siteKey: string;
  siteCode: string;
  description?: string | null;
  uHeight?: number | null;
}

export interface DeviceTypeValues {
  name: string;
  hasPortMap?: boolean;
  description?: string | null;
}

export interface VendorValues {
  name: string;
  supplies?: string | null;
  phone?: string | null;
  contact?: string | null;
}

export type CatalogValues =
  | SiteValues
  | CabinetValues
  | DeviceTypeValues
  | VendorValues;

export interface ImportRow {
  sheet: ImportableEntity;
  rowNumber: number;
  action: ImportAction;
  /** Nhãn hiện ở bảng đối chiếu: mã site / "PMH-HO · R01" / tên loại / tên NCC. */
  label: string;
  message?: string;
  values?: CatalogValues;
  /** Có khi action = 'update' | 'unchanged'. */
  existingId?: string;
  /**
   * Chỉ có khi action = 'update': trường nào sẽ bị GHI ĐÈ, từ gì sang gì — người duyệt cần thấy
   * đúng điều này trước khi bấm "Xác nhận ghi". `field` là nhãn cột như trong file mẫu.
   */
  changes?: ImportChange[];
}

export interface ImportChange {
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

export interface ImportPlan {
  rows: ImportRow[];
  summary: ImportSummary;
  /** false = file không có sheet nào tên Site/Tủ mạng/Loại thiết bị/Nhà cung cấp. */
  hasRecognizedSheet: boolean;
}

/** Loại mục → tên sheet đúng như file mẫu (`catalog-template.ts`) — file dòng lỗi in lại tên này. */
export const IMPORT_SHEET_NAME: Record<ImportableEntity, string> = {
  site: 'Site',
  cabinet: 'Tủ mạng',
  device_type: 'Loại thiết bị',
  vendor: 'Nhà cung cấp',
};

/**
 * Tên sheet → loại mục. Chấp nhận cả bản có dấu lẫn không dấu vì người dùng có thể
 * đổi tên sheet khi sao chép file.
 */
const SHEET_ALIASES: Record<string, ImportableEntity> = {
  site: 'site',
  'danh sách site': 'site',
  'tủ mạng': 'cabinet',
  'tu mang': 'cabinet',
  'tủ': 'cabinet',
  cabinet: 'cabinet',
  'loại thiết bị': 'device_type',
  'loai thiet bi': 'device_type',
  'loại': 'device_type',
  'nhà cung cấp': 'vendor',
  'nha cung cap': 'vendor',
  ncc: 'vendor',
  vendor: 'vendor',
};

interface FieldSpec {
  /** Khóa trong `values`. */
  key: string;
  /** Tên cột (đã chuẩn hóa) mà cột này nhận. Cột đầu là tên chính, hiện trong thông báo lỗi. */
  aliases: string[];
  label: string;
  required?: boolean;
  kind?: 'text' | 'boolean' | 'integer';
}

const FIELDS: Record<ImportableEntity, FieldSpec[]> = {
  site: [
    { key: 'code', label: 'Mã site', aliases: ['mã site', 'ma site', 'mã'], required: true },
    { key: 'name', label: 'Tên site', aliases: ['tên site', 'ten site', 'tên'], required: true },
    {
      key: 'address',
      label: 'Địa chỉ',
      aliases: ['địa chỉ / ghi chú', 'địa chỉ', 'dia chi', 'ghi chú'],
    },
  ],
  cabinet: [
    { key: 'code', label: 'Mã tủ', aliases: ['mã tủ', 'ma tu', 'mã'], required: true },
    {
      key: 'siteCode',
      label: 'Thuộc site',
      aliases: ['thuộc site', 'thuoc site', 'site', 'mã site'],
      required: true,
    },
    {
      key: 'description',
      label: 'Mô tả',
      aliases: ['mô tả / vị trí', 'mô tả', 'mo ta', 'vị trí'],
    },
    { key: 'uHeight', label: 'Số U', aliases: ['số u', 'so u', 'u'], kind: 'integer' },
  ],
  device_type: [
    {
      key: 'name',
      label: 'Tên loại',
      aliases: ['tên loại', 'ten loai', 'loại', 'tên loại thiết bị'],
      required: true,
    },
    {
      key: 'hasPortMap',
      label: 'Có port map?',
      aliases: ['có port map?', 'có port map', 'co port map', 'port map'],
      kind: 'boolean',
    },
    { key: 'description', label: 'Mô tả', aliases: ['mô tả', 'mo ta'] },
  ],
  vendor: [
    {
      key: 'name',
      label: 'Tên nhà cung cấp',
      aliases: ['tên nhà cung cấp', 'ten nha cung cap', 'nhà cung cấp', 'tên ncc'],
      required: true,
    },
    { key: 'supplies', label: 'Cung cấp gì', aliases: ['cung cấp gì', 'cung cấp', 'cung cap gi'] },
    { key: 'phone', label: 'Điện thoại', aliases: ['điện thoại', 'dien thoai', 'sđt', 'phone'] },
    {
      key: 'contact',
      label: 'Người liên hệ',
      aliases: ['email / người liên hệ', 'người liên hệ', 'liên hệ', 'email'],
    },
  ],
};

/**
 * Dựng bảng đối chiếu cho toàn bộ file.
 *
 * Thứ tự xử lý CỐ ĐỊNH: site trước tủ mạng, vì tủ tham chiếu tới site và người dùng
 * hoàn toàn có thể khai cả hai trong cùng một file (khai site ở sheet Site rồi dùng
 * ngay ở sheet Tủ mạng phải chạy được).
 */
export function planCatalogImport(
  sheets: ParsedSheets,
  snapshot: CatalogSnapshot,
): ImportPlan {
  const bySheet = new Map<ImportableEntity, ParsedRow[]>();
  for (const [name, rows] of Object.entries(sheets)) {
    const entity = SHEET_ALIASES[normalizeHeader(name)];
    if (!entity) continue;
    bySheet.set(entity, [...(bySheet.get(entity) ?? []), ...rows]);
  }

  const rows: ImportRow[] = [];
  // Khóa đã gặp trong CHÍNH file này — chặn trùng nội bộ và cho tủ dùng site vừa khai.
  const seen: Record<ImportableEntity, Set<string>> = {
    site: new Set(),
    cabinet: new Set(),
    device_type: new Set(),
    vendor: new Set(),
  };

  for (const entity of IMPORTABLE_ENTITIES) {
    for (const row of bySheet.get(entity) ?? []) {
      if (isBlankRow(row.cells)) continue;
      rows.push(planRow(entity, row, snapshot, seen));
    }
  }

  return {
    rows,
    summary: summarize(rows),
    hasRecognizedSheet: bySheet.size > 0,
  };
}

function planRow(
  entity: ImportableEntity,
  row: ParsedRow,
  snapshot: CatalogSnapshot,
  seen: Record<ImportableEntity, Set<string>>,
): ImportRow {
  const base = { sheet: entity, rowNumber: row.rowNumber };

  if (isExampleRow(row.cells)) {
    return {
      ...base,
      action: 'skip',
      label: rawLabel(entity, row.cells),
      message: 'Dòng ví dụ trong file mẫu — bỏ qua.',
    };
  }

  const values: Record<string, string | number | boolean | null> = {};
  for (const field of FIELDS[entity]) {
    const raw = pickCell(row.cells, field.aliases);
    // Cột KHÔNG có trong file = "đừng đụng tới trường này" (giữ giá trị đang có trong DB).
    // Cột có nhưng ô trống = "xóa giá trị". Hai chuyện khác nhau, không gộp làm một.
    if (raw === undefined) continue;
    const text = cellText(raw);

    if (field.required && text === '') {
      return {
        ...base,
        action: 'error',
        label: rawLabel(entity, row.cells),
        message: `Thiếu cột bắt buộc "${field.label}".`,
      };
    }
    if (field.kind === 'integer') {
      if (text === '') {
        values[field.key] = null;
        continue;
      }
      const num = Number(text);
      if (!Number.isInteger(num) || num <= 0) {
        return {
          ...base,
          action: 'error',
          label: rawLabel(entity, row.cells),
          message: `Cột "${field.label}" phải là số nguyên dương (đang là "${text}").`,
        };
      }
      values[field.key] = num;
      continue;
    }
    if (field.kind === 'boolean') {
      values[field.key] = parseBoolean(text);
      continue;
    }
    values[field.key] = text === '' ? null : text;
  }

  // Cột bắt buộc KHÔNG XUẤT HIỆN trong file (không phải để trống) — báo rõ để người dùng
  // biết là dùng nhầm file/sai sheet chứ không phải quên điền một dòng.
  for (const field of FIELDS[entity]) {
    if (field.required && values[field.key] === undefined) {
      return {
        ...base,
        action: 'error',
        label: rawLabel(entity, row.cells),
        message: `File thiếu cột bắt buộc "${field.label}".`,
      };
    }
  }

  if (entity === 'cabinet') {
    return planCabinetRow(base, values, snapshot, seen);
  }

  const keySource = String(entity === 'site' ? values.code : values.name);
  const key = normalizeKey(keySource);
  if (seen[entity].has(key)) {
    return {
      ...base,
      action: 'error',
      label: keySource,
      message: `Giá trị "${keySource}" bị trùng ngay trong file — mỗi mục chỉ khai một dòng.`,
    };
  }
  seen[entity].add(key);

  const existing = existingOf(entity, key, snapshot);
  return decide(base, keySource, values as unknown as CatalogValues, existing);
}

function planCabinetRow(
  base: { sheet: ImportableEntity; rowNumber: number },
  values: Record<string, string | number | boolean | null>,
  snapshot: CatalogSnapshot,
  seen: Record<ImportableEntity, Set<string>>,
): ImportRow {
  const siteCode = String(values.siteCode);
  const siteKey = normalizeKey(siteCode);
  const code = String(values.code);
  const label = `${siteCode} · ${code}`;

  // Site phải có sẵn trong hệ thống HOẶC được khai ở sheet Site của chính file này.
  // Tuyệt đối không tự tạo site ngầm: gõ nhầm mã site mà hệ thống im lặng tạo mới thì
  // hôm sau có hai site "PMH-H0" và "PMH-HO" không ai phân biệt nổi.
  if (!snapshot.sites.has(siteKey) && !seen.site.has(siteKey)) {
    return {
      ...base,
      action: 'error',
      label,
      message: `Không có site nào mã "${siteCode}". Khai site đó ở sheet Site trước, hoặc sửa lại mã.`,
    };
  }

  const key = `${siteKey} ${normalizeKey(code)}`;
  if (seen.cabinet.has(key)) {
    return {
      ...base,
      action: 'error',
      label,
      message: `Tủ "${label}" bị trùng ngay trong file — mỗi tủ chỉ khai một dòng.`,
    };
  }
  seen.cabinet.add(key);

  const cabinetValues: CabinetValues = {
    code,
    siteKey,
    siteCode,
    ...(values.description !== undefined
      ? { description: values.description as string | null }
      : {}),
    ...(values.uHeight !== undefined ? { uHeight: values.uHeight as number | null } : {}),
  };
  return decide(
    base,
    label,
    cabinetValues,
    snapshot.cabinets.get(key) as unknown as ({ id: string } & Record<string, unknown>) | undefined,
  );
}

/** Đã có trong hệ thống chưa → thêm mới / cập nhật / không đổi. */
function decide(
  base: { sheet: ImportableEntity; rowNumber: number },
  label: string,
  values: CatalogValues,
  existing?: { id: string } & Record<string, unknown>,
): ImportRow {
  if (!existing) {
    return { ...base, action: 'create', label, values };
  }
  // Trải ra bản sao để so từng trường: kiểu union của `values` không có index signature.
  const provided: Record<string, unknown> = { ...values };
  const changes: ImportChange[] = [];
  for (const [key, value] of Object.entries(provided)) {
    // Khóa định danh và trường phụ trợ không tính là "thay đổi nội dung".
    if (key === 'siteKey' || key === 'siteCode') continue;
    const current = existing[key];
    const before = (current === undefined || current === null ? null : current) as ImportChange['from'];
    const after = (value === undefined || value === null ? null : value) as ImportChange['to'];
    // citext: "pmh-ho" trong file và "PMH-HO" trong DB là CÙNG một mã, không phải sửa đổi.
    const differs =
      typeof before === 'string' && typeof after === 'string'
        ? normalizeKey(before) !== normalizeKey(after)
        : before !== after;
    if (differs) changes.push({ field: fieldLabel(base.sheet, key), from: before, to: after });
  }
  return {
    ...base,
    action: changes.length > 0 ? 'update' : 'unchanged',
    label,
    values,
    existingId: existing.id,
    ...(changes.length > 0 ? { changes } : {}),
  };
}

/** Nhãn cột của một trường — cùng chữ với câu lỗi "thiếu cột", người dùng đọc thấy khớp file. */
function fieldLabel(entity: ImportableEntity, key: string): string {
  return FIELDS[entity].find((field) => field.key === key)?.label ?? key;
}

function existingOf(
  entity: ImportableEntity,
  key: string,
  snapshot: CatalogSnapshot,
): ({ id: string } & Record<string, unknown>) | undefined {
  const found =
    entity === 'site'
      ? snapshot.sites.get(key)
      : entity === 'device_type'
        ? snapshot.deviceTypes.get(key)
        : entity === 'vendor'
          ? snapshot.vendors.get(key)
          : undefined;
  return found as ({ id: string } & Record<string, unknown>) | undefined;
}

/** Nhãn cho dòng chưa đọc được giá trị hợp lệ — cố lấy ô đầu tiên có chữ. */
function rawLabel(entity: ImportableEntity, cells: Record<string, string>): string {
  const first = FIELDS[entity][0];
  const value = cellText(pickCell(cells, first.aliases));
  if (value) return value;
  const anyValue = Object.values(cells).map(cellText).find((v) => v !== '');
  return anyValue ?? '(dòng trống)';
}

