/**
 * Kiểu dùng chung của tự kiểm (AD-18): khung (`diagram-selfcheck.ts`) và bộ luật dây
 * (`diagram-checks.ts`) cùng đọc file này, để hai bên không import lẫn nhau thành vòng.
 */

export type FindingLevel = 'error' | 'warning';

export interface Finding {
  level: FindingLevel;
  /** Mã máy đọc được (web chọn câu theo mã, test so mã thay vì so chữ). */
  code: string;
  /** Ô bị nêu — web bay tới ô đó; `null` = cả bản vẽ. */
  cellId: string | null;
  message: string;
}

/**
 * Một dòng sơ đồ cổng mà luật dây cần, đọc qua `devices.api` theo `ims_link_id`. `diagrams` chỉ
 * ĐỌC — không ghi `device_port`.
 */
export interface CheckLink {
  id: string;
  deviceA: string;
  deviceB: string;
  cableTypeId: string | null;
}
