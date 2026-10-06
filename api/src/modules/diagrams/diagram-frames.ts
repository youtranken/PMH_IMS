import { SaxesParser, type SaxesTagPlain } from 'saxes';
import { escapeXmlAttr } from '../../common/svg-sanitize';
import type { CellIndex } from './diagram-cells';
import { rackDeviceStyle } from './diagram-hydrate';

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

const FRAME_ATTRS = {
  ims_child_diagram_id: 'childDiagramIds',
  ims_subnet_id: 'subnetIds',
  ims_cabinet_id: 'cabinetIds',
} as const satisfies Record<string, keyof IntroducedRefs>;

/**
 * Gỡ thuộc tính gắn khỏi những khung trỏ vào id trong `drop`; hình, chữ, vị trí giữ nguyên. Khớp
 * theo dạng ` tên="giá trị"` có dấu nháy thật: trong giá trị của một thuộc tính khác (nhãn), dấu
 * nháy luôn bị thoát thành `&quot;`, nên không bao giờ đụng nhầm chữ người vẽ gõ.
 */
export function unbindFrames(xml: string, drop: IntroducedRefs): string {
  const sets = {
    childDiagramIds: new Set(drop.childDiagramIds),
    subnetIds: new Set(drop.subnetIds),
    cabinetIds: new Set(drop.cabinetIds),
  };
  if (sets.childDiagramIds.size + sets.subnetIds.size + sets.cabinetIds.size === 0) return xml;
  return xml.replace(/\s(ims_child_diagram_id|ims_subnet_id|ims_cabinet_id)="([^"]*)"/g, (whole, name: keyof typeof FRAME_ATTRS, value: string) =>
    sets[FRAME_ATTRS[name]].has(decodeAttr(value)) ? '' : whole,
  );
}

/** `drop` mang id như chỉ mục đọc ra (đã giải thực thể); giá trị thô trong XML thì chưa. */
function decodeAttr(raw: string): string {
  return raw.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_m, dec: string, hex: string, name: string) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[name.toLowerCase()];
  });
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
  /** Style ảnh thật mặt trước (cùng luật hydrate); vắng thì dùng biểu tượng `cell`. */
  front?: { style: string };
  /** Nhãn một dòng khi máy nằm trên mặt tủ (cùng luật hydrate); vắng thì dùng `cell.label`. */
  rackLabel?: string;
}

export interface CabinetFrameInput {
  cabinet: { id: string; code: string; uHeight: number | null };
  devices: CabinetFrameDevice[];
}

/** Khung của khung tủ: mặt trước (`rack`) và cột "Chưa khai U". */
export type FrameKey = 'rack' | 'unplaced';

