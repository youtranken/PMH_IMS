import type { CellIndex } from './diagram-cells';

/**
 * Khung mang dữ liệu (AD-18): khung bản vẽ con (`ims_child_diagram_id`), khung VLAN
 * (`ims_subnet_id`), khung tủ (`ims_cabinet_id`) — hàm THUẦN, test bảng dữ liệu ở
 * `diagram-frames.spec.ts`. Khung là hình của draw.io; IMS chỉ đọc ba thuộc tính trên nó.
 */

export interface FrameRef {
  cellId: string;
  label: string;
  childDiagramId: string | null;
  subnetId: string | null;
  cabinetId: string | null;
}

/** Ô (không phải nét) mang ít nhất một thuộc tính khung khác rỗng. */
export function frameRefs(index: CellIndex): FrameRef[] {
  const out: FrameRef[] = [];
  for (const cell of index.cells) {
    if (cell.kind === 'edge') continue;
    const childDiagramId = cell.ims.ims_child_diagram_id || null;
    const subnetId = cell.ims.ims_subnet_id || null;
    const cabinetId = cell.ims.ims_cabinet_id || null;
    if (!childDiagramId && !subnetId && !cabinetId) continue;
    out.push({ cellId: cell.id, label: cell.label, childDiagramId, subnetId, cabinetId });
  }
  return out;
}

export interface IntroducedRefs {
  childDiagramIds: string[];
  subnetIds: string[];
  cabinetIds: string[];
}

/**
 * Id khung có ở bản mới mà KHÔNG có ở bất kỳ khung nào của bản trước. Lưu chỉ kiểm những id này:
 * bản vẽ con bị lưu trữ SAU khi gắn (hay dải bị ngừng dùng) không được làm bản vẽ cha hết lưu được
 * — khung đó hiện dấu ở chế độ xem, không chặn người đang sửa chỗ khác.
 */
export function introducedRefs(prev: CellIndex | null, next: CellIndex): IntroducedRefs {
  const before = prev ? frameRefs(prev) : [];
  const after = frameRefs(next);
  const fresh = (pick: (ref: FrameRef) => string | null): string[] => {
    const old = new Set(before.map(pick).filter((v): v is string => Boolean(v)));
    return [...new Set(after.map(pick).filter((v): v is string => Boolean(v) && !old.has(v as string)))];
  };
  return {
    childDiagramIds: fresh((r) => r.childDiagramId),
    subnetIds: fresh((r) => r.subnetId),
    cabinetIds: fresh((r) => r.cabinetId),
  };
}

/** Bản vẽ được chọn làm bản vẽ con, như cây thấy nó. `inBranch` = nằm dưới bản vẽ đang lưu. */
export interface ChildCandidate {
  id: string;
  name: string;
  archived: boolean;
  kind: 'official' | 'presentation';
  inBranch: boolean;
}

/**
 * Lý do từ chối một bản vẽ con, `null` = nhận. Chỉ bản vẽ nằm DƯỚI bản vẽ đang lưu trên cây: thanh
 * đường dẫn "Tổng > Tower > Tầng 3" đi lên theo cây, nên khung trỏ sang nhánh khác thì bấm xuống
 * một đằng, bấm lên một nẻo. Bản trình bày không phải bản vẽ của hạ tầng thật.
 */
export function childLinkReason(childId: string, candidate: ChildCandidate | undefined): string | null {
  if (!candidate) return `Bản vẽ con (${childId}) không tồn tại.`;
  if (candidate.archived) return `Bản vẽ con "${candidate.name}" đã lưu trữ — không gắn được.`;
  if (candidate.kind === 'presentation') return `"${candidate.name}" là bản trình bày — khung chỉ gắn được bản vẽ hạ tầng.`;
  if (!candidate.inBranch) return `"${candidate.name}" không nằm dưới bản vẽ này trên cây — chỉ gắn được bản vẽ nằm dưới bản vẽ này.`;
  return null;
}

/* ------------------------------------------------------------------ khung tủ --- */

/**
 * Số đo hình "Numbered Rack Cabinet" của thư viện rack draw.io (`mxgraph.rackGeneral.rackCabinet3`):
 * lề trong khớp phần khung vẽ của hình, `rackUnitSize` là chiều cao một U. Đổi một số ở đây mà
 * không đổi style thì máy lệch khỏi vạch U của hình.
 */
export const RACK_UNIT_PX = 14.8;
export const RACK_WIDTH = 204;
export const RACK_MARGIN = { left: 33, right: 9, top: 21, bottom: 22 } as const;
/** Tủ chưa khai số U ở Danh mục: dựng cỡ tủ 42U thông dụng, người vẽ kéo lại được. */
export const RACK_DEFAULT_U = 42;

/*
 * `numDisp=descend`: U1 ở đáy tủ như tủ thật. `childLayout=rack` để draw.io bắt máy kéo vào tủ
 * theo vạch U. Không màu nào ở đây — màu hình theo mặc định của draw.io / theme người vẽ.
 */
const RACK_STYLE =
  `shape=mxgraph.rackGeneral.rackCabinet3;rackUnitSize=${RACK_UNIT_PX};container=1;collapsible=0;childLayout=rack;allowGaps=1;` +
  `marginLeft=${RACK_MARGIN.left};marginRight=${RACK_MARGIN.right};marginTop=${RACK_MARGIN.top};marginBottom=${RACK_MARGIN.bottom};` +
  'numDisp=descend;verticalLabelPosition=bottom;verticalAlign=top;outlineConnect=0;html=0;';

