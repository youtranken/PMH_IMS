import { escapeXmlAttr } from '../../common/svg-sanitize';
import type { CheckLink } from './diagram-finding';
import { linkEdgeCell } from './diagram-hydrate';

/**
 * "Dựng nháp từ sơ đồ cổng" (FR-048) — hàm THUẦN, test ở `diagram-draft.spec.ts`. Máy xếp lưới
 * vuông đơn giản, dây là nét thẳng đã gắn kết nối; người vẽ tự xếp gọn bằng Arrange → Layout của
 * draw.io — IMS không viết thuật toán bố cục (Q-23).
 */

export interface DraftDevice {
  id: string;
  code: string;
  /** Ô dựng sẵn theo hình của loại (`deviceInsertCell`). */
  cell: { style: string; label: string; width: number; height: number };
}

const GAP_X = 80;
const GAP_Y = 80;

export function buildDraftXml(devices: DraftDevice[], links: CheckLink[], slots: Map<string, number> = new Map()): string {
  const columns = Math.max(1, Math.ceil(Math.sqrt(devices.length)));
  const pitchX = Math.max(0, ...devices.map((d) => d.cell.width)) + GAP_X;
  const pitchY = Math.max(0, ...devices.map((d) => d.cell.height)) + GAP_Y;
  const cellOf = new Map<string, string>();
  const parts: string[] = [];
  devices.forEach((device, i) => {
    const id = `ims-d${i + 1}`;
    cellOf.set(device.id, id);
    const x = 40 + (i % columns) * pitchX;
    const y = 40 + Math.floor(i / columns) * pitchY;
    parts.push(
      `<UserObject label="${escapeXmlAttr(device.code)}" ims_device_id="${escapeXmlAttr(device.id)}" ims_device_code="${escapeXmlAttr(device.code)}" id="${id}">` +
        `<mxCell style="${escapeXmlAttr(device.cell.style)}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${device.cell.width}" height="${device.cell.height}" as="geometry"/></mxCell></UserObject>`,
    );
  });
  let n = 0;
  for (const link of links) {
    const source = cellOf.get(link.deviceA);
    const target = cellOf.get(link.deviceB);
    if (!source || !target) continue;
    n += 1;
    const edge = linkEdgeCell(link, { sourceDeviceId: link.deviceA, slot: link.cableTypeId ? (slots.get(link.cableTypeId) ?? null) : null });
    const attrs = Object.entries(edge.attrs)
      .map(([k, v]) => ` ${k}="${escapeXmlAttr(v)}"`)
      .join('');
    parts.push(
      `<UserObject label="${escapeXmlAttr(edge.label)}"${attrs} id="ims-e${n}">` +
        `<mxCell style="${escapeXmlAttr(edge.style)}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject>`,
    );
  }
  return `<mxfile><diagram id="ims-p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${parts.join('')}</root></mxGraphModel></diagram></mxfile>`;
}