/** Một khung của khung tủ; toạ độ tương đối so với góc trên trái của cả cụm. */
export interface FrameCellSpec {
  key: FrameKey;
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
  frame: FrameKey;
  id: string;
  code: string;
  style: string;
  label: string;
  /** Thuộc tính thêm của ô máy — `ims_photo` khi ô hiện ảnh thật của mặt đó (AD-18). */
  attrs: Record<string, string>;
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
 * Khoảng cách giữa mặt tủ và cột "Chưa khai U": nhãn máy trên mặt tủ nằm bên PHẢI (một dòng
 * mã · IP), nên phải chừa chỗ cho nó — không thì nhãn đè lên cột.
 */
const FRAME_GAP = 200;

/**
 * Cột "Chưa khai U" cho một máy rộng `deviceWidth` — màn sửa dựng cột này khi người vẽ Hủy hộp
 * khai U mà trang chưa có cột của tủ (Q-23 06/10 D). Cùng style với cột của `cabinetFrameLayout`
 * để hai đường ra cùng một hình.
 */
export function unplacedColumnSpec(deviceWidth: number): { style: string; width: number; top: number; bottom: number; gap: number } {
  const width = Math.max(COLUMN_MIN_WIDTH, deviceWidth + 2 * COLUMN_PAD);
  return { style: columnStyle(Math.round((width - deviceWidth) / 2)), width, top: COLUMN_HEADER + COLUMN_PAD, bottom: COLUMN_LABEL_ROOM, gap: FRAME_GAP };
}

/** Ô máy: ảnh thật mặt trước nếu có (kèm `ims_photo`), không thì biểu tượng loại. */
function faceOf(device: CabinetFrameDevice): { style: string; attrs: Record<string, string> } {
  return device.front ? { style: device.front.style, attrs: { ims_photo: 'front' } } : { style: device.cell.style, attrs: {} };
}

/** Ô máy trên mặt tủ: nhãn bên phải (cao đúng số U — nhãn dưới hình đè U khác). */
function rackFace(device: CabinetFrameDevice): { style: string; attrs: Record<string, string> } {
  const face = faceOf(device);
  return { ...face, style: rackDeviceStyle(face.style) };
}

/**
 * Khung tủ chèn MỘT lượt: hình rack (mặt trước — Q-23 06/10 chỉ vẽ mặt trước) cao theo
 * `cabinet.u_height`, máy có U xếp đúng U, máy chưa khai U (hoặc U vượt tủ / trùng U máy khác — dữ
 * liệu cũ) ở cột "Chưa khai U" bên phải. Mọi khung mang `ims_cabinet_id` và máy là ô CON của khung —
 * luật "máy trong khung tủ khác tủ trong kho" của tự kiểm nhận ra mọi chỗ.
 */
export function cabinetFrameLayout(input: CabinetFrameInput): CabinetFrameLayout {
  const uHeight = input.cabinet.uHeight && input.cabinet.uHeight > 0 ? input.cabinet.uHeight : RACK_DEFAULT_U;
  const attrs = { ims_cabinet_id: input.cabinet.id };
  const rackHeight = RACK_MARGIN.top + RACK_MARGIN.bottom + uHeight * RACK_UNIT_PX;
  const rack: FrameCellSpec = { key: 'rack', label: `Tủ ${input.cabinet.code}`, style: RACK_STYLE, attrs, x: 0, y: 0, width: RACK_WIDTH, height: rackHeight };
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
      ...rackFace(device),
      label: device.rackLabel ?? device.cell.label,
      x: RACK_MARGIN.left,
      y: RACK_MARGIN.top + top * RACK_UNIT_PX,
      width: innerWidth,
      height: size * RACK_UNIT_PX,
    });
  }

  const frames: FrameCellSpec[] = [rack];
  const columnX = RACK_WIDTH + FRAME_GAP;
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
        ...faceOf(device),
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
      x: columnX,
      y: 0,
      width,
      height: y - COLUMN_GAP,
    });
  }
  return { uHeight, frames, devices: sorted.map((d) => placed.get(d.id)!) };
}

interface PreviousRack {
  /** Ô máy của bản trước theo máy, thứ tự trong bản vẽ; `back` = nằm trong khung mặt sau (dữ liệu cũ). */
  devices: Map<string, { id: string; back: boolean }[]>;
  /** Nét của bản trước: thuộc tính `UserObject` bọc (nếu có) + của `mxCell`. */
  edges: { id: string; wrapper: Record<string, string> | null; cell: Record<string, string> }[];
}

/**
 * Đuôi nhãn khung mặt sau mà bản vẽ cũ còn giữ (trước khi tủ chỉ vẽ mặt trước). Nội dung đã lưu
 * không bị sửa, nên đặt máy theo U, tự kiểm và lệch kho phải nhận ra rồi bỏ qua khung đó — cùng một
 * máy đã có ô ở mặt trước. Web giữ cùng chuỗi ở `rack-fit.ts`.
 */
export const REAR_FRAME_LABEL = 'Mặt sau';

/** Khung mặt sau của bản vẽ cũ (xem `REAR_FRAME_LABEL`). */
export function isRearFrameLabel(label: string): boolean {
  return label.trim().endsWith(`· ${REAR_FRAME_LABEL}`);
}

function readPrevious(xml: string): PreviousRack {
  const frames = new Map<string, string>();
  const cells: { id: string; deviceId: string | null; parent: string | null }[] = [];
  const edges: PreviousRack['edges'] = [];
  let wrapper: Record<string, string> | null = null;
  const parser = new SaxesParser({ xmlns: false });
  parser.on('opentag', (tag: SaxesTagPlain) => {
    const attrs = tag.attributes as Record<string, string>;
    if (tag.name === 'UserObject' || tag.name === 'object') {
      wrapper = attrs;
      return;
    }
    if (tag.name !== 'mxCell') return;
    const id = attrs.id ?? wrapper?.id ?? '';
    if (attrs.edge === '1') edges.push({ id, wrapper, cell: attrs });
    else if (wrapper?.ims_cabinet_id) frames.set(id, wrapper.label ?? '');
    else cells.push({ id, deviceId: wrapper?.ims_device_id ?? null, parent: attrs.parent ?? null });
  });
  parser.on('closetag', (tag: SaxesTagPlain) => {
    if (tag.name === 'UserObject' || tag.name === 'object') wrapper = null;
  });
  parser.write(xml).close();
  const devices = new Map<string, { id: string; back: boolean }[]>();
  for (const cell of cells) {
    if (!cell.deviceId) continue;
    const back = isRearFrameLabel(frames.get(cell.parent ?? '') ?? '');
    devices.set(cell.deviceId, [...(devices.get(cell.deviceId) ?? []), { id: cell.id, back }]);
  }
  return { devices, edges };
}

