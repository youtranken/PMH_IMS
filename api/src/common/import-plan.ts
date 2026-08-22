/**
 * Nền chung cho MỌI màn import Excel của IMS (AD-15).
 *
 * Import danh mục (2.1) và import thiết bị (2.6) — và sau này import license, IP — đều theo
 * một luật: đọc ô kiểu gì, khớp tiêu đề cột ra sao, dòng ví dụ nhận biết thế nào, tổng kết
 * ra sao. Mỗi màn tự viết một bộ thì cùng một file lại "hợp lệ ở màn này, sai ở màn kia".
 *
 * Toàn bộ file này là HÀM THUẦN — không chạm DB, không chạm exceljs — nên test được bằng
 * bảng dữ liệu (CLAUDE.md).
 */

export type ImportAction = 'create' | 'update' | 'unchanged' | 'skip' | 'error';

export interface ImportSummary {
  create: number;
  update: number;
  unchanged: number;
  skip: number;
  error: number;
}

export interface ParsedRow {
  /** Số dòng THẬT trong sheet Excel (dòng 1 là tiêu đề) — để người dùng mở file sửa đúng dòng. */
  rowNumber: number;
  cells: Record<string, string>;
}

export type ParsedSheets = Record<string, ParsedRow[]>;

/** Kết quả đọc một ô ngày: đọc được (kèm giá trị, `null` = ô trống) hay không đọc được. */
export type DateCell = { ok: true; value: string | null } | { ok: false };

/** Cột đánh dấu dòng minh họa trong file mẫu. */
export const EXAMPLE_HEADERS = ['ghi chú nhập', 'ghi chu nhap'];

/**
 * Bỏ dấu tiếng Việt — CHỈ dùng để so tên cột/nhãn, KHÔNG dùng cho dữ liệu lưu xuống DB.
 * Dải dấu phụ Unicode viết bằng escape, không viết ký tự tổ hợp trần trong mã nguồn.
 */
export function stripDiacritics(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Tên cột: bỏ dấu `*`, gộp khoảng trắng, về chữ thường. "Mã site *" = "mã site". */
export function normalizeHeader(header: string): string {
  return header.replace(/\*/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Khóa đối chiếu: bỏ khoảng trắng thừa, gộp khoảng trắng giữa, về chữ thường.
 * Dùng CHUNG cho mọi bộ import — hai chỗ so khác nhau thì file đúng ở màn này lại
 * báo "không tìm thấy" ở màn kia.
 */
export function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Lấy ô theo danh sách tên cột chấp nhận được (có dấu hoặc không dấu đều khớp). */
export function pickCell(
  cells: Record<string, string>,
  aliases: string[],
): string | undefined {
  for (const [rawHeader, value] of Object.entries(cells)) {
    const header = normalizeHeader(rawHeader);
    const bare = stripDiacritics(header);
    if (aliases.some((alias) => alias === header || stripDiacritics(alias) === bare)) {
      return value;
    }
  }
  return undefined;
}

export function cellText(raw: string | undefined): string {
  return (raw ?? '').trim();
}

export function isBlankRow(cells: Record<string, string>): boolean {
  return Object.values(cells).every((value) => cellText(value) === '');
}

export function isExampleRow(cells: Record<string, string>): boolean {
  const marker = pickCell(cells, EXAMPLE_HEADERS);
  if (marker === undefined) return false;
  return stripDiacritics(marker.toLowerCase()).includes('vi du');
}

/** "Có"/"x"/"yes"/"1" → true; còn lại false. */
export function parseBoolean(raw: string): boolean {
  const value = stripDiacritics(raw.trim().toLowerCase());
  return ['co', 'x', 'yes', 'y', 'true', '1', 'v'].includes(value);
}

/**
 * Ngày trong file người Việt điền: chấp nhận `2026-08-30`, `30/08/2026`, `30-8-2026`.
 * Kết quả là kiểu phân nhánh: `{ok:true, value}` (value `null` = ô trống) hoặc `{ok:false}`.
 * Không dùng chuỗi `'invalid'` làm cờ vì nó chìm nghỉm trong kiểu `string`, TypeScript
 * không giúp được gì và nơi gọi rất dễ quên kiểm.
 *
 * Vì sao nhận cả dd/mm/yyyy: đó là cách cả công ty gõ ngày. Chỉ nhận ISO thì mỗi lần
 * import lại một loạt dòng đỏ vì "ngày sai định dạng" trong khi ngày hoàn toàn đúng.
 * KHÔNG nhận mm/dd/yyyy — 03/04 mà đoán sai tháng thì sai lặng lẽ, tệ hơn báo lỗi.
 */
export function parseDateCell(raw: string | undefined): DateCell {
  const text = cellText(raw);
  if (text === '') return { ok: true, value: null };

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const vn = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (vn) return buildDate(Number(vn[3]), Number(vn[2]), Number(vn[1]));

  return { ok: false };
}

function buildDate(year: number, month: number, day: number): DateCell {
  if (month < 1 || month > 12 || day < 1 || day > 31) return { ok: false };
  const date = new Date(Date.UTC(year, month - 1, day));
  // Chặn 31/02: Date tự "cuộn" sang tháng sau, so lại mới biết ngày không có thật.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { ok: false };
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { ok: true, value };
}

export function summarize(rows: { action: ImportAction }[]): ImportSummary {
  const summary: ImportSummary = { create: 0, update: 0, unchanged: 0, skip: 0, error: 0 };
  for (const row of rows) summary[row.action] += 1;
  return summary;
}
