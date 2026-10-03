import type { CellIndex, IndexedCell } from './diagram-cells';
import { checkCables } from './diagram-checks';
import type { CheckLink, Finding } from './diagram-finding';

export type { Finding, FindingLevel } from './diagram-finding';

/**
 * Tự kiểm khi gửi duyệt / duyệt / phát hành (AD-18, Q-23) — hàm THUẦN chạy trên chỉ mục ô + dữ
 * liệu kho đã đọc qua public api, test bảng dữ liệu ở `diagram-selfcheck.spec.ts`.
 *
 * Đỏ chặn, vàng cho qua: bản chính thức không được trỏ vào máy không còn / đã thanh lý, còn những
 * thứ "lệch nhưng có thể cố ý" (máy đặt ở khung tủ khác, dây chưa khai) chỉ để người duyệt thấy.
 */

/** Thông tin một máy mà luật cần — chỉ thứ đọc được qua `devices.api`. */
export interface CheckDevice {
  id: string;
  code: string;
  status: string;
  cabinetId: string | null;
}

export interface CheckInput {
  index: CellIndex;
  devices: Map<string, CheckDevice>;
  /** Dòng sơ đồ cổng theo `ims_link_id` — luật dây đọc (xem `diagram-checks.ts`). */
  links: Map<string, CheckLink>;
}

export interface CheckResult {
  errors: Finding[];
  warnings: Finding[];
}

/** Mã máy ghi trên ô — vẫn đọc được khi máy đã mất khỏi kho. */
function cellCode(cell: IndexedCell): string {
  return cell.ims.ims_device_code || cell.label || cell.id;
}

function inside(inner: IndexedCell, outer: IndexedCell): boolean {
  const a = inner.bounds;
  const b = outer.bounds;
  if (!a || !b || b.width <= 0 || b.height <= 0) return false;
  return a.x >= b.x && a.y >= b.y && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
}

/**
 * Khung tủ chứa ô: tổ tiên gần nhất mang `ims_cabinet_id` (ô con của khung), hoặc khung cùng cha
 * bao trọn ô — người vẽ hay kéo máy đè lên khung mà không thả vào trong nó.
 */
function cabinetFrameOf(cell: IndexedCell, byId: Map<string, IndexedCell>, frames: IndexedCell[]): IndexedCell | null {
  const seen = new Set<string>();
  for (let at = cell.parent ? byId.get(cell.parent) : undefined; at && !seen.has(at.id); at = at.parent ? byId.get(at.parent) : undefined) {
    seen.add(at.id);
    if (at.ims.ims_cabinet_id) return at;
  }
  return frames.find((frame) => frame.parent === cell.parent && inside(cell, frame)) ?? null;
}

/**
 * Luật thiết bị: ĐỎ — `ims_device_id` không còn trong kho, máy đã thanh lý; VÀNG — máy đặt trong
 * khung tủ khác tủ ghi trong kho. Mỗi ô tối đa một lời báo, lời đỏ thắng: chồng thêm vàng cho
 * một máy đã phải gỡ chỉ làm dài danh sách.
 */
export function checkDevices(cells: IndexedCell[], devices: Map<string, CheckDevice>): Finding[] {
  const byId = new Map(cells.map((c) => [c.id, c]));
  const frames = cells.filter((c) => c.kind !== 'edge' && c.ims.ims_cabinet_id);
  const findings: Finding[] = [];
  for (const cell of cells) {
    if (cell.kind !== 'device' || !cell.deviceId) continue;
    const code = cellCode(cell);
    const device = devices.get(cell.deviceId);
    if (!device) {
      findings.push({
        level: 'error',
        code: 'DEVICE_MISSING',
        cellId: cell.id,
        message: `Thiết bị ${code} không còn trong kho — gỡ hình này hoặc thay bằng máy đúng.`,
      });
      continue;
    }
    if (device.status === 'retired') {
      findings.push({
        level: 'error',
        code: 'DEVICE_RETIRED',
        cellId: cell.id,
        message: `Thiết bị ${device.code} đã thanh lý nhưng vẫn nằm trên bản vẽ — gỡ hình này trước khi phát hành.`,
      });
      continue;
    }
    const frame = cabinetFrameOf(cell, byId, frames);
    if (frame && frame.ims.ims_cabinet_id !== device.cabinetId) {
      findings.push({
        level: 'warning',
        code: 'DEVICE_CABINET_MISMATCH',
        cellId: cell.id,
        message: `Thiết bị ${device.code} nằm trong khung "${frame.label || frame.id}" nhưng kho ghi ${device.cabinetId ? 'tủ khác' : 'chưa gắn tủ'}.`,
      });
    }
  }
  return findings;
}

/** Mọi bộ luật, tách đỏ/vàng. Thứ tự: thiết bị trước, dây sau — người sửa đi từ máy ra dây. */
export function runDiagramChecks(input: CheckInput): CheckResult {
  // Trạng thái máy cho luật dây (dây tới máy đã thanh lý) — cùng một lượt đọc kho với luật thiết bị.
  const deviceStatus = new Map([...input.devices.values()].map((d) => [d.id, d.status]));
  const all = [...checkDevices(input.index.cells, input.devices), ...checkCables(input.index.cells, input.links, deviceStatus)];
  return {
    errors: all.filter((f) => f.level === 'error'),
    warnings: all.filter((f) => f.level === 'warning'),
  };
}