/** Cột "Chưa khai U": khoảng cách giữa hai máy chừa chỗ cho nhãn 3 dòng nằm dưới hình. */
const COLUMN_GAP = 30;
const COLUMN_HEADER = 26;
const COLUMN_PAD = 12;
const COLUMN_LABEL_ROOM = 48;
const COLUMN_MIN_WIDTH = 160;

/*
 * `stackLayout` + `resizeParent=1`: máy kéo thêm vào cột thì draw.io tự xếp dưới máy cuối và nới
 * cột ra — khung lớn theo máy mà không ai phải dựng lại.
 */
function columnStyle(marginLeft: number): string {
  return (
    `swimlane;container=1;collapsible=0;startSize=${COLUMN_HEADER};childLayout=stackLayout;horizontalStack=0;` +
    `resizeParent=1;resizeParentMax=0;stackSpacing=${COLUMN_GAP + COLUMN_LABEL_ROOM};` +
    `marginLeft=${marginLeft};marginTop=${COLUMN_PAD};marginBottom=${COLUMN_LABEL_ROOM};html=0;`
  );
}

export interface CabinetFrameDevice {
  id: string;
  code: string;
  /** U thấp nhất máy chiếm (U1 = đáy tủ); `null` = kho chưa khai U. */
  u: number | null;
  /** Số U máy chiếm; `null` = 1. */
  uSize: number | null;
  /** Ô dựng sẵn theo loại (cùng luật hydrate với hộp "Thiết bị kho"). */
  cell: { style: string; label: string; width: number; height: number };
}

export interface CabinetFrameInput {
  cabinet: { id: string; code: string; uHeight: number | null };
  devices: CabinetFrameDevice[];
}

/** Một khung của khung tủ; toạ độ tương đối so với góc trên trái của cả cụm. */
export interface FrameCellSpec {
  key: 'rack' | 'unplaced';
  label: string;
  style: string;
  attrs: Record<string, string>;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Một máy trong khung; toạ độ tương đối so với khung chứa nó (`frame`) — ô con của khung. */
export interface FrameDeviceSpec {
  frame: 'rack' | 'unplaced';
  id: string;
  code: string;
  style: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CabinetFrameLayout {
  uHeight: number;
  frames: FrameCellSpec[];
  devices: FrameDeviceSpec[];
}

/**
 * Khung tủ chèn MỘT lượt: hình rack cao theo `cabinet.u_height`, máy có U xếp đúng U, máy chưa
 * khai U (hoặc U vượt tủ / trùng U máy khác) ở cột "Chưa khai U" bên phải. Cả hai khung mang
 * `ims_cabinet_id` và máy là ô CON của khung — luật "máy trong khung tủ khác tủ trong kho" của tự
 * kiểm nhận ra cả hai chỗ.
 */
export function cabinetFrameLayout(input: CabinetFrameInput): CabinetFrameLayout {
  const uHeight = input.cabinet.uHeight && input.cabinet.uHeight > 0 ? input.cabinet.uHeight : RACK_DEFAULT_U;
  const attrs = { ims_cabinet_id: input.cabinet.id };
  const rack: FrameCellSpec = {
    key: 'rack',
    label: `Tủ ${input.cabinet.code}`,
    style: RACK_STYLE,
    attrs,
    x: 0,
    y: 0,
    width: RACK_WIDTH,
    height: RACK_MARGIN.top + RACK_MARGIN.bottom + uHeight * RACK_UNIT_PX,
  };
  const sorted = [...input.devices].sort((a, b) => a.code.localeCompare(b.code, 'vi'));
  const taken = new Set<number>();
  const placed = new Map<string, FrameDeviceSpec>();
  const unplaced: CabinetFrameDevice[] = [];
  const innerWidth = RACK_WIDTH - RACK_MARGIN.left - RACK_MARGIN.right;
  for (const device of sorted) {
    const size = device.uSize && device.uSize > 0 ? device.uSize : 1;
    const units = device.u === null ? [] : Array.from({ length: size }, (_, i) => device.u! + i);
    const fits = units.length > 0 && units[0] >= 1 && units[units.length - 1] <= uHeight && units.every((u) => !taken.has(u));
    if (!fits) {
      unplaced.push(device);
      continue;
    }
    units.forEach((u) => taken.add(u));
    const top = uHeight - units[units.length - 1];
    placed.set(device.id, {
      frame: 'rack',
      id: device.id,
      code: device.code,
      style: device.cell.style,
      label: device.cell.label,
      x: RACK_MARGIN.left,
      y: RACK_MARGIN.top + top * RACK_UNIT_PX,
      width: innerWidth,
      height: size * RACK_UNIT_PX,
    });
  }

  const frames: FrameCellSpec[] = [rack];
  if (unplaced.length > 0) {
    const widest = Math.max(...unplaced.map((d) => d.cell.width));
    const width = Math.max(COLUMN_MIN_WIDTH, widest + 2 * COLUMN_PAD);
    const marginLeft = Math.round((width - widest) / 2);
    let y = COLUMN_HEADER + COLUMN_PAD;
    for (const device of unplaced) {
      placed.set(device.id, {
        frame: 'unplaced',
        id: device.id,
        code: device.code,
        style: device.cell.style,
        label: device.cell.label,
        x: marginLeft,
        y,
        width: device.cell.width,
        height: device.cell.height,
      });
      y += device.cell.height + COLUMN_GAP + COLUMN_LABEL_ROOM;
    }
    frames.push({
      key: 'unplaced',
      label: `Tủ ${input.cabinet.code} · Chưa khai U`,
      style: columnStyle(marginLeft),
      attrs,
      x: RACK_WIDTH + 40,
      y: 0,
      width,
      height: y - COLUMN_GAP,
    });
  }
  return { uHeight, frames, devices: sorted.map((d) => placed.get(d.id)!) };
}
