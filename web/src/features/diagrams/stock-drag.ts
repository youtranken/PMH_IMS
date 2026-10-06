import { escapeXmlAttr, type DeviceCellSpec } from './drawio-bridge';

/**
 * Kéo máy từ hộp "Thiết bị kho" thả vào trình vẽ (Q-23) — hàm THUẦN, test bảng ở
 * `stock-drag.test.ts`.
 *
 * Dữ liệu kéo là chữ `<mxGraphModel>` một ô: draw.io nhận cú thả như dán (cùng đường nhận tệp
 * draw.io), đặt ô đúng chỗ con trỏ và ghi vào lịch sử hoàn tác. IMS không tính toạ độ: giao thức
 * nhúng không báo vị trí cuộn của khung, nên toạ độ tính từ ngoài sẽ lệch.
 */
export function deviceDropXml(device: DeviceCellSpec): string {
  const own = new Set(['label', 'ims_device_id', 'ims_device_code', 'id']);
  const extra = Object.entries(device.cell.attrs ?? {}).filter(([k]) => !own.has(k));
  const attrs: [string, string][] = [['label', device.cell.label], ['ims_device_id', device.id], ['ims_device_code', device.code], ...extra, ['id', 'ims-drop']];
  return (
    '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
    `<UserObject ${attrs.map(([k, v]) => `${k}="${escapeXmlAttr(v)}"`).join(' ')}>` +
    `<mxCell style="${escapeXmlAttr(device.cell.style)}" vertex="1" parent="1">` +
    `<mxGeometry x="0" y="0" width="${device.cell.width}" height="${device.cell.height}" as="geometry"/></mxCell></UserObject>` +
    '</root></mxGraphModel>'
  );
}

/**
 * Con trỏ đang kéo có nằm trong khung trình vẽ không, đọc từ sự kiện kéo của TRANG IMS: vào khung
 * (khác nguồn) thì trang chỉ nhận `dragleave` không có `relatedTarget`, toạ độ trong khung; quay ra
 * thì nhận lại `dragenter`. Khung không báo gì cho trang.
 */
export function dragFrameState(
  inFrame: boolean,
  event: { type: 'dragenter' | 'dragleave'; related: boolean; x: number; y: number },
  rect: { left: number; top: number; right: number; bottom: number },
): boolean {
  if (event.type === 'dragenter') return false;
  if (event.related) return inFrame;
  return event.x >= rect.left && event.x <= rect.right && event.y >= rect.top && event.y <= rect.bottom;
}

/**
 * Thả trong khung mà trình duyệt báo không ai nhận (`dropEffect` "none" — có trình duyệt không giao
 * cú thả cho khung khác nguồn): IMS chèn máy theo lưới như nút "Chèn", để cú kéo không mất trắng.
 */
export function wantsDropFallback(inFrame: boolean, dropEffect: string): boolean {
  return inFrame && dropEffect === 'none';
}