/**
 * "Dựng lại mặt tủ": cả bản vẽ chỉ gồm khung tủ dựng từ kho — một trang, khung trên lớp mặc định,
 * máy là ô CON của khung (cùng quan hệ như khi chèn bằng `patch`). Nơi gọi dehydrate trước khi lưu
 * (ảnh nhúng không vào kho bản vẽ — AD-18).
 *
 * `previousXml` = phiên bản đang có: ô máy GIỮ id cũ (ô ngoài khung mặt sau cũ), và mọi nét có hai
 * đầu là ô còn lại được giữ — dây đã khai vẫn gắn đúng máy thay vì mất hết sau khi dựng lại. Nét
 * giữ lại bỏ điểm uốn (khung đã dời chỗ) và nằm trên lớp mặc định; hình tự do khác bị bỏ.
 */
export function buildRackXml(layout: CabinetFrameLayout, previousXml?: string): string {
  const attrText = (attrs: Record<string, string>) =>
    Object.entries(attrs)
      .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
      .join('');
  const geometry = (x: number, y: number, width: number, height: number) => {
    const r = (n: number) => Math.round(n * 10) / 10;
    return `<mxGeometry x="${r(x)}" y="${r(y)}" width="${r(width)}" height="${r(height)}" as="geometry"/>`;
  };
  const origin = 40;
  const parts: string[] = [];
  const frameIds = new Map<string, string>();
  const previous: PreviousRack = previousXml ? readPrevious(previousXml) : { devices: new Map(), edges: [] };
  const deviceIds = layout.devices.map((device) => {
    // Ô ở khung mặt sau cũ chỉ là bản sao của máy: giữ id ô ngoài mặt sau để dây vẫn gắn.
    const old: { id: string; back: boolean }[] = previous.devices.get(device.id) ?? [];
    const pick = old.find((c) => !c.back) ?? old[0];
    if (!pick) return null;
    previous.devices.set(device.id, old.filter((c) => c !== pick));
    return pick.id;
  });
  const taken = new Set(deviceIds.filter((id): id is string => id !== null));
  const keptEdges = previous.edges.filter((e) => taken.has(e.cell.source ?? '') && taken.has(e.cell.target ?? ''));
  for (const edge of keptEdges) taken.add(edge.id);
  let counter = 0;
  const fresh = (prefix: string) => {
    let id: string;
    do {
      counter += 1;
      id = `${prefix}${counter}`;
    } while (taken.has(id));
    taken.add(id);
    return id;
  };
  layout.frames.forEach((frame) => {
    const id = fresh('ims-f');
    frameIds.set(frame.key, id);
    parts.push(
      `<UserObject label="${escapeXmlAttr(frame.label)}"${attrText(frame.attrs)} id="${id}">` +
        `<mxCell style="${escapeXmlAttr(frame.style)}" vertex="1" parent="1">${geometry(origin + frame.x, origin + frame.y, frame.width, frame.height)}</mxCell></UserObject>`,
    );
  });
  counter = 0;
  layout.devices.forEach((device, i) => {
    const parent = frameIds.get(device.frame);
    if (!parent) return;
    const id = deviceIds[i] ?? fresh('ims-d');
    parts.push(
      `<UserObject label="${escapeXmlAttr(device.label)}" ims_device_id="${escapeXmlAttr(device.id)}" ims_device_code="${escapeXmlAttr(device.code)}"${attrText(device.attrs)} id="${escapeXmlAttr(id)}">` +
        `<mxCell style="${escapeXmlAttr(device.style)}" vertex="1" parent="${parent}">${geometry(device.x, device.y, device.width, device.height)}</mxCell></UserObject>`,
    );
  });
  for (const edge of keptEdges) {
    const cell = Object.entries(edge.cell).filter(([k]) => k !== 'parent' && k !== 'id');
    const cellAttrs = `${edge.wrapper ? '' : ` id="${escapeXmlAttr(edge.id)}"`}${cell.map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`).join('')} parent="1"`;
    const body = `<mxCell${cellAttrs}><mxGeometry relative="1" as="geometry"/></mxCell>`;
    if (!edge.wrapper) {
      parts.push(body);
      continue;
    }
    const wrapperAttrs = Object.entries(edge.wrapper).filter(([k]) => k !== 'id');
    parts.push(`<UserObject${wrapperAttrs.map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`).join('')} id="${escapeXmlAttr(edge.id)}">${body}</UserObject>`);
  }
  return `<mxfile><diagram id="ims-p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${parts.join('')}</root></mxGraphModel></diagram></mxfile>`;
}
