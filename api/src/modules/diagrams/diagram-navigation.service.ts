import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { SystemConfigService } from '../config-sys/system-config.service';
import { DevicesApiService, type PortLink } from '../devices/devices.api';
import { shortestPortPath, type PathEdge } from './diagram-path';

/** Bản vẽ (chỉ tên + id — thông tin của cây, không phải nội dung) có một máy ở phiên bản mới nhất. */
export interface DiagramRef {
  id: string;
  name: string;
}

export interface FoundDevice {
  id: string;
  code: string;
  name: string | null;
  diagrams: DiagramRef[];
}

export interface PathHop {
  deviceId: string;
  code: string;
  /** Bản vẽ chính thức có máy này — web chỉ "→ bản vẽ khác" cho đoạn không nằm trên bản đang xem. */
  diagrams: DiagramRef[];
}

export interface PathResult {
  from: { id: string; code: string };
  to: { id: string; code: string };
  /** `null` = không có đường nối trong sơ đồ cổng (hoặc xa hơn `diagram.path_max_hops`). */
  path: { hops: PathHop[]; linkIds: string[] } | null;
}

/** Số máy tối đa một lần tìm trả về: ô tìm của trình xem là để bay tới, không phải để liệt kê kho. */
export const FIND_LIMIT = 20;

/**
 * Tìm và chỉ đường trên sơ đồ (AD-18): CHỈ ĐỌC kho qua `devices.api`, đọc cây của chính module.
 * Không trả nội dung bản vẽ nào (tên + id thôi) nên không đòi mã sơ đồ — mở bản vẽ để bay tới
 * vẫn đi qua route nội dung có step-up.
 */
@Injectable()
export class DiagramNavigationService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly config: SystemConfigService,
    private readonly devices: DevicesApiService,
  ) {}

  /** Máy khớp mã/tên/IP (cùng ô tìm với trang thiết bị) + bản vẽ chính thức chứa từng máy. */
  async find(term: string): Promise<FoundDevice[]> {
    const q = term.trim();
    if (q.length < 2) throw new BadRequestException({ code: 'DIAGRAM_FIND_TOO_SHORT', message: 'Gõ ít nhất 2 ký tự để tìm.' });
    const devices = await this.devices.search(q, FIND_LIMIT);
    const where = await this.diagramsWithDevices(devices.map((d) => d.id));
    return devices.map((d) => ({ id: d.id, code: d.code, name: d.name, diagrams: where.get(d.id) ?? [] }));
  }

  /**
   * Đường ít dây nhất giữa hai máy trên sơ đồ cổng. Dò từng tầng từ máy đầu (mỗi tầng một câu
   * `portLinksTouching`) tới khi gặp máy cuối hoặc hết `diagram.path_max_hops` tầng, rồi để hàm
   * thuần `shortestPortPath` chọn đường trên các cạnh đã nạp — không nạp cả sơ đồ cổng.
   */
  async path(fromId: string, toId: string): Promise<PathResult> {
    const [maxHops, ends] = await Promise.all([this.config.getNumber('diagramPathMaxHops'), this.devices.getByIds([fromId, toId])]);
    const from = ends.get(fromId);
    const to = ends.get(toId);
    if (!from || !to) throw new NotFoundException({ code: 'DEVICE_NOT_FOUND', message: 'Không tìm thấy thiết bị trong kho.' });
    const edges = new Map<string, PathEdge>();
    const codes = new Map<string, string>([
      [from.id, from.code],
      [to.id, to.code],
    ]);
    const seen = new Set([fromId]);
    let frontier = [fromId];
    for (let hop = 0; hop < maxHops && frontier.length > 0 && !seen.has(toId); hop += 1) {
      const links: PortLink[] = await this.devices.portLinksTouching(frontier);
      const next: string[] = [];
      for (const link of links) {
        edges.set(link.id, { id: link.id, a: link.deviceId, b: link.peerDeviceId });
        codes.set(link.deviceId, link.deviceCode);
        if (link.peerDeviceCode) codes.set(link.peerDeviceId, link.peerDeviceCode);
        for (const id of [link.deviceId, link.peerDeviceId]) {
          if (seen.has(id)) continue;
          seen.add(id);
          next.push(id);
        }
      }
      frontier = next;
    }
    const found = shortestPortPath(fromId, toId, [...edges.values()], maxHops);
    const ends2 = { from: { id: from.id, code: from.code }, to: { id: to.id, code: to.code } };
    if (!found) return { ...ends2, path: null };
    const where = await this.diagramsWithDevices(found.devices);
    return {
      ...ends2,
      path: {
        hops: found.devices.map((id) => ({ deviceId: id, code: codes.get(id) ?? '', diagrams: where.get(id) ?? [] })),
        linkIds: found.links,
      },
    };
  }

  /**
   * Bản vẽ chính thức chưa lưu trữ có từng máy ở phiên bản MỚI NHẤT — MỘT câu cho cả danh sách
   * (cùng luật với `DiagramsService.diagramsWithDevice` của thẻ thông tin).
   */
  async diagramsWithDevices(deviceIds: string[]): Promise<Map<string, DiagramRef[]>> {
    const out = new Map<string, DiagramRef[]>();
    const ids = [...new Set(deviceIds)];
    if (ids.length === 0) return out;
    const { rows } = await this.db.execute<{ device_id: string; id: string; name: string }>(sql`
      SELECT DISTINCT c.value ->> 'deviceId' AS device_id, d.id, d.name
        FROM diagram d
        JOIN LATERAL (
          SELECT v.cell_index FROM diagram_version v
           WHERE v.diagram_id = d.id ORDER BY v.seq DESC LIMIT 1
        ) lv ON true
        CROSS JOIN LATERAL jsonb_array_elements(lv.cell_index -> 'cells') c
       WHERE d.archived_at IS NULL
         AND d.kind = 'official'
         AND c.value ->> 'deviceId' IN (${sql.join(
           ids.map((id) => sql`${id}`),
           sql`, `,
         )})
       ORDER BY d.name, d.id
    `);
    for (const row of rows) out.set(row.device_id, [...(out.get(row.device_id) ?? []), { id: row.id, name: row.name }]);
    return out;
  }
}
