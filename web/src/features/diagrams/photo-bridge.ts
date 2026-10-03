import { bindEdgeValue } from './cable-diff';

/**
 * Công tắc "Biểu tượng / Ảnh thật" của màn SỬA (AD-18) — hàm THUẦN, test bảng dữ liệu ở
 * `photo-bridge.test.ts`.
 *
 * Giao thức nhúng không báo "đang chọn ô nào", nên người vẽ chọn ô thiết bị trong hộp IMS (đọc từ
 * XML cả tệp). Ô chọn ảnh mang `ims_photo="front|back"` (lưu trong XML khô) + ảnh nhúng sẵn do
 * server dựng (`GET /diagrams/device-looks`); về biểu tượng thì gỡ `ims_photo`. Phần style IMS do
 * server làm chủ: web gỡ đúng các khoá server trả (`imsStyleKeys`) rồi nối style server dựng.
 */

export type PhotoChoice = 'icon' | 'front' | 'back';

export interface DeviceCellOnPage {
  id: string;
  deviceId: string;
  code: string;
  photo: 'front' | 'back' | null;
  style: string;
  /** Thuộc tính dữ liệu hiện có của ô (trừ `id`) — giữ nguyên khi đổi hình. */
  attrs: Record<string, string>;
}

/** `GET /diagrams/device-looks` — một máy. */
export interface DeviceLook {
  id: string;
  found: boolean;
  icon: string;
  front: { style: string; fileId: string } | null;
  back: { style: string; fileId: string } | null;
}

function parse(xml: string): Document | null {
  if (!xml || !xml.trim()) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return doc.getElementsByTagName('parsererror').length > 0 ? null : doc;
}

/** Ô thiết bị kho trên MỘT trang (lệnh `patch` sửa theo trang). */
export function deviceCellsOnPage(xml: string, pageId: string): DeviceCellOnPage[] {
  const doc = parse(xml);
  const page = doc ? Array.from(doc.getElementsByTagName('diagram')).find((d) => d.getAttribute('id') === pageId) : undefined;
  if (!page) return [];
  const out: DeviceCellOnPage[] = [];
  for (const tag of ['UserObject', 'object']) {
    for (const el of Array.from(page.getElementsByTagName(tag))) {
      const deviceId = el.getAttribute('ims_device_id');
      const cell = el.getElementsByTagName('mxCell')[0];
      if (!deviceId || !cell) continue;
      const attrs: Record<string, string> = {};
      for (const attr of Array.from(el.attributes)) if (attr.name !== 'id') attrs[attr.name] = attr.value;
      const photo = attrs.ims_photo === 'front' || attrs.ims_photo === 'back' ? attrs.ims_photo : null;
      out.push({
        id: el.getAttribute('id') ?? '',
        deviceId,
        code: attrs.ims_device_code ?? '',
        photo,
        style: cell.getAttribute('style') ?? '',
        attrs,
      });
    }
  }
  return out;
}

/** Bỏ các khoá style IMS làm chủ (`k=v;`). Ảnh `data:…;base64,…` bị `;` cắt làm hai mẩu: gỡ cả mẩu đuôi. */
export function styleWithoutKeys(style: string, keys: readonly string[]): string {
  const tokens = style.split(';');
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '') continue;
    const key = token.includes('=') ? token.slice(0, token.indexOf('=')).trim() : null;
    if (key !== null && keys.includes(key)) {
      if (key === 'image' && tokens[i + 1]?.startsWith('base64,')) i += 1;
      continue;
    }
    kept.push(token);
  }
  return kept.length > 0 ? `${kept.join(';')};` : '';
}

/** Lý do một lựa chọn không bấm được; `null` = bấm được. */
export function photoChoiceReason(look: DeviceLook | undefined, choice: PhotoChoice): 'missing' | 'noPhoto' | null {
  if (choice === 'icon') return null;
  if (!look || !look.found) return 'missing';
  return look[choice] ? null : 'noPhoto';
}

/** Lựa chọn đang hiện của ô. */
export function currentChoice(cell: DeviceCellOnPage): PhotoChoice {
  return cell.photo ?? 'icon';
}

/** Giá trị + style mới cho lệnh `patch` khi đổi một ô sang `choice`. */
export function photoCellUpdate(
  cell: DeviceCellOnPage,
  look: DeviceLook,
  choice: PhotoChoice,
  imsStyleKeys: readonly string[],
): { style: string; xmlValue: string } {
  const face = choice === 'icon' ? null : look[choice];
  const base = styleWithoutKeys(cell.style, imsStyleKeys);
  if (!face) {
    return {
      style: `${base}${look.icon}`,
      xmlValue: bindEdgeValue(cell.id, cell.attrs, {}, ['ims_photo', 'ims_photo_file_id']),
    };
  }
  return {
    style: `${base}${face.style}`,
    xmlValue: bindEdgeValue(cell.id, cell.attrs, {
      ims_photo: choice,
      ims_photo_file_id: face.fileId,
    }),
  };
}
