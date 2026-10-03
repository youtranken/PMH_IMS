import type { CellIndex, IndexedCell } from './diagram-cells';
import { checkCables, undrawnLinks } from './diagram-checks';
import type { CheckLink, Finding } from './diagram-finding';
import { linkLabelFrom } from './diagram-hydrate';
import { checkDevices, type CheckDevice } from './diagram-selfcheck';
import type { DeviceSnapshotEntry } from './diagram.schema';

/**
 * Lệch kho của MỘT phiên bản bản vẽ (Q-23 "cảnh báo lệch kho, không ép sửa", AD-18) — hàm THUẦN,
 * test bảng dữ liệu ở `diagram-drift.spec.ts`.
 *
 * Không phải bộ luật thứ hai: máy mất/thanh lý là `checkDevices`, dây gắn kết nối đã gỡ / đổi đầu
 * là `checkCables`, kết nối chưa vẽ là `undrawnLinks` — đúng các hàm tự kiểm và trình xem dùng.
 * Phần riêng ở đây chỉ là những gì cần BẢN CHỤP lúc lưu (`device_snapshot`) để biết "đã đổi từ
 * lúc vẽ": IP, vị trí (site · tủ · U), cổng hai đầu dây, và máy mới vào tủ có khung trên bản vẽ.
 *
 * Chỉ báo, không sửa: kết quả là danh sách `Finding` cho dấu trên ô và hộp "Kiểm tra khớp dữ liệu".
 */

/** Một máy như lệch kho cần — mọi trường đọc qua `devices.api` / `ipam.api`. */
export interface DriftDevice extends CheckDevice {
  ips: string[];
  siteCode: string | null;
  cabinetCode: string | null;
  u: number | null;
}

export interface DriftInput {
  index: CellIndex;
  snapshot: DeviceSnapshotEntry[];
  /** Máy có ô trên bản vẽ, theo kho hiện tại; vắng = không còn trong kho. */
  devices: Map<string, DriftDevice>;
  /** Dòng sơ đồ cổng theo `ims_link_id` của các nét; dòng đã gỡ thì vắng. */
  links: Map<string, CheckLink>;
  /** Mọi dòng sơ đồ cổng chạm máy có trên bản vẽ. */
  touching: CheckLink[];
  /** Máy còn dùng đang gắn từng tủ có khung (`ims_cabinet_id`) trên bản vẽ. */
  cabinetDevices: Map<string, { id: string; code: string }[]>;
}

/** Luật tự kiểm dùng lại cho lệch kho — mấy mã kia (dây chưa khai, hai nét một kết nối…) là việc của người vẽ, không phải kho đổi. */
const SHARED_CODES = ['DEVICE_MISSING', 'DEVICE_RETIRED', 'CABLE_LINK_MISSING', 'CABLE_LINK_ENDS_MISMATCH'] as const;
const OWN_CODES = ['DRIFT_IP', 'DRIFT_LOCATION', 'DRIFT_PORT', 'DRIFT_UNDRAWN_LINK', 'DRIFT_CABINET_NEW_DEVICE'] as const;
export const DRIFT_CODES: readonly string[] = [...SHARED_CODES, ...OWN_CODES];

const NONE = '(không có)';
const UNPLACED = '(chưa gắn)';

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((value, i) => value === sorted[i]);
}

function place(site: string | null | undefined, cabinet: string | null | undefined, u: number | null | undefined): string {
  return [site, cabinet, u !== null && u !== undefined ? `U${u}` : null].filter(Boolean).join(' · ') || UNPLACED;
}

function warning(code: (typeof OWN_CODES)[number], cellId: string, message: string): Finding {
  return { level: 'warning', code, cellId, message };
}

/** IP / vị trí đổi so với bản chụp — mỗi ô của máy một lời báo (người xem thấy dấu ở mọi chỗ máy xuất hiện). */
function deviceDrift(cells: IndexedCell[], snapshot: Map<string, DeviceSnapshotEntry>, devices: Map<string, DriftDevice>): Finding[] {
  const out: Finding[] = [];
  for (const cell of cells) {
    if (cell.kind !== 'device' || !cell.deviceId) continue;
    const then = snapshot.get(cell.deviceId);
    const current = devices.get(cell.deviceId);
    // Máy mất / thanh lý đã có lời đỏ của `checkDevices`; bản chụp thiếu thì không có gì để so.
    if (!then || then.missing || !current || current.status === 'retired') continue;
    const before = then.ips ?? [];
    if (!sameSet(before, current.ips)) {
      out.push(
        warning('DRIFT_IP', cell.id, `Thiết bị ${current.code}: IP ${before.join(', ') || NONE} → ${current.ips.join(', ') || NONE}`),
      );
    }
    const was = place(then.site, then.cabinet, then.u);
    const now = place(current.siteCode, current.cabinetCode, current.u);
    if (was !== now) out.push(warning('DRIFT_LOCATION', cell.id, `Thiết bị ${current.code}: vị trí ${was} → ${now}`));
  }
  return out;
}

