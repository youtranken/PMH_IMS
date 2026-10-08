import { cellIdOf, parseDrawioXml, wrapperAttrs } from './drawio-bridge';

/**
 * Ô thiết bị kho trên một trang của màn SỬA (AD-18) và hình máy server dựng
 * (`GET /diagrams/device-looks`) — hàm THUẦN, test bảng dữ liệu ở `photo-bridge.test.ts`.
 *
 * Giao thức nhúng không báo "đang chọn ô nào", nên các hộp IMS đọc ô thiết bị từ XML cả tệp. Ô hiện
 * ảnh model mang `ims_photo="front|back"` (lưu trong XML khô); không có thì là biểu tượng loại.
 */

export interface DeviceCellOnPage {
  id: string;
  deviceId: string;
  code: string;
  photo: 'front' | 'back' | null;
  style: string;
  /** Thuộc tính dữ liệu hiện có của ô (trừ `id`) — giữ nguyên khi đổi hình. */
  attrs: Record<string, string>;
  /**
   * Vị trí + cỡ hiện tại; `null` = không đọc được, hoặc ô nằm trong khung tủ (cao = số U, đúng
   * thật — đổi hình không được kéo nó lệch khỏi U).
   */
  geometry: { x: number; y: number; width: number; height: number } | null;
  /** Ô là con của một khung tủ — đổi hình giữ nhãn bên phải. */
  inRack: boolean;
}

/** `GET /diagrams/device-looks` — một máy. */
export interface DeviceLook {
  id: string;
  found: boolean;
  icon: string;
  /** Cao/rộng của ô biểu tượng (server tính). */
  iconAspect: number;
  /** `aspect` = cao/rộng của ô ảnh, server đã chặn (`photoAspect` của api). */
  front: { style: string; fileId: string; aspect: number } | null;
  back: { style: string; fileId: string; aspect: number } | null;
}

/** Ô thiết bị kho trên MỘT trang (lệnh `patch` sửa theo trang). */
export function deviceCellsOnPage(xml: string, pageId: string): DeviceCellOnPage[] {
  const doc = parseDrawioXml(xml);
  const page = doc ? Array.from(doc.getElementsByTagName('diagram')).find((d) => d.getAttribute('id') === pageId) : undefined;
  if (!page) return [];
  const out: DeviceCellOnPage[] = [];
  const rackFrames = new Set(
    ['UserObject', 'object'].flatMap((tag) =>
      Array.from(page.getElementsByTagName(tag))
        .filter((el) => el.getAttribute('ims_cabinet_id'))
        .map((el) => el.getAttribute('id') ?? ''),
    ),
  );
  // Mặt tủ = hình xếp con theo vạch U (`childLayout=rack`), kể cả tủ lấy từ thư viện — cột "Chưa
  // khai U" cũng mang ims_cabinet_id nhưng là cột xếp chồng, nhãn ở dưới hình.
  const rackFaces = new Set(
    Array.from(page.getElementsByTagName('mxCell'))
      .filter((cell) => /(?:^|;)childLayout=rack(?:;|$)/.test(cell.getAttribute('style') ?? ''))
      .map(cellIdOf),
  );
  for (const tag of ['UserObject', 'object']) {
    for (const el of Array.from(page.getElementsByTagName(tag))) {
      const deviceId = el.getAttribute('ims_device_id');
      const cell = el.getElementsByTagName('mxCell')[0];
      if (!deviceId || !cell) continue;
      const attrs = wrapperAttrs(el);
      const photo = attrs.ims_photo === 'front' || attrs.ims_photo === 'back' ? attrs.ims_photo : null;
      out.push({
        id: el.getAttribute('id') ?? '',
        deviceId,
        code: attrs.ims_device_code ?? '',
        photo,
        style: cell.getAttribute('style') ?? '',
        attrs,
        geometry: rackFrames.has(cell.getAttribute('parent') ?? '') ? null : geometryOf(cell),
        inRack: rackFaces.has(cell.getAttribute('parent') ?? ''),
      });
    }
  }
  return out;
}

function geometryOf(cell: Element): DeviceCellOnPage['geometry'] {
  const geo = Array.from(cell.children).find((child) => child.tagName === 'mxGeometry');
  if (!geo) return null;
  const width = Number(geo.getAttribute('width'));
  const height = Number(geo.getAttribute('height'));
  if (!(width > 0 && height > 0)) return null;
  return { x: Number(geo.getAttribute('x') ?? 0) || 0, y: Number(geo.getAttribute('y') ?? 0) || 0, width, height };
}
