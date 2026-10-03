import { escapeXmlAttr, growBounds, nextInsertPosition, type Bounds, type DrawioCellJson } from './drawio-bridge';

/**
 * Hàm THUẦN của bản trình bày (Q-23, FR-045): ô thiết bị dự kiến, ô ảnh tự do và thông báo "bản
 * gốc đã có phiên bản mới". Server là chốt chặn (cổng XML, `DIAGRAM_PLANNED_NOT_ALLOWED`, tự kiểm
 * `PLANNED_DEVICE`); web chỉ dựng ô đúng hợp đồng và chặn sớm thứ chắc chắn bị từ chối.
 */

/** `DiagramNode.source` của server — bản trình bày chép từ đâu. */
export interface PresentationSource {
  diagramId: string | null;
  name: string | null;
  versionId: string | null;
  seq: number | null;
  officialVersionId: string | null;
  officialSeq: number | null;
}

/** Cùng luật với `newerOfficialSeq` của server: so id, vì khôi phục làm chính thức tạo số mới. */
export function newerOfficialSeq(source: PresentationSource | null | undefined): number | null {
  if (!source || source.seq === null || source.officialSeq === null || !source.officialVersionId) return null;
  if (source.officialVersionId === source.versionId) return null;
  return source.officialSeq > source.seq ? source.officialSeq : null;
}

/**
 * Cùng luật với `canManageNode` của server: Admin/SA đổi tên / lưu trữ mọi bản; Thành viên chỉ
 * bản trình bày mình tạo hoặc phụ trách. Server vẫn là chốt chặn (403) — web chỉ ẩn nút.
 */
export function canManageNode(
  node: { kind: 'official' | 'presentation'; ownerEmail: string | null; createdBy?: string },
  me: { email: string; role: string },
): boolean {
  if (me.role === 'sa' || me.role === 'admin') return true;
  if (node.kind !== 'presentation') return false;
  const email = me.email.toLowerCase();
  return (node.createdBy ?? '').toLowerCase() === email || (node.ownerEmail ?? '').toLowerCase() === email;
}

/** Một ô tự do để chèn: thuộc tính dữ liệu + style + cỡ. */
export interface FreeCellSpec {
  label: string;
  attrs: [string, string][];
  style: string;
  width: number;
  height: number;
}

export interface PlannedInput {
  name: string;
  model: string;
  price: string;
  vendor: string;
}

/** Nhãn ô là chữ thuần (`html=0`); bỏ `<`/`>` để cổng nhãn HTML của server không phải đoán. */
function plain(value: string): string {
  return value.replace(/[<>]/g, '').trim();
}

/*
 * Viền đứt (`dashed=1`) là dấu hiệu "chưa có thật" theo FR-045. Không đặt màu: màu mặc định của
 * trình vẽ đi theo giao diện sáng/tối, hex trong mã nguồn bị cấm.
 */
const PLANNED_STYLE = 'rounded=1;whiteSpace=wrap;html=0;dashed=1;dashPattern=8 4;align=center;verticalAlign=middle;';

/**
 * Thiết bị dự kiến: `ims_planned="1"` + model/giá/NCC làm thuộc tính ô (AD-18), KHÔNG có
 * `ims_device_id` — nó không có trong kho. `plannedWord` là chữ "Dự kiến" đã dịch.
 */
export function plannedCellSpec(input: PlannedInput, plannedWord: string): FreeCellSpec {
  const name = plain(input.name);
  const model = plain(input.model);
  const price = plain(input.price);
  const vendor = plain(input.vendor);
  const attrs: [string, string][] = [['ims_planned', '1']];
  if (model) attrs.push(['ims_planned_model', model]);
  if (price) attrs.push(['ims_planned_price', price]);
  if (vendor) attrs.push(['ims_planned_vendor', vendor]);
  const lines = [name, model, [plannedWord, price, vendor].filter(Boolean).join(' · ')].filter(Boolean);
  return { label: lines.join('\n'), attrs, style: PLANNED_STYLE, width: 140, height: 70 };
}

/** Ảnh nhận được: đúng ba định dạng của kiểm nội dung tệp sẵn có (jpeg/png/webp), đọc theo byte đầu. */
export type FreeImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export function sniffImageMime(bytes: Uint8Array): FreeImageMime | null {
  const at = (i: number) => bytes[i] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  const riff = at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46;
  const webp = at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50;
  return riff && webp ? 'image/webp' : null;
}

/**
 * Ảnh nhúng nằm TRONG XML bản vẽ, nên một ảnh lớn hơn trần `diagram.xml_max_kb` thì bản vẽ không
 * bao giờ lưu được — chặn ngay lúc chọn tệp thay vì để người vẽ mất công rồi mới bị từ chối.
 */
export function imageDataUrlReason(dataUrl: string, xmlMaxKb: number): string | null {
  return dataUrl.length > xmlMaxKb * 1024 ? `${xmlMaxKb} KB` : null;
}

/** Cỡ hình trên bản vẽ: thu vào khung `max`, giữ tỉ lệ; không đọc được cỡ thì khung 4:3. */
export function fitImageSize(width: number, height: number, max: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: max, height: Math.round((max * 3) / 4) };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Ô ảnh tự do. draw.io ghi ảnh nhúng trong style là `data:image/png,<base64>` (bỏ `;base64`) vì
 * `;` là dấu ngăn khoá của style; cổng XML của server nhận cả hai dạng `data:image/...`.
 */
export function imageCellSpec(dataUrl: string, size: { width: number; height: number }): FreeCellSpec {
  const image = dataUrl.replace(/^(data:image\/[a-z]+);base64,/i, '$1,');
  return {
    label: '',
    attrs: [],
    style: `shape=image;image=${image};imageAspect=0;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;html=0;`,
    width: size.width,
    height: size.height,
  };
}

function freeCellJson(spec: FreeCellSpec, at: { cellId: string; parent: string; previous: string | null; x: number; y: number }): DrawioCellJson {
  const attrs: [string, string][] = [['label', spec.label], ...spec.attrs, ['id', at.cellId]];
  return {
    id: at.cellId,
    vertex: 1,
    parent: at.parent,
    ...(at.previous ? { previous: at.previous } : {}),
    style: spec.style,
    geometry: `<mxGeometry x="${Math.round(at.x)}" y="${Math.round(at.y)}" width="${spec.width}" height="${spec.height}" as="geometry"/>`,
    xmlValue: `<UserObject ${attrs.map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`).join(' ')}/>`,
  };
}

/** Như `placeCells` của máy kho: xếp thành hàng bên phải khối hình đang có, ô sau nằm trên ô trước. */
export function placeFreeCells(
  specs: FreeCellSpec[],
  opts: { bounds: Bounds | null; parent: string; previous: string | null; newId: () => string },
): { cells: DrawioCellJson[]; bounds: Bounds | null } {
  let bounds = opts.bounds;
  let previous = opts.previous;
  const cells: DrawioCellJson[] = [];
  for (const spec of specs) {
    const at = nextInsertPosition(bounds);
    const cell = freeCellJson(spec, { cellId: opts.newId(), parent: opts.parent, previous, ...at });
    cells.push(cell);
    previous = cell.id;
    bounds = growBounds(bounds, { ...at, width: spec.width, height: spec.height });
  }
  return { cells, bounds };
}