/** Cổng hai đầu của nét đã gắn kết nối, so với bản chụp. Bản chụp chưa ghi cổng của dây này thì không đoán. */
function portDrift(cells: IndexedCell[], input: DriftInput, snapshot: Map<string, DeviceSnapshotEntry>): Finding[] {
  const deviceOf = new Map(cells.filter((c) => c.kind === 'device' && c.deviceId).map((c) => [c.id, c]));
  const out: Finding[] = [];
  for (const cell of cells) {
    const linkId = cell.kind === 'edge' ? cell.ims.ims_link_id : undefined;
    const link = linkId ? input.links.get(linkId) : undefined;
    if (!linkId || !link) continue;
    const thenA = snapshot.get(link.deviceA)?.ports?.[linkId];
    const thenB = snapshot.get(link.deviceB)?.ports?.[linkId];
    if (thenA === undefined && thenB === undefined) continue;
    const nowA = link.portA ?? '';
    const nowB = link.portB ?? '';
    if ((thenA ?? nowA) === nowA && (thenB ?? nowB) === nowB) continue;
    const source = cell.source ? (deviceOf.get(cell.source)?.deviceId ?? null) : null;
    const before = { ...link, portA: (thenA ?? nowA) || undefined, portB: (thenB ?? nowB) || null };
    const codeOf = (id: string) => input.devices.get(id)?.code ?? '?';
    const [first, second] = source === link.deviceB ? [link.deviceB, link.deviceA] : [link.deviceA, link.deviceB];
    out.push(
      warning(
        'DRIFT_PORT',
        cell.id,
        `Dây ${codeOf(first)} ↔ ${codeOf(second)}: cổng ${linkLabelFrom(before, source)} → ${linkLabelFrom(link, source)}`,
      ),
    );
  }
  return out;
}

/** Kết nối giữa hai máy cùng trên bản vẽ mà chưa vẽ — dấu ở ô máy giữ bản ghi (đầu A). */
function undrawnDrift(cells: IndexedCell[], input: DriftInput): Finding[] {
  const firstCell = new Map<string, IndexedCell>();
  for (const cell of cells) if (cell.kind === 'device' && cell.deviceId && !firstCell.has(cell.deviceId)) firstCell.set(cell.deviceId, cell);
  const codeOf = (id: string) => input.devices.get(id)?.code ?? firstCell.get(id)?.ims.ims_device_code ?? '?';
  return undrawnLinks(cells, input.touching).map((link) =>
    warning(
      'DRIFT_UNDRAWN_LINK',
      firstCell.get(link.deviceA)!.id,
      `Kết nối ${codeOf(link.deviceA)} ${link.portA ?? '—'} ↔ ${codeOf(link.deviceB)} ${link.portB ?? '—'} có trong sơ đồ cổng nhưng chưa vẽ.`,
    ),
  );
}

/**
 * Máy đang gắn một tủ có khung trên bản vẽ mà không có ô nào — máy gắn vào tủ sau khi vẽ không tự
 * chui vào bản vẽ, nó hiện thành lời báo trên khung tủ.
 */
function cabinetDrift(cells: IndexedCell[], input: DriftInput): Finding[] {
  const present = new Set(cells.filter((c) => c.kind === 'device' && c.deviceId).map((c) => c.deviceId!));
  const out: Finding[] = [];
  for (const frame of cells) {
    const cabinetId = frame.kind !== 'edge' ? frame.ims.ims_cabinet_id : undefined;
    if (!cabinetId) continue;
    for (const device of input.cabinetDevices.get(cabinetId) ?? []) {
      if (present.has(device.id)) continue;
      out.push(
        warning(
          'DRIFT_CABINET_NEW_DEVICE',
          frame.id,
          `Tủ "${frame.label || frame.id}": ${device.code} đã gắn vào tủ trong kho nhưng chưa có trên bản vẽ.`,
        ),
      );
    }
  }
  return out;
}

/** Mọi lệch kho, theo thứ tự người sửa đi: máy → dây → kết nối chưa vẽ → tủ. */
export function checkDrift(input: DriftInput): Finding[] {
  const cells = input.index.cells;
  const snapshot = new Map(input.snapshot.map((entry) => [entry.id, entry]));
  const shared = new Set<string>(SHARED_CODES);
  return [
    ...checkDevices(cells, input.devices).filter((f) => shared.has(f.code)),
    ...deviceDrift(cells, snapshot, input.devices),
    ...checkCables(cells, input.links).filter((f) => shared.has(f.code)),
    ...portDrift(cells, input, snapshot),
    ...undrawnDrift(cells, input),
    ...cabinetDrift(cells, input),
  ];
}
