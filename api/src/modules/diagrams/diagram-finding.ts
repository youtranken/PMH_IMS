/**
 * Kiểu dùng chung của bộ tự kiểm bản vẽ (AD-18). Tách riêng để luật dây (`diagram-checks.ts`) và
 * bộ tự kiểm khi gửi duyệt/phát hành cùng dùng mà không import vòng.
 */

export type FindingLevel = 'error' | 'warning';

/** Một phát hiện của tự kiểm: `error` chặn gửi duyệt/phát hành, `warning` cho qua. */
export type Finding = {
  level: FindingLevel;
  code: string;
  /** Ô bị phát hiện (id ô draw.io); `null` = cả bản vẽ. */
  cellId: string | null;
  message: string;
};

/**
 * Một dòng sơ đồ cổng như tự kiểm thấy nó (đọc qua `devices.api`). `id` = `ims_link_id` trên nét;
 * đầu A là máy giữ bản ghi. Không phân biệt chiều: dây khai A→B vẽ B→A vẫn đúng.
 */
export type CheckLink = {
  id: string;
  deviceA: string;
  deviceB: string;
  cableTypeId: string | null;
  portA?: string;
  portB?: string | null;
};
