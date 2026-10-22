import {
  cellText,
  isBlankRow,
  isExampleRow,
  normalizeKey,
  parseDateCell,
  pickCell,
  unreadableFieldError,
  type ParsedRow,
  type ParsedSheets,
} from './import-plan';
import { secretTextMessage } from './no-secret-text';
import { textLooksLikeSecret } from './note-secret';

/**
 * Một cột của file nhập: nhãn = tiêu đề của file Xuất (đọc không dấu, không hoa thường); `max`
 * và `noSecret` lấy đúng ràng buộc của DTO form, để file không rộng luật hơn form.
 * `list` = nhiều giá trị trong một ô, ngăn bằng phẩy / chấm phẩy / xuống dòng (vd IP WAN).
 */
export interface ImportField<K extends string> {
  key: K;
  label: string;
  kind?: 'text' | 'date' | 'list';
  max?: number;
  noSecret?: boolean;
}

/** Ô đọc được: vắng cột = vắng khóa ("đừng đụng tới"); có cột mà trống = '' hoặc [] ("xoá"). */
export type ImportCells<K extends string> = Partial<Record<K, string | string[]>>;

/** Sheet đúng tên (so không dấu, không hoa thường) — `undefined` = file không có. */
export function findSheet(sheets: ParsedSheets, name: string): ParsedRow[] | undefined {
  const key = Object.keys(sheets).find((sheet) => normalizeKey(sheet) === normalizeKey(name));
  return key === undefined ? undefined : sheets[key];
}

/** Dòng nên đọc: bỏ dòng trống và dòng ví dụ của file mẫu. */
export function importableRows(rows: ParsedRow[]): ParsedRow[] {
  return rows.filter((row) => !isBlankRow(row.cells) && !isExampleRow(row.cells));
}

/** Đọc các cột của một dòng; lỗi đầu tiên (nêu tên cột) thì dừng — bảng đối chiếu hiện câu đó. */
export function readImportFields<K extends string>(
  row: ParsedRow,
  fields: ImportField<K>[],
): { cells: ImportCells<K>; error: string | null } {
  const aliases = (field: ImportField<K>) => [normalizeKey(field.label)];
  const unreadable = unreadableFieldError(row, fields.map((field) => ({ label: field.label, aliases: aliases(field) })));
  if (unreadable) return { cells: {}, error: unreadable };
  const cells: ImportCells<K> = {};
  for (const field of fields) {
    const raw = pickCell(row.cells, aliases(field));
    if (raw === undefined) continue;
    const text = cellText(raw);
    if (field.kind === 'date') {
      const date = parseDateCell(text);
      if (!date.ok) return { cells: {}, error: `Cột "${field.label}" không phải ngày có thật (YYYY-MM-DD hoặc dd/mm/yyyy).` };
      cells[field.key] = date.value ?? '';
      continue;
    }
    if (field.max !== undefined && text.length > field.max) {
      return { cells: {}, error: `Cột "${field.label}" dài quá ${field.max} ký tự.` };
    }
    if (field.noSecret && textLooksLikeSecret(text)) {
      // Câu lỗi KHÔNG nhắc lại ô: bảng đối chiếu hiện ra màn hình.
      return { cells: {}, error: secretTextMessage(`Cột "${field.label}"`) };
    }
    cells[field.key] = field.kind === 'list' ? text.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean) : text;
  }
  return { cells, error: null };
}
