import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { HISTORY_PAGE_LIMIT, withActorNames } from '../../common/history';
import { diffRecord, hasChanges } from '../../common/record-diff';
import type { Tx } from '../../common/tx';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import type { UserRole } from '../auth/types';
import { CatalogApiService } from '../catalog/catalog.api';
import { SystemConfigService } from '../config-sys/system-config.service';
import { DevicesApiService, type PortLink } from '../devices/devices.api';
import { IpamApiService, type SubnetSummary } from '../ipam/ipam.api';
import { UsersApiService } from '../users/users.api';
import {
  buildCellIndex,
  diffCellIndex,
  layerNames,
  secretLabelReason,
  summarizeDiff,
  type CellBounds,
  type CellDiff,
  type CellIndex,
  type CellKind,
} from './diagram-cells';
import { cableEdgeStates, externalLinks, undrawnLinks, type CableEdge } from './diagram-checks';
import { buildDraftXml } from './diagram-draft';
import {
  buildRackXml,
  cabinetFrameLayout,
  childLinkReason,
  frameRefs,
  introducedRefs,
  type CabinetFrameDevice,
  type CabinetFrameLayout,
  type FrameRef,
} from './diagram-frames';
import type { CheckLink } from './diagram-finding';
import { checkDiagramXml, sanitizeDiagramSvg, wetXmlLimitKb } from './diagram-gate';
import {
  IMS_STYLE_KEYS,
  PHOTO_SIDE_ATTR,
  dehydrateDiagramXml,
  deviceInsertCell,
  deviceLookStyle,
  hydrateDiagramXml,
  linkEdgeCell,
  linkLabelFrom,
  photoDataUri,
  type DeviceCellSource,
  type DevicePhoto,
  type PhotoSide,
} from './diagram-hydrate';
import { rackUnitLabel } from '../../common/rack-units';
import { sizeReason } from '../../common/svg-sanitize';
import { mapWithLimit } from '../../common/map-limit';
import { canManageNode, plannedNotAllowedReason, presentationName, type PresentationSource } from './diagram-presentation';
import {
  diagramHistoryTable,
  diagramPresenceTable,
  diagramTable,
  diagramVersionLabelTable,
  diagramVersionTable,
  type DeviceSnapshotEntry,
  type DiagramNodeType,
} from './diagram.schema';

/** Trạng thái trên cây. "Chờ duyệt" và "lệch kho" thêm khi có duyệt và cảnh báo lệch kho. */
export type DiagramStatus = 'empty' | 'draft' | 'official' | 'official_draft';

export interface VersionRef {
  id: string;
  seq: number;
  savedAt: string;
  savedBy: string;
}

export interface DiagramNode {
  id: string;
  parentId: string | null;
  name: string;
  nodeType: DiagramNodeType;
  siteId: string | null;
  cabinetId: string | null;
  ownerEmail: string | null;
  createdBy: string;
  kind: 'official' | 'presentation';
  archivedAt: string | null;
  status: DiagramStatus;
  latestVersion: VersionRef | null;
  /** Bản trình bày: chép từ đâu + bản gốc giờ chính thức ở phiên bản nào. Bản chính thức: `null`. */
  source: PresentationSource | null;
}

export interface NodeInput {
  name?: string;
  nodeType?: DiagramNodeType;
  parentId?: string | null;
  siteId?: string | null;
  cabinetId?: string | null;
  ownerEmail?: string | null;
}

export interface VersionItem {
  id: string;
  seq: number;
  summary: string;
  label: string | null;
  savedBy: string;
  savedByName: string | null;
  savedAt: string;
  basedOnVersionId: string | null;
  restoredFromSeq: number | null;
}

/**
 * Một máy kho như sơ đồ thấy nó NGAY BÂY GIỜ: thẻ thông tin ở chế độ xem, ô mới khi chèn, nguồn
 * hydrate. `found: false` = `ims_device_id` không còn trong kho — các trường khác `null`/rỗng.
 * Không chứa gì của két (AD-4, AD-18).
 */
export interface DiagramDeviceInfo {
  id: string;
  found: boolean;
  code: string | null;
  name: string | null;
  deviceTypeName: string | null;
  model: string | null;
  serial: string | null;
  status: string | null;
  ips: string[];
  siteCode: string | null;
  cabinetCode: string | null;
  /** U thấp nhất máy chiếm trong tủ (U1 = đáy) và số U; `null` = chưa khai. */
  u: number | null;
  uSize: number | null;
  vendorName: string | null;
  vendorPhone: string | null;
  warrantyEnd: string | null;
  /** Máy có ảnh thật mặt trước / mặt sau không (ảnh riêng máy hoặc ảnh model) — công tắc Ảnh thật. */
  photos: { front: boolean; back: boolean };
  /** Ô dựng sẵn cho lệnh chèn của trình vẽ (style đã hydrate, nhãn, cỡ theo hình của loại). */
  cell: { style: string; label: string; width: number; height: number };
}

/**
 * Hình của một máy cho công tắc "Biểu tượng / Ảnh thật": phần style IMS của từng lựa chọn (cùng
 * luật hydrate). Web gỡ `imsStyleKeys` khỏi style đang có của ô rồi nối phần này — không tự ghép.
 */
export interface DeviceLook {
  id: string;
  found: boolean;
  icon: string;
  front: { style: string; fileId: string } | null;
  back: { style: string; fileId: string } | null;
}

/**
 * Một dòng sơ đồ cổng như sơ đồ thấy nó (đọc qua `devices.api`, AD-18): `id` = `ims_link_id`.
 * Nhãn cổng hai chiều + style ô dây do server dựng — web chèn nét (Vẽ vào, sau Khai) bằng đúng
 * luật hydrate, không tự ghép chuỗi.
 */
export interface DiagramLink extends PortLink {
  /** `cable_type.color_slot`; `null` = chưa khai loại dây. */
  colorSlot: number | null;
  /** Nhãn khi nét đi từ máy giữ bản ghi (`deviceId`) / từ máy đầu kia (`peerDeviceId`). */
  labelFromA: string;
  labelFromB: string;
  /** Style cho ô dây mới (có ô màu `imsPaint`). */
  edgeStyle: string;
}

/** Loại dây cho chú giải màu và ô chọn (kể cả loại ngừng dùng: dây cũ vẫn giữ màu — Q-14). */
export interface CableTypeInfo {
  id: string;
  name: string;
  colorSlot: number;
  active: boolean;
}

/** Phạm vi "Dựng nháp từ sơ đồ cổng": danh sách máy, hoặc một tủ, hoặc một site. */
export interface DraftScope {
  deviceIds?: string[];
  cabinetId?: string;
  siteId?: string;
}

export interface DiagramContent {
  diagram: DiagramNode;
  /** `null` = bản vẽ chưa lưu lần nào: màn sửa mở khung trống, màn xem báo "chưa có bản vẽ". */
  version: (VersionItem & { xml: string; svg: string | null; deviceSnapshot: DeviceSnapshotEntry[] }) | null;
  /**
   * Ô thiết bị của phiên bản (id ô → id máy + mã ghi trên ô) — trình xem nối cú bấm vào ô với thẻ
   * thông tin; mã đọc từ ô để thẻ vẫn nói được "máy nào" khi máy đã không còn trong kho.
   */
  deviceCells: { cellId: string; deviceId: string; code: string }[];
  /** Mọi máy có ô trên phiên bản, đọc MỘT lượt (không N+1). */
  devices: DiagramDeviceInfo[];
  /** Nét dây "của kho" và trạng thái (đã khai / đã gỡ / chưa khai …) — luật ở `diagram-checks.ts`. */
  cableEdges: CableEdge[];
  /** Dòng sơ đồ cổng của mọi nét + mọi dòng chạm máy có trên bản vẽ. */
  links: DiagramLink[];
  /** Kết nối giữa hai máy cùng có trên bản vẽ mà chưa nét nào mang — "Có N kết nối mới chưa vẽ". */
  undrawnLinkIds: string[];
  /** Kết nối có một đầu ngoài bản vẽ — trình xem chỉ "→ máy kia (bản vẽ khác)". */
  externalLinkIds: string[];
  cableTypes: CableTypeInfo[];
  /** Khung mang bản vẽ con / dải IP / tủ (AD-18) — trình xem bấm khung để xuống bản vẽ con, mở thẻ VLAN. */
  frames: DiagramFrame[];
  /** Lớp draw.io theo thứ tự trong XML (tên đọc lại từ XML) — trình xem bật/tắt lớp. */
  layers: { id: string; name: string }[];
  /** Mọi ô của phiên bản (từ chỉ mục ô): lớp chứa nó + khung bao — bật/tắt lớp, bay tới khi tìm. */
  cells: ViewCell[];
}

export interface ViewCell {
  id: string;
  kind: CellKind;
  layer: string | null;
  bounds: CellBounds | null;
}

/**
 * Một khung của phiên bản. `child` = bản vẽ con như cây thấy nó lúc mở (kể cả đã lưu trữ — trình
 * xem hiện dấu); `null` khi khung trỏ id bản vẽ không còn.
 */
export interface DiagramFrame extends FrameRef {
  child: { id: string; name: string; archived: boolean; kind: 'official' | 'presentation' } | null;
}

/** Khung tủ dựng sẵn để chèn (`GET /diagrams/cabinet-frame/:cabinetId`). */
export interface CabinetFrame {
  cabinet: { id: string; code: string; siteCode: string; uHeight: number | null; active: boolean };
  layout: CabinetFrameLayout;
}

/** Số IP trống đầu tiên hiện trên thẻ khung VLAN — chỉ để người xem thấy "còn chỗ ở đâu", không phải danh sách cấp. */
export const SUBNET_FREE_PREVIEW = 5;

/** Trần số máy một lần hỏi `device-info` — hơn thế là gọi nhầm, không phải một bản vẽ. */
export const DEVICE_INFO_MAX_IDS = 500;

/** Bản vẽ (chỉ tên + id — thông tin của cây, không phải nội dung) có một máy ở phiên bản mới nhất. */
export interface DiagramRef {
  id: string;
  name: string;
}

/**
 * Trần số máy một lần hỏi `device-looks`. Khác `device-info`: mỗi máy kéo theo tới HAI ảnh thật
 * (đọc tệp + thu nhỏ trên threadpool) nhúng thẳng vào câu trả lời, nên 500 máy là hàng trăm MB và
 * một request giữ CPU cả phút. Web chia danh sách máy của trang thành từng lô cỡ này
 * (`DEVICE_LOOKS_BATCH` ở `use-photo-bridge.tsx` — đổi thì đổi cả hai). Đây là trần kỹ thuật của
 * một request, không phải tham số nghiệp vụ.
 */
export const DEVICE_LOOKS_MAX_IDS = 40;

/** Ảnh thật đọc + thu nhỏ song song tối đa từng này tấm một lượt (`mapWithLimit`). */
const PHOTO_LOAD_CONCURRENCY = 4;

export interface SaveInput {
  xml: string;
  svg: string;
  /** Phiên bản màn sửa đã nạp; khác bản mới nhất lúc lưu = người này lưu đè lên bản của người khác. */
  basedOnVersionId: string | null;
}

export interface PresentationInput {
  /** Bỏ trống = "<tên bản gốc> — trình bày", thêm số khi trùng. */
  name?: string;
}

/** Số lần thử tên mặc định trước khi chịu 409 — quá chừng ấy bản trình bày cùng tên là gọi nhầm. */
const PRESENTATION_NAME_ATTEMPTS = 50;

export interface Presence {
  email: string;
  fullName: string;
}

const TRACKED = ['name', 'nodeType', 'parentId', 'siteId', 'cabinetId', 'ownerEmail'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Module `diagrams` (AD-18): chủ duy nhất cây bản vẽ và phiên bản. Đọc kho chỉ qua public api
 * của `devices` / `ipam` / `catalog`; không gọi `vault`, không ghi `device_port`.
 *
 * XML là dữ liệu không tin cậy (AD-17): mọi lần lưu đi qua cổng `diagram-gate.ts` trước khi chạm
 * DB, và SVG cho trình xem lưu bản đã làm sạch — trình xem chèn thẳng nó vào DOM.
 */
@Injectable()
export class DiagramsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly config: SystemConfigService,
    private readonly catalog: CatalogApiService,
    private readonly devices: DevicesApiService,
    private readonly ipam: IpamApiService,
    private readonly users: UsersApiService,
  ) {}

  /* ------------------------------------------------------------------ cây --- */

  async tree(): Promise<DiagramNode[]> {
    return this.nodes(sql`d.archived_at IS NULL`);
  }

  async node(id: string): Promise<DiagramNode> {
    const [found] = await this.nodes(sql`d.id = ${id}`);
    if (!found) throw new NotFoundException({ code: 'DIAGRAM_NOT_FOUND', message: 'Không tìm thấy bản vẽ.' });
    return found;
  }

  private async nodes(where: ReturnType<typeof sql>): Promise<DiagramNode[]> {
    const { rows } = await this.db.execute<{
      id: string;
      parent_id: string | null;
      name: string;
      node_type: DiagramNodeType;
      site_id: string | null;
      cabinet_id: string | null;
      owner_email: string | null;
      created_by: string;
      kind: 'official' | 'presentation';
      archived_at: Date | string | null;
      official_version_id: string | null;
      v_id: string | null;
      v_seq: number | null;
      v_at: Date | string | null;
      v_by: string | null;
      source_diagram_id: string | null;
      source_version_id: string | null;
      s_name: string | null;
      s_seq: number | null;
      s_official_id: string | null;
      s_official_seq: number | null;
    }>(sql`
      SELECT d.id, d.parent_id, d.name, d.node_type, d.site_id, d.cabinet_id, d.owner_email, d.created_by, d.kind,
             d.archived_at, d.official_version_id, lv.id AS v_id, lv.seq AS v_seq, lv.created_at AS v_at,
             lv.saved_by AS v_by, d.source_diagram_id, d.source_version_id, sd.name AS s_name,
             sv.seq AS s_seq, sd.official_version_id AS s_official_id, so.seq AS s_official_seq
        FROM diagram d
        LEFT JOIN LATERAL (
          SELECT v.id, v.seq, v.created_at, v.saved_by FROM diagram_version v
           WHERE v.diagram_id = d.id ORDER BY v.seq DESC LIMIT 1
        ) lv ON true
        LEFT JOIN diagram sd ON sd.id = d.source_diagram_id
        LEFT JOIN diagram_version sv ON sv.id = d.source_version_id
        LEFT JOIN diagram_version so ON so.id = sd.official_version_id
       WHERE ${where}
       ORDER BY lower(d.name), d.id
    `);
    return rows.map((row) => {
      const latest: VersionRef | null = row.v_id
        ? { id: row.v_id, seq: Number(row.v_seq), savedAt: iso(row.v_at)!, savedBy: row.v_by ?? '' }
        : null;
      return {
        id: row.id,
        parentId: row.parent_id,
        name: row.name,
        nodeType: row.node_type,
        siteId: row.site_id,
        cabinetId: row.cabinet_id,
        ownerEmail: row.owner_email,
        createdBy: row.created_by,
        kind: row.kind,
        archivedAt: iso(row.archived_at),
        status: statusOf(latest?.id ?? null, row.official_version_id),
        latestVersion: latest,
        source:
          row.kind === 'presentation'
            ? {
                diagramId: row.source_diagram_id,
                name: row.s_name,
                versionId: row.source_version_id,
                seq: row.s_seq === null ? null : Number(row.s_seq),
                officialVersionId: row.s_official_id,
                officialSeq: row.s_official_seq === null ? null : Number(row.s_official_seq),
              }
            : null,
      };
    });
  }

  async create(actor: string, input: NodeInput): Promise<DiagramNode> {
    const name = (input.name ?? '').trim();
    if (input.parentId) await this.assertLiveParent(input.parentId);
    await this.catalog.assertRefs({ siteId: input.siteId ?? null, cabinetId: input.cabinetId ?? null }, null);
    if (input.ownerEmail) await this.assertUser(input.ownerEmail);
    const id = await this.uniqueName(() =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(diagramTable)
          .values({
            parentId: input.parentId ?? null,
            name,
            nodeType: input.nodeType ?? 'other',
            siteId: input.siteId ?? null,
            cabinetId: input.cabinetId ?? null,
            ownerEmail: input.ownerEmail ?? null,
            createdBy: actor,
          })
          .returning({ id: diagramTable.id });
        await this.record(tx, actor, row.id, 'created', 'diagram.created', { name, parentId: input.parentId ?? null });
        return row.id;
      }),
    );
    return this.node(id);
  }

  async update(by: { email: string; role: UserRole }, id: string, patch: NodeInput): Promise<DiagramNode> {
    const actor = by.email;
    /*
     * DTO qua ValidationPipe giữ mọi khoá của lớp, khoá không gửi mang `undefined`: bỏ chúng trước
     * khi so, nếu không `diffRecord` coi là "đổi thành rỗng" và ghi NULL vào cột không được rỗng.
     */
    const input = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as NodeInput;
    const current = await this.node(id);
    assertCanManage(current, by);
    // Thành viên chủ bản trình bày chỉ đổi TÊN: người phụ trách, loại nút vẫn do Admin/SA.
    if (by.role === 'member' && Object.keys(input).some((key) => key !== 'name')) throw manageForbidden();
    if (current.archivedAt) throw archived();
    if (current.kind === 'presentation' && input.parentId) {
      throw new BadRequestException({
        code: 'DIAGRAM_PRESENTATION_NO_PARENT',
        message: 'Bản trình bày đứng riêng ngoài cây bản vẽ chính thức — không chuyển vào nhánh nào được.',
      });
    }
    if (input.parentId) {
      if (input.parentId === id || (await this.descendantIds(id)).includes(input.parentId)) {
        throw new BadRequestException({ code: 'DIAGRAM_MOVE_CYCLE', message: 'Không chuyển được bản vẽ vào chính nhánh con của nó.' });
      }
      await this.assertLiveParent(input.parentId);
    }
    const next = { ...input, ...(input.name !== undefined ? { name: input.name.trim() } : {}) };
    await this.catalog.assertRefs(
      { siteId: next.siteId === undefined ? current.siteId : next.siteId, cabinetId: next.cabinetId === undefined ? current.cabinetId : next.cabinetId },
      { siteId: current.siteId, cabinetId: current.cabinetId },
    );
    if (next.ownerEmail) await this.assertUser(next.ownerEmail);
    const changes = diffRecord(TRACKED, current as unknown as Record<string, unknown>, next);
    if (!hasChanges(changes)) return current;
    await this.uniqueName(() =>
      this.db.transaction(async (tx) => {
        const set: Partial<typeof diagramTable.$inferInsert> = { updatedAt: new Date() };
        for (const field of TRACKED) {
          if (field in changes) (set as Record<string, unknown>)[field] = changes[field].after;
        }
        await tx.update(diagramTable).set(set).where(eq(diagramTable.id, id));
        await this.record(tx, actor, id, 'updated', 'diagram.updated', changes);
      }),
    );
    return this.node(id);
  }

  async archive(by: { email: string; role: UserRole }, id: string): Promise<void> {
    const actor = by.email;
    const current = await this.node(id);
    assertCanManage(current, by);
    if (current.archivedAt) return;
    await this.db.transaction(async (tx) => {
      const [child] = await tx
        .select({ id: diagramTable.id })
        .from(diagramTable)
        .where(and(eq(diagramTable.parentId, id), isNull(diagramTable.archivedAt)))
        .limit(1);
      if (child) {
        throw new ConflictException({ code: 'DIAGRAM_HAS_CHILDREN', message: 'Bản vẽ còn bản vẽ con — lưu trữ các bản vẽ con trước.' });
      }
      await tx.update(diagramTable).set({ archivedAt: new Date(), archivedBy: actor, updatedAt: new Date() }).where(eq(diagramTable.id, id));
      await this.record(tx, actor, id, 'archived', 'diagram.archived', null);
    });
  }

  private async assertLiveParent(parentId: string): Promise<void> {
    const [parent] = await this.db
      .select({ archivedAt: diagramTable.archivedAt, kind: diagramTable.kind })
      .from(diagramTable)
      .where(eq(diagramTable.id, parentId));
    // Bản trình bày không có nhánh con: cây chính thức không treo dưới một bản không duyệt.
    if (!parent || parent.archivedAt || parent.kind !== 'official') {
      throw new BadRequestException({ code: 'DIAGRAM_PARENT_INVALID', message: 'Bản vẽ cha không tồn tại hoặc đã lưu trữ.' });
    }
  }

  private async assertUser(email: string): Promise<void> {
    if (!(await this.users.roleByEmail(email))) {
      throw new BadRequestException({ code: 'DIAGRAM_OWNER_INVALID', message: 'Người phụ trách không phải tài khoản IMS.' });
    }
  }

  private async descendantIds(id: string): Promise<string[]> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      WITH RECURSIVE sub AS (
        SELECT id FROM diagram WHERE parent_id = ${id}
        UNION SELECT d.id FROM diagram d JOIN sub ON d.parent_id = sub.id
      ) SELECT id FROM sub
    `);
    return rows.map((r) => r.id);
  }

  /** Khoá duy nhất "tên anh em" của DB là trọng tài (hai người tạo cùng lúc), lỗi 23505 thành 409. */
  private async uniqueName<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (pgCode(error) === '23505') {
        throw new ConflictException({ code: 'DIAGRAM_NAME_TAKEN', message: 'Cùng nhánh đã có bản vẽ tên này.' });
      }
      throw error;
    }
  }

  /* ------------------------------------------------------------ trình bày --- */

  /**
   * "Tạo bản trình bày" (Q-23, FR-045): một hàng `diagram` MỚI chép XML phiên bản chính thức hiện
   * hành của bản gốc — bản gốc không đổi gì, không có phiên bản mới. Mọi vai tạo được; bản trình
   * bày không duyệt, nên nó không ảnh hưởng gì tới bản chính thức.
   */
  async createPresentation(actor: string, sourceId: string, input: PresentationInput): Promise<DiagramNode> {
    const [source] = await this.db
      .select({
        name: diagramTable.name,
        nodeType: diagramTable.nodeType,
        kind: diagramTable.kind,
        archivedAt: diagramTable.archivedAt,
        officialVersionId: diagramTable.officialVersionId,
      })
      .from(diagramTable)
      .where(eq(diagramTable.id, sourceId));
    if (!source) throw new NotFoundException({ code: 'DIAGRAM_NOT_FOUND', message: 'Không tìm thấy bản vẽ.' });
    if (source.archivedAt) throw archived();
    if (source.kind !== 'official' || !source.officialVersionId) {
      throw new ConflictException({
        code: 'DIAGRAM_NOT_OFFICIAL',
        message: 'Chỉ nhân bản được từ bản vẽ đã có bản chính thức.',
      });
    }
    const [version] = await this.db.select().from(diagramVersionTable).where(eq(diagramVersionTable.id, source.officialVersionId));
    // Chụp thông tin thiết bị BÂY GIỜ: phiên bản đầu của bản trình bày là một lần lưu mới (AD-14).
    const snapshot = await this.snapshot(version.cellIndex);
    const named = input.name?.trim();
    for (let attempt = 1; ; attempt += 1) {
      const name = named || presentationName(source.name, attempt);
      try {
        const id = await this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(diagramTable)
            .values({
              parentId: null,
              name,
              nodeType: source.nodeType,
              kind: 'presentation',
              sourceDiagramId: sourceId,
              sourceVersionId: version.id,
              ownerEmail: actor,
              createdBy: actor,
            })
            .returning({ id: diagramTable.id });
          await this.record(tx, actor, row.id, 'presentation.created', 'diagram.presentation_created', {
            name,
            sourceDiagramId: sourceId,
            sourceVersionId: version.id,
            sourceSeq: version.seq,
          });
          const diff = diffCellIndex(null, version.cellIndex);
          await this.insertVersion(tx, actor, row.id, {
            seq: 1,
            xml: version.xml,
            svg: version.svg,
            index: version.cellIndex,
            snapshot,
            summary: `Nhân bản từ "${source.name}" bản chính thức phiên bản #${version.seq} · ${summarizeDiff(diff)}`,
            diff,
            basedOnVersionId: null,
            restoredFromVersionId: null,
            history: 'version.saved',
            auditAction: 'diagram.saved',
            bytes: Buffer.byteLength(version.xml),
          });
          return row.id;
        });
        return this.node(id);
      } catch (error) {
        const taken = pgCode(error) === '23505';
        if (taken && !named && attempt < PRESENTATION_NAME_ATTEMPTS) continue;
        if (taken) throw new ConflictException({ code: 'DIAGRAM_NAME_TAKEN', message: 'Đã có bản vẽ tên này.' });
        throw error;
      }
    }
  }

  /* ------------------------------------------------------------- phiên bản --- */

  async versions(diagramId: string): Promise<VersionItem[]> {
    const rows = await this.db
      .select({
        id: diagramVersionTable.id,
        seq: diagramVersionTable.seq,
        summary: diagramVersionTable.summary,
        savedBy: diagramVersionTable.savedBy,
        createdAt: diagramVersionTable.createdAt,
        basedOnVersionId: diagramVersionTable.basedOnVersionId,
        restoredFromVersionId: diagramVersionTable.restoredFromVersionId,
      })
      .from(diagramVersionTable)
      .where(eq(diagramVersionTable.diagramId, diagramId))
      .orderBy(desc(diagramVersionTable.seq))
      .limit(HISTORY_PAGE_LIMIT);
    return this.toItems(diagramId, rows);
  }

  private async toItems(
    diagramId: string,
    rows: {
      id: string;
      seq: number;
      summary: string;
      savedBy: string;
      createdAt: Date;
      basedOnVersionId: string | null;
      restoredFromVersionId: string | null;
    }[],
  ): Promise<VersionItem[]> {
    if (rows.length === 0) return [];
    const labels = await this.latestLabels(rows.map((r) => r.id));
    const names = await this.users.namesByEmails([...new Set(rows.map((r) => r.savedBy.toLowerCase()))]);
    const sourceIds = rows.map((r) => r.restoredFromVersionId).filter((v): v is string => v !== null);
    const seqOf = new Map<string, number>();
    if (sourceIds.length > 0) {
      const sources = await this.db
        .select({ id: diagramVersionTable.id, seq: diagramVersionTable.seq })
        .from(diagramVersionTable)
        .where(and(eq(diagramVersionTable.diagramId, diagramId), inArray(diagramVersionTable.id, sourceIds)));
      for (const s of sources) seqOf.set(s.id, s.seq);
    }
    return rows.map((row) => ({
      id: row.id,
      seq: row.seq,
      summary: row.summary,
      label: labels.get(row.id) ?? null,
      savedBy: row.savedBy,
      savedByName: names.get(row.savedBy.toLowerCase()) ?? null,
      savedAt: row.createdAt.toISOString(),
      basedOnVersionId: row.basedOnVersionId,
      restoredFromSeq: row.restoredFromVersionId ? (seqOf.get(row.restoredFromVersionId) ?? null) : null,
    }));
  }

  private async latestLabels(versionIds: string[]): Promise<Map<string, string | null>> {
    const rows = await this.db
      .selectDistinctOn([diagramVersionLabelTable.versionId], {
        versionId: diagramVersionLabelTable.versionId,
        label: diagramVersionLabelTable.label,
      })
      .from(diagramVersionLabelTable)
      .where(inArray(diagramVersionLabelTable.versionId, versionIds))
      .orderBy(diagramVersionLabelTable.versionId, desc(diagramVersionLabelTable.createdAt), desc(diagramVersionLabelTable.id));
    return new Map(rows.map((r) => [r.versionId, r.label]));
  }

  /**
   * Nội dung để xem hoặc sửa. MỖI lần gọi ghi một dòng `diagram.viewed` (NFR-03): đây là ngoại lệ
   * có chủ ý của nếp "chỉ audit thao tác ghi", cùng loại với audit giải mã két (AD-17).
   */
  async content(actor: string, diagramId: string, options: { mode: 'view' | 'edit'; versionId?: string }): Promise<DiagramContent> {
    const diagram = await this.node(diagramId);
    const conditions = [eq(diagramVersionTable.diagramId, diagramId)];
    if (options.versionId) conditions.push(eq(diagramVersionTable.id, options.versionId));
    const [row] = await this.db
      .select()
      .from(diagramVersionTable)
      .where(and(...conditions))
      .orderBy(desc(diagramVersionTable.seq))
      .limit(1);
    if (options.versionId && !row) {
      throw new NotFoundException({ code: 'DIAGRAM_VERSION_NOT_FOUND', message: 'Không tìm thấy phiên bản này của bản vẽ.' });
    }
    await this.db.transaction((tx) =>
      this.audit.appendWithin(tx, {
        actor,
        action: 'diagram.viewed',
        objectType: 'diagram',
        objectId: diagramId,
        detail: { versionId: row?.id ?? null, seq: row?.seq ?? null, mode: options.mode },
      }),
    );
    if (!row) {
      return {
        diagram,
        version: null,
        deviceCells: [],
        devices: [],
        cableEdges: [],
        links: [],
        undrawnLinkIds: [],
        externalLinkIds: [],
        cableTypes: await this.cableTypeInfos(),
        frames: [],
        layers: [],
        cells: [],
      };
    }
    const [item] = await this.toItems(diagramId, [row]);
    const deviceCells = row.cellIndex.cells
      .filter((cell) => cell.kind === 'device' && cell.deviceId)
      .map((cell) => ({ cellId: cell.id, deviceId: cell.deviceId!, code: cell.ims.ims_device_code ?? '' }));
    // Ảnh thật chỉ nhúng vào XML nạp trình vẽ (chế độ Xem dùng ảnh SVG chụp lúc lưu), và chỉ mặt
    // nào có ô chọn hiện nó — không đọc ảnh của mọi máy mỗi lần mở.
    const photoNeeds = options.mode === 'edit' ? photoNeedsOf(row.cellIndex) : new Map<string, Set<PhotoSide>>();
    const [{ infos: devices, sources }, cables, frames] = await Promise.all([
      this.deviceData(
        deviceCells.map((c) => c.deviceId),
        photoNeeds,
      ),
      this.cableData(row.cellIndex),
      this.framesOf(row.cellIndex),
    ]);
    // Sửa: nạp trình vẽ XML đã hydrate (hình theo loại, nhãn từ kho hiện tại, nhãn cổng + ô màu dây
    // theo sơ đồ cổng hiện tại — AD-18). Xem: ảnh SVG chụp lúc lưu, XML để nguyên; màu dây và nét
    // đỏ/vàng trình xem tô lại theo `cableEdges` + `links`.
    const xml = options.mode === 'edit' ? hydrateDiagramXml(row.xml, sources, { links: cables.check, slots: cables.slots }) : row.xml;
    return {
      diagram,
      version: { ...item, xml, svg: row.svg, deviceSnapshot: row.deviceSnapshot },
      deviceCells,
      devices,
      cableEdges: cables.edges,
      links: cables.links,
      undrawnLinkIds: cables.undrawn,
      externalLinkIds: cables.external,
      cableTypes: cables.cableTypes,
      frames,
      layers: layerNames(row.xml),
      cells: row.cellIndex.cells.map((cell) => ({ id: cell.id, kind: cell.kind, layer: cell.layer, bounds: cell.bounds ?? null })),
    };
  }

  /* ------------------------------------------------------------------ khung --- */

  /** Khung của một chỉ mục ô + bản vẽ con của chúng, đọc MỘT lượt (kể cả bản vẽ đã lưu trữ). */
  private async framesOf(index: CellIndex): Promise<DiagramFrame[]> {
    const refs = frameRefs(index);
    const childIds = [...new Set(refs.map((r) => r.childDiagramId).filter((id): id is string => Boolean(id && UUID_RE.test(id))))];
    const children =
      childIds.length === 0
        ? []
        : await this.db
            .select({ id: diagramTable.id, name: diagramTable.name, archivedAt: diagramTable.archivedAt, kind: diagramTable.kind })
            .from(diagramTable)
            .where(inArray(diagramTable.id, childIds));
    const byId = new Map(children.map((c) => [c.id, { id: c.id, name: c.name, archived: c.archivedAt !== null, kind: c.kind }]));
    return refs.map((ref) => ({ ...ref, child: ref.childDiagramId ? (byId.get(ref.childDiagramId) ?? null) : null }));
  }

  /**
   * Khung GẮN MỚI ở lần lưu này phải trỏ vào thứ dùng được (AD-17: XML là dữ liệu không tin cậy —
   * web chỉ mời chọn thứ đúng, server mới là cổng). Bản vẽ con: nằm dưới bản vẽ này trên cây, chưa
   * lưu trữ, không phải bản trình bày; dải IP / tủ: có thật và chưa ngừng dùng (Q-14 — không chọn
   * MỚI một mục ngừng dùng). Khung đã có từ bản trước thì không kiểm lại (`introducedRefs`).
   */
  private async assertFrames(diagramId: string, index: CellIndex): Promise<void> {
    const [latest] = await this.db
      .select({ cellIndex: diagramVersionTable.cellIndex })
      .from(diagramVersionTable)
      .where(eq(diagramVersionTable.diagramId, diagramId))
      .orderBy(desc(diagramVersionTable.seq))
      .limit(1);
    const fresh = introducedRefs(latest?.cellIndex ?? null, index);
    const reasons: string[] = [];
    if (fresh.childDiagramIds.length > 0) {
      const valid = fresh.childDiagramIds.filter((id) => UUID_RE.test(id));
      const [rows, below] = await Promise.all([
        valid.length === 0
          ? Promise.resolve([])
          : this.db
              .select({ id: diagramTable.id, name: diagramTable.name, archivedAt: diagramTable.archivedAt, kind: diagramTable.kind })
              .from(diagramTable)
              .where(inArray(diagramTable.id, valid)),
        this.descendantIds(diagramId),
      ]);
      const inBranch = new Set(below);
      const byId = new Map(rows.map((r) => [r.id, { id: r.id, name: r.name, archived: r.archivedAt !== null, kind: r.kind, inBranch: inBranch.has(r.id) }]));
      for (const id of fresh.childDiagramIds) {
        const reason = childLinkReason(id, byId.get(id));
        if (reason) reasons.push(reason);
      }
    }
    if (fresh.subnetIds.length > 0) {
      const subnets = await this.ipam.subnetsByIds(fresh.subnetIds.filter((id) => UUID_RE.test(id)));
      for (const id of fresh.subnetIds) {
        const subnet = subnets.get(id);
        if (!subnet) reasons.push(`Dải IP gắn trên khung (${id}) không tồn tại.`);
        else if (subnet.voidedAt) reasons.push(`Dải ${subnet.cidr} đã ngừng dùng — không gắn khung mới vào nó.`);
      }
    }
    if (fresh.cabinetIds.length > 0) {
      const cabinets = await this.catalog.cabinetsByIds(fresh.cabinetIds);
      for (const id of fresh.cabinetIds) {
        const cabinet = cabinets.get(id);
        if (!cabinet) reasons.push(`Tủ gắn trên khung (${id}) không tồn tại.`);
        else if (!cabinet.active) reasons.push(`Tủ ${cabinet.code} đã ngừng dùng — không gắn khung mới vào nó.`);
      }
    }
    if (reasons.length > 0) throw new BadRequestException({ code: 'DIAGRAM_FRAME_INVALID', message: reasons.join(' ') });
  }

  /**
   * Khung tủ dựng sẵn để chèn: mọi máy còn dùng đang gắn tủ (qua `devices.api`, bỏ máy thanh lý),
   * ô máy cùng luật với hộp "Thiết bị kho". Máy gắn thêm vào tủ SAU khi chèn không tự vào bản vẽ —
   * đó là việc của cảnh báo lệch kho.
   */
  async cabinetFrame(cabinetId: string): Promise<CabinetFrame> {
    const cabinet = (await this.catalog.cabinetsByIds([cabinetId])).get(cabinetId);
    if (!cabinet) throw new NotFoundException({ code: 'CABINET_NOT_FOUND', message: 'Không tìm thấy tủ này.' });
    const page = await this.devices.listUsableIn({ cabinetId }, DEVICE_INFO_MAX_IDS + 1);
    if (page.total > DEVICE_INFO_MAX_IDS) {
      throw new BadRequestException({ code: 'DIAGRAM_CABINET_TOO_MANY', message: `Tủ có ${page.total} thiết bị — quá nhiều để dựng một khung tủ.` });
    }
    const ids = page.items.map((d) => d.id);
    const { infos, sources } = await this.deviceData(ids, new Map(ids.map((id) => [id, new Set<PhotoSide>(['front', 'back'])])));
    const devices = infos
      .filter((info) => info.found && info.status !== 'retired' && info.code)
      .map((info): CabinetFrameDevice => {
        const source = sources.get(info.id)!;
        const faces: CabinetFrameDevice['faces'] = {};
        for (const side of ['front', 'back'] as const) {
          if (source.photos?.[side]) faces[side] = { style: `align=center;${deviceLookStyle(source, side)}` };
        }
        return { id: info.id, code: info.code!, u: info.u, uSize: info.uSize, cell: info.cell, faces };
      });
    // Mặt trước / mặt sau là hai khung cạnh nhau: máy xếp đúng U ở cả hai, mỗi mặt ảnh của mặt đó.
    return {
      cabinet: { id: cabinet.id, code: cabinet.code, siteCode: cabinet.siteCode, uHeight: cabinet.uHeight, active: cabinet.active },
      layout: cabinetFrameLayout({ cabinet: { id: cabinet.id, code: cabinet.code, uHeight: cabinet.uHeight }, devices }, { sides: ['front', 'back'] }),
    };
  }

  /**
   * "Dựng lại mặt tủ" (bản vẽ loại tủ): một phiên bản nháp MỚI chỉ gồm khung tủ dựng từ kho — mặt
   * trước + mặt sau xếp đúng U, máy chưa khai U ở cột "Chưa khai U". Không xoá gì: phiên bản cũ còn
   * nguyên để khôi phục; không ghi gì vào kho.
   */
  async rebuildRack(actor: string, diagramId: string): Promise<VersionItem> {
    const node = await this.node(diagramId);
    if (node.nodeType !== 'cabinet' || !node.cabinetId) {
      throw new BadRequestException({
        code: 'DIAGRAM_NOT_CABINET',
        message: 'Chỉ bản vẽ loại "Tủ rack" có gắn tủ mới dựng lại mặt tủ được — gắn tủ cho bản vẽ ở cây bản vẽ trước.',
      });
    }
    const frame = await this.cabinetFrame(node.cabinetId);
    const xml = dehydrateDiagramXml(buildRackXml(frame.layout));
    const index = buildCellIndex(xml);
    const snapshot = await this.snapshot(index);
    const id = await this.db.transaction(async (tx) => {
      await this.lockLive(tx, diagramId);
      const latest = await this.latestWithin(tx, diagramId);
      const diff = diffCellIndex(latest?.cellIndex ?? null, index);
      return this.insertVersion(tx, actor, diagramId, {
        seq: (latest?.seq ?? 0) + 1,
        xml,
        svg: null,
        index,
        snapshot,
        summary: `Dựng lại mặt tủ ${frame.cabinet.code} · ${summarizeDiff(diff)}`,
        diff,
        basedOnVersionId: latest?.id ?? null,
        restoredFromVersionId: null,
        history: 'version.saved',
        auditAction: 'diagram.saved',
        bytes: Buffer.byteLength(xml),
      });
    });
    return this.versionItem(diagramId, id);
  }

  /**
   * Phần style IMS của "Biểu tượng" và "Ảnh thật" (từng mặt) cho nhiều máy — công tắc trên màn sửa.
   * Ảnh nhúng sẵn (data URI đã thu nhỏ) vì trình vẽ chạy trong iframe sandbox không có cookie phiên:
   * đường dẫn ảnh cần đăng nhập không tải được ở đó.
   */
  async deviceLooks(ids: string[]): Promise<{ imsStyleKeys: string[]; items: DeviceLook[] }> {
    const unique = [...new Set(ids)];
    const { infos, sources } = await this.deviceData(unique, new Map(unique.map((id) => [id, new Set<PhotoSide>(['front', 'back'])])));
    const items = infos.map((info): DeviceLook => {
      const source = sources.get(info.id) ?? missingSource('');
      const face = (side: PhotoSide) => {
        const photo = source.photos?.[side];
        return photo ? { style: deviceLookStyle(source, side), fileId: photo.fileId } : null;
      };
      return { id: info.id, found: info.found, icon: deviceLookStyle(source), front: face('front'), back: face('back') };
    });
    return { imsStyleKeys: [...IMS_STYLE_KEYS], items };
  }

  /** Thẻ khung VLAN: đọc qua `ipam.api`, kể cả dải đã ngừng dùng. */
  async subnetInfo(subnetId: string): Promise<SubnetSummary> {
    const summary = await this.ipam.subnetSummary(subnetId, SUBNET_FREE_PREVIEW);
    if (!summary) throw new NotFoundException({ code: 'SUBNET_NOT_FOUND', message: 'Không tìm thấy dải này.' });
    return summary;
  }

  /* -------------------------------------------------- dây ↔ sơ đồ cổng --- */

  /**
   * Dòng sơ đồ cổng của mọi nét mang `ims_link_id` — bộ tự kiểm (gửi duyệt/phát hành, lệch kho)
   * gọi cái này rồi chạy `checkCables`. Dòng đã gỡ thì vắng mặt. CHỈ ĐỌC qua `devices.api`.
   */
  async loadCheckLinks(index: CellIndex): Promise<Map<string, CheckLink>> {
    const links = await this.devices.portLinks(linkIdsOf(index));
    return new Map([...links].map(([id, link]) => [id, toCheckLink(link)]));
  }

  /** Dòng sơ đồ cổng theo id (thẻ dây, nét vừa khai, kết nối vừa nối hàng loạt). Dòng đã gỡ thì vắng. */
  async links(ids: string[]): Promise<DiagramLink[]> {
    const valid = [...new Set(ids)].filter((id) => UUID_RE.test(id));
    const [found, slots] = await Promise.all([this.devices.portLinks(valid), this.cableSlots()]);
    return valid.flatMap((id) => {
      const link = found.get(id);
      return link ? [toDiagramLink(link, slots)] : [];
    });
  }

  /**
   * Trạng thái dây trên XML ĐANG VẼ (màn sửa gửi lên sau khi chèn máy): cùng luật với lúc mở,
   * nên "Có N kết nối mới chưa vẽ" tính cả máy vừa chèn. Chỉ đọc, không lưu gì. XML vẫn là dữ liệu
   * không tin cậy: qua cổng kiểm như lúc lưu.
   */
  async cableStatus(xml: string): Promise<{ edges: CableEdge[]; undrawn: DiagramLink[] }> {
    const [xmlMaxKb, maxCells, svgMaxKb] = await Promise.all([
      this.config.getNumber('diagramXmlMaxKb'),
      this.config.getNumber('diagramMaxCells'),
      this.config.getNumber('diagramSvgMaxKb'),
    ]);
    const gate = checkDiagramXml(xml, { xmlMaxKb: wetXmlLimitKb(xmlMaxKb, svgMaxKb), maxCells });
    if (gate.reason) throw new BadRequestException({ code: 'DIAGRAM_XML_INVALID', message: gate.reason });
    const cables = await this.cableData(buildCellIndex(xml));
    const undrawn = new Set(cables.undrawn);
    return { edges: cables.edges, undrawn: cables.links.filter((l) => undrawn.has(l.id)) };
  }

  /**
   * "Dựng nháp từ sơ đồ cổng" (FR-048): một phiên bản MỚI chỉ có máy (lưới) + dây đã gắn kết nối.
   * Không ghi sơ đồ cổng; không có ảnh xem tới khi người vẽ mở Sửa, xếp gọn và lưu.
   */
  async draftFromPortMap(actor: string, diagramId: string, scope: DraftScope): Promise<VersionItem> {
    const max = await this.config.getNumber('diagramAutolayoutMaxNodes');
    let ids: string[];
    if (scope.deviceIds && scope.deviceIds.length > 0) {
      ids = [...new Set(scope.deviceIds)].filter((id) => UUID_RE.test(id));
    } else if (scope.cabinetId || scope.siteId) {
      const page = await this.devices.listUsableIn({ siteId: scope.siteId, cabinetId: scope.cabinetId }, max + 1);
      if (page.total > max) throw tooMany(page.total, max);
      ids = page.items.map((d) => d.id);
    } else {
      throw new BadRequestException({ code: 'DIAGRAM_AUTOLAYOUT_SCOPE', message: 'Chọn một site, một tủ hoặc danh sách máy để dựng nháp.' });
    }
    if (ids.length > max) throw tooMany(ids.length, max);
    const { infos } = await this.deviceData(ids);
    const usable = infos.filter((info) => info.found && info.status !== 'retired' && info.code);
    if (usable.length === 0) {
      throw new BadRequestException({ code: 'DIAGRAM_AUTOLAYOUT_EMPTY', message: 'Phạm vi đã chọn không có thiết bị nào còn dùng.' });
    }
    const [touching, slots] = await Promise.all([this.devices.portLinksTouching(usable.map((d) => d.id)), this.cableSlots()]);
    const xml = dehydrateDiagramXml(
      buildDraftXml(
        usable.map((d) => ({ id: d.id, code: d.code!, cell: d.cell })),
        touching.map(toCheckLink),
        slots,
      ),
    );
    const index = buildCellIndex(xml);
    const snapshot = await this.snapshot(index);
    const id = await this.db.transaction(async (tx) => {
      await this.lockLive(tx, diagramId);
      const latest = await this.latestWithin(tx, diagramId);
      const diff = diffCellIndex(latest?.cellIndex ?? null, index);
      return this.insertVersion(tx, actor, diagramId, {
        seq: (latest?.seq ?? 0) + 1,
        xml,
        svg: null,
        index,
        snapshot,
        summary: `Dựng nháp từ sơ đồ cổng · ${summarizeDiff(diff)}`,
        diff,
        basedOnVersionId: latest?.id ?? null,
        restoredFromVersionId: null,
        history: 'version.saved',
        auditAction: 'diagram.saved',
        bytes: Buffer.byteLength(xml),
      });
    });
    return this.versionItem(diagramId, id);
  }

  /**
   * Dữ liệu dây của một chỉ mục ô, MỘT lượt: dòng của mọi nét + mọi dòng chạm máy có trên bản vẽ
   * (đọc qua `devices.api`), ô màu loại dây (`catalog.api`), rồi chạy bộ luật `diagram-checks.ts`.
   */
  private async cableData(index: CellIndex) {
    const deviceIds = [...new Set(index.cells.map((c) => c.deviceId).filter((id): id is string => Boolean(id && UUID_RE.test(id))))];
    const [byId, touching, types] = await Promise.all([
      this.devices.portLinks(linkIdsOf(index)),
      this.devices.portLinksTouching(deviceIds),
      this.catalog.cableTypes(),
    ]);
    const all = new Map(byId);
    for (const link of touching) all.set(link.id, link);
    const slots = new Map(types.map((t) => [t.id, t.colorSlot]));
    const check = new Map([...all].map(([id, link]) => [id, toCheckLink(link)]));
    const checkList = [...check.values()];
    return {
      check,
      slots,
      links: [...all.values()].map((link) => toDiagramLink(link, slots)),
      edges: cableEdgeStates(index.cells, check),
      undrawn: undrawnLinks(index.cells, checkList).map((l) => l.id),
      external: externalLinks(index.cells, checkList).map((l) => l.id),
      cableTypes: types.map((t) => ({ id: t.id, name: t.name, colorSlot: t.colorSlot, active: t.active })),
    };
  }

  private async cableSlots(): Promise<Map<string, number>> {
    return new Map((await this.catalog.cableTypes()).map((t) => [t.id, t.colorSlot]));
  }

  private async cableTypeInfos(): Promise<CableTypeInfo[]> {
    return (await this.catalog.cableTypes()).map((t) => ({ id: t.id, name: t.name, colorSlot: t.colorSlot, active: t.active }));
  }

  /**
   * Thông tin hiện tại của nhiều máy MỘT lượt: thẻ thông tin, ô chèn, hydrate. Đọc qua public api
   * (`devices`, `ipam`, `catalog` — AD-2); id không phải UUID hoặc không còn trong kho thành
   * `found: false` thay vì lỗi, vì bản vẽ là dữ liệu không tin cậy và máy có thể đã bị xoá.
   */
  async deviceInfos(ids: string[]): Promise<DiagramDeviceInfo[]> {
    return (await this.deviceData(ids)).infos;
  }

  /**
   * Thông tin máy + nguồn hydrate cùng một lượt đọc. Máy không còn trong kho KHÔNG vào `sources`:
   * hydrate tự dựng ô "Không tìm thấy trong kho" từ `ims_device_code` của chính ô đó.
   */
  private async deviceData(
    ids: string[],
    /** Mặt ảnh thật cần nhúng của từng máy (hydrate / khung tủ / công tắc); vắng = không đọc ảnh. */
    photoNeeds: Map<string, Set<PhotoSide>> = new Map(),
  ): Promise<{ infos: DiagramDeviceInfo[]; sources: Map<string, DeviceCellSource> }> {
    const unique = [...new Set(ids)];
    const sources = new Map<string, DeviceCellSource>();
    if (unique.length === 0) return { infos: [], sources };
    const valid = unique.filter((id) => UUID_RE.test(id));
    const [devices, ips, photoFiles] = await Promise.all([
      this.devices.getByIds(valid),
      this.ipam.heldAddressesOf(valid),
      this.devices.photoSources(valid),
    ]);
    const found = [...devices.values()];
    const [looks, photos, vendors, cabinets] = await Promise.all([
      this.catalog.diagramLooks(found.map((d) => d.deviceTypeId)),
      this.photoUris(photoFiles, photoNeeds),
      this.catalog.vendorsByIds(found.flatMap((d) => (d.vendorId ? [d.vendorId] : []))),
      this.catalog.cabinetsByIds(found.flatMap((d) => (d.cabinetId ? [d.cabinetId] : []))),
    ]);
    const infos = unique.map((id): DiagramDeviceInfo => {
      const device = devices.get(id);
      if (!device) return { ...emptyInfo(id), cell: deviceInsertCell(missingSource('')) };
      const look = looks.get(device.deviceTypeId);
      const vendor = device.vendorId ? vendors.get(device.vendorId) : undefined;
      const info: Omit<DiagramDeviceInfo, 'cell'> = {
        id,
        found: true,
        code: device.code,
        name: device.name,
        deviceTypeName: device.deviceTypeName,
        model: device.model,
        serial: device.serial,
        status: device.status,
        ips: ips.get(id) ?? [],
        siteCode: device.siteCode,
        cabinetCode: device.cabinetCode,
        u: device.rackUStart,
        uSize: device.rackUSize,
        vendorName: vendor?.name ?? device.vendorName,
        vendorPhone: vendor?.phone ?? null,
        warrantyEnd: device.warrantyEnd,
        photos: { front: Boolean(photoFiles.get(id)?.front), back: Boolean(photoFiles.get(id)?.back) },
      };
      const height = device.cabinetId ? (cabinets.get(device.cabinetId)?.uHeight ?? null) : null;
      const source: DeviceCellSource = {
        ...sourceOf(info, look ?? null),
        rackWarning: rackOverflow(device.rackUStart, device.rackUSize, device.cabinetCode, height),
        photos: photos.get(id),
      };
      sources.set(id, source);
      return { ...info, cell: deviceInsertCell(source) };
    });
    return { infos, sources };
  }

  /**
   * Ảnh thật cần nhúng → data URI (đã thu nhỏ qua `devices.api`). Ảnh hỏng/mất thì vắng mặt: ô đó
   * rơi về biểu tượng loại, không làm hỏng cả bản vẽ.
   */
  private async photoUris(
    files: Map<string, { front: string | null; back: string | null }>,
    needs: Map<string, Set<PhotoSide>>,
  ): Promise<Map<string, Partial<Record<PhotoSide, DevicePhoto>>>> {
    const wanted = new Map<string, { deviceId: string; side: PhotoSide }[]>();
    for (const [deviceId, sides] of needs) {
      for (const side of sides) {
        const fileId = files.get(deviceId)?.[side];
        if (fileId) wanted.set(fileId, [...(wanted.get(fileId) ?? []), { deviceId, side }]);
      }
    }
    const out = new Map<string, Partial<Record<PhotoSide, DevicePhoto>>>();
    const entries = [...wanted];
    const images = await mapWithLimit(entries, PHOTO_LOAD_CONCURRENCY, ([fileId]) => this.devices.photoImage(fileId));
    entries.forEach(([fileId, targets], i) => {
      const image = images[i];
      if (!image) return;
      const uri = photoDataUri(image.mime, image.bytes);
      for (const { deviceId, side } of targets) out.set(deviceId, { ...out.get(deviceId), [side]: { fileId, uri } });
    });
    return out;
  }

  /**
   * Bản vẽ chính thức (chưa lưu trữ) có máy này ở phiên bản MỚI NHẤT — bản trình bày là bản sao
   * để trình nội bộ, liệt kê nó chỉ làm nhiễu. Thẻ thông tin "Có mặt trong các bản vẽ" và trang thiết bị (web gọi, AD-18: không module nào import `diagrams`). Chỉ tên + id: đây
   * là thông tin của cây, không phải nội dung bản vẽ.
   */
  async diagramsWithDevice(deviceId: string): Promise<DiagramRef[]> {
    return (await this.diagramsWithDevices([deviceId])).get(deviceId) ?? [];
  }

  /**
   * `diagramsWithDevice` cho nhiều máy MỘT câu — tìm máy / chỉ đường trên sơ đồ dùng cái này. Một
   * luật cho cả hai nơi: hai câu SQL riêng là hai thứ tự, hai cách hiểu "phiên bản mới nhất".
   */
  async diagramsWithDevices(deviceIds: string[]): Promise<Map<string, DiagramRef[]>> {
    const out = new Map<string, DiagramRef[]>();
    const ids = [...new Set(deviceIds)].filter((id) => UUID_RE.test(id));
    if (ids.length === 0) return out;
    const { rows } = await this.db.execute<{ device_id: string; id: string; name: string }>(sql`
      SELECT DISTINCT c.value ->> 'deviceId' AS device_id, d.id, d.name, lower(d.name) AS sort_name
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
       ORDER BY sort_name, d.id
    `);
    for (const row of rows) out.set(row.device_id, [...(out.get(row.device_id) ?? []), { id: row.id, name: row.name }]);
    return out;
  }

  async changes(diagramId: string, versionId: string): Promise<CellDiff> {
    const [row] = await this.db
      .select({ detail: diagramVersionTable.summaryDetail })
      .from(diagramVersionTable)
      .where(and(eq(diagramVersionTable.diagramId, diagramId), eq(diagramVersionTable.id, versionId)));
    if (!row) throw new NotFoundException({ code: 'DIAGRAM_VERSION_NOT_FOUND', message: 'Không tìm thấy phiên bản này của bản vẽ.' });
    return row.detail;
  }

  /**
   * Lưu = một phiên bản MỚI (Q-23: hai người cùng sửa thì bản lưu sau thắng). Khoá hàng `diagram`
   * trong tx để các lượt lưu cùng lúc xếp hàng: số thứ tự đọc-rồi-cộng không đâm khoá duy nhất,
   * và tóm tắt luôn so với đúng bản đứng ngay trước nó.
   */
  async save(actor: string, diagramId: string, input: SaveInput): Promise<VersionItem> {
    const [xmlMaxKb, maxCells, svgMaxKb] = await Promise.all([
      this.config.getNumber('diagramXmlMaxKb'),
      this.config.getNumber('diagramMaxCells'),
      this.config.getNumber('diagramSvgMaxKb'),
    ]);
    const gate = checkDiagramXml(input.xml, { xmlMaxKb: wetXmlLimitKb(xmlMaxKb, svgMaxKb), maxCells });
    if (gate.reason) throw new BadRequestException({ code: 'DIAGRAM_XML_INVALID', message: gate.reason });
    const svg = sanitizeDiagramSvg(input.svg, { svgMaxKb });
    if (svg.reason) throw new BadRequestException({ code: 'DIAGRAM_SVG_INVALID', message: svg.reason });
    // Lưu "khô" (AD-18): hình/nhãn/dấu/ảnh IMS dựng lại từ kho mỗi lần mở, không đóng băng vào phiên bản.
    const xml = dehydrateDiagramXml(input.xml);
    const dryTooBig = sizeReason(xml, xmlMaxKb, 'Bản vẽ');
    if (dryTooBig) throw new BadRequestException({ code: 'DIAGRAM_XML_INVALID', message: dryTooBig });
    const index = buildCellIndex(xml);
    const secret = secretLabelReason(index);
    if (secret) throw new BadRequestException({ code: 'DIAGRAM_LABEL_SECRET', message: secret });
    await this.assertFrames(diagramId, index);
    const snapshot = await this.snapshot(index);

    const id = await this.db.transaction(async (tx) => {
      const kind = await this.lockLive(tx, diagramId);
      const planned = plannedNotAllowedReason(index, kind);
      if (planned) throw new BadRequestException({ code: 'DIAGRAM_PLANNED_NOT_ALLOWED', message: planned });
      const latest = await this.latestWithin(tx, diagramId);
      if (input.basedOnVersionId && !(await this.belongs(tx, diagramId, input.basedOnVersionId))) {
        throw new BadRequestException({ code: 'DIAGRAM_VERSION_NOT_FOUND', message: 'Phiên bản gốc không thuộc bản vẽ này.' });
      }
      const diff = diffCellIndex(latest?.cellIndex ?? null, index);
      let summary = summarizeDiff(diff);
      if (latest && input.basedOnVersionId !== latest.id) {
        const names = await this.users.namesByEmails([latest.savedBy.toLowerCase()]);
        summary += ` · lưu đè lên bản của ${names.get(latest.savedBy.toLowerCase()) ?? latest.savedBy}`;
      }
      return this.insertVersion(tx, actor, diagramId, {
        seq: (latest?.seq ?? 0) + 1,
        xml,
        svg: svg.value,
        index,
        snapshot,
        summary,
        diff,
        basedOnVersionId: input.basedOnVersionId,
        restoredFromVersionId: null,
        history: 'version.saved',
        auditAction: 'diagram.saved',
        bytes: Buffer.byteLength(xml),
      });
    });
    return this.versionItem(diagramId, id);
  }

  /** Khôi phục = phiên bản MỚI chép XML của bản được chọn (không xoá, không sửa gì). */
  async restore(actor: string, diagramId: string, versionId: string): Promise<VersionItem> {
    const id = await this.db.transaction((tx) => this.restoreWithin(tx, actor, diagramId, versionId));
    return this.versionItem(diagramId, id);
  }

  /**
   * Khôi phục trong `tx` của nơi gọi — "khôi phục bản chính thức cũ" khôi phục rồi phát hành
   * trong CÙNG transaction, để không bao giờ còn lại một phiên bản khôi phục mà chưa phát hành.
   * Trả id phiên bản mới.
   */
  async restoreWithin(tx: Tx, actor: string, diagramId: string, versionId: string): Promise<string> {
    const [source] = await tx
      .select()
      .from(diagramVersionTable)
      .where(and(eq(diagramVersionTable.diagramId, diagramId), eq(diagramVersionTable.id, versionId)));
    if (!source) throw new NotFoundException({ code: 'DIAGRAM_VERSION_NOT_FOUND', message: 'Không tìm thấy phiên bản này của bản vẽ.' });
    // Chụp lại thông tin thiết bị BÂY GIỜ: bản khôi phục là một lần lưu mới (AD-14).
    const snapshot = await this.snapshot(source.cellIndex);
    await this.lockLive(tx, diagramId);
    const latest = await this.latestWithin(tx, diagramId);
    const diff = diffCellIndex(latest?.cellIndex ?? null, source.cellIndex);
    return this.insertVersion(tx, actor, diagramId, {
      seq: (latest?.seq ?? 0) + 1,
      xml: source.xml,
      svg: source.svg,
      index: source.cellIndex,
      snapshot,
      summary: `Khôi phục từ phiên bản #${source.seq} · ${summarizeDiff(diff)}`,
      diff,
      basedOnVersionId: latest?.id ?? null,
      restoredFromVersionId: source.id,
      history: 'version.restored',
      auditAction: 'diagram.version_restored',
      bytes: Buffer.byteLength(source.xml),
    });
  }

  /** Tên phiên bản: người lưu phiên bản đó, hoặc Admin/SA. Tên mới nhất thắng; `null` = bỏ tên. */
  async label(actor: { email: string; role: UserRole }, diagramId: string, versionId: string, label: string | null): Promise<void> {
    const [version] = await this.db
      .select({ savedBy: diagramVersionTable.savedBy, seq: diagramVersionTable.seq })
      .from(diagramVersionTable)
      .where(and(eq(diagramVersionTable.diagramId, diagramId), eq(diagramVersionTable.id, versionId)));
    if (!version) throw new NotFoundException({ code: 'DIAGRAM_VERSION_NOT_FOUND', message: 'Không tìm thấy phiên bản này của bản vẽ.' });
    if (actor.role === 'member' && version.savedBy.toLowerCase() !== actor.email.toLowerCase()) {
      throw new ForbiddenException({ code: 'DIAGRAM_LABEL_FORBIDDEN', message: 'Chỉ người lưu phiên bản này hoặc Admin đặt tên được.' });
    }
    const text = label?.trim() ? label.trim() : null;
    await this.db.transaction(async (tx) => {
      await tx.insert(diagramVersionLabelTable).values({ diagramId, versionId, label: text, actor: actor.email });
      await this.record(tx, actor.email, diagramId, 'version.labeled', 'diagram.version_labeled', { versionId, seq: version.seq, label: text });
    });
  }

  async history(diagramId: string) {
    const rows = await this.db
      .select()
      .from(diagramHistoryTable)
      .where(eq(diagramHistoryTable.diagramId, diagramId))
      .orderBy(desc(diagramHistoryTable.createdAt), desc(diagramHistoryTable.id))
      .limit(HISTORY_PAGE_LIMIT);
    return withActorNames(rows, (emails) => this.users.namesByEmails(emails));
  }

  /** Khoá hàng `diagram` (bản sống) trong `tx`; trả loại bản vẽ cho luật phụ thuộc loại. */
  private async lockLive(tx: Tx, diagramId: string): Promise<'official' | 'presentation'> {
    const [row] = await tx
      .select({ archivedAt: diagramTable.archivedAt, kind: diagramTable.kind })
      .from(diagramTable)
      .where(eq(diagramTable.id, diagramId))
      .for('update');
    if (!row) throw new NotFoundException({ code: 'DIAGRAM_NOT_FOUND', message: 'Không tìm thấy bản vẽ.' });
    if (row.archivedAt) throw archived();
    return row.kind;
  }

  private async latestWithin(tx: Tx, diagramId: string) {
    const [row] = await tx
      .select({
        id: diagramVersionTable.id,
        seq: diagramVersionTable.seq,
        cellIndex: diagramVersionTable.cellIndex,
        savedBy: diagramVersionTable.savedBy,
      })
      .from(diagramVersionTable)
      .where(eq(diagramVersionTable.diagramId, diagramId))
      .orderBy(desc(diagramVersionTable.seq))
      .limit(1);
    return row ?? null;
  }

  private async belongs(tx: Tx, diagramId: string, versionId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: diagramVersionTable.id })
      .from(diagramVersionTable)
      .where(and(eq(diagramVersionTable.diagramId, diagramId), eq(diagramVersionTable.id, versionId)));
    return Boolean(row);
  }

  private async insertVersion(
    tx: Tx,
    actor: string,
    diagramId: string,
    v: {
      seq: number;
      xml: string;
      svg: string | null;
      index: CellIndex;
      snapshot: DeviceSnapshotEntry[];
      summary: string;
      diff: CellDiff;
      basedOnVersionId: string | null;
      restoredFromVersionId: string | null;
      history: string;
      auditAction: string;
      bytes: number;
    },
  ): Promise<string> {
    const [row] = await tx
      .insert(diagramVersionTable)
      .values({
        diagramId,
        seq: v.seq,
        xml: v.xml,
        svg: v.svg,
        cellIndex: v.index,
        deviceSnapshot: v.snapshot,
        summary: v.summary,
        summaryDetail: v.diff,
        basedOnVersionId: v.basedOnVersionId,
        restoredFromVersionId: v.restoredFromVersionId,
        savedBy: actor,
      })
      .returning({ id: diagramVersionTable.id });
    await tx.update(diagramTable).set({ updatedAt: new Date() }).where(eq(diagramTable.id, diagramId));
    // Nhật ký ghi KÍCH THƯỚC + tóm tắt, không chép XML: audit_log không xoá được.
    await this.record(tx, actor, diagramId, v.history, v.auditAction, {
      versionId: row.id,
      seq: v.seq,
      summary: v.summary,
      bytes: v.bytes,
    });
    return row.id;
  }

  private async versionItem(diagramId: string, versionId: string): Promise<VersionItem> {
    const rows = await this.db
      .select({
        id: diagramVersionTable.id,
        seq: diagramVersionTable.seq,
        summary: diagramVersionTable.summary,
        savedBy: diagramVersionTable.savedBy,
        createdAt: diagramVersionTable.createdAt,
        basedOnVersionId: diagramVersionTable.basedOnVersionId,
        restoredFromVersionId: diagramVersionTable.restoredFromVersionId,
      })
      .from(diagramVersionTable)
      .where(eq(diagramVersionTable.id, versionId));
    const [item] = await this.toItems(diagramId, rows);
    return item;
  }

  /**
   * Thông tin thiết bị lúc lưu cho mọi `ims_device_id` trên bản vẽ (AD-14): 1–2 năm sau máy đã
   * đổi IP, đổi tủ hay thanh lý thì phiên bản cũ vẫn nói đúng lúc đó nó là gì.
   */
  private async snapshot(index: CellIndex): Promise<DeviceSnapshotEntry[]> {
    const ids = [...new Set(index.cells.map((c) => c.deviceId).filter((id): id is string => Boolean(id)))];
    if (ids.length === 0) return [];
    const valid = ids.filter((id) => UUID_RE.test(id));
    const [devices, ips, links] = await Promise.all([
      this.devices.getByIds(valid),
      this.ipam.heldAddressesOf(valid),
      this.devices.portLinks(linkIdsOf(index)),
    ]);
    // Cổng của từng máy trên các dây đã vẽ: lệch kho so lại để báo "đổi cổng từ lúc vẽ".
    const ports = new Map<string, Record<string, string>>();
    for (const link of links.values()) {
      ports.set(link.deviceId, { ...ports.get(link.deviceId), [link.id]: link.portLabel ?? '' });
      ports.set(link.peerDeviceId, { ...ports.get(link.peerDeviceId), [link.id]: link.peerPort ?? '' });
    }
    return ids.map((id) => {
      const device = devices.get(id);
      if (!device) return { id, missing: true };
      return {
        id,
        code: device.code,
        name: device.name,
        type: device.deviceTypeName,
        model: device.model,
        serial: device.serial,
        ips: ips.get(id) ?? [],
        site: device.siteCode,
        cabinet: device.cabinetCode,
        u: device.rackUStart,
        uSize: device.rackUSize,
        status: device.status,
        ...(ports.has(id) ? { ports: ports.get(id) } : {}),
      };
    });
  }

  /* -------------------------------------------------------- người đang sửa --- */

  /**
   * Nhịp "đang mở sửa" (Q-23). Nhật ký chỉ ghi lúc VÀO (chưa có hàng, hoặc hàng đã nguội quá
   * `diagram.presence_ttl_seconds`), không ghi mỗi nhịp — nhịp nào cũng ghi là ngập audit_log.
   */
  async heartbeat(actor: Presence, diagramId: string): Promise<{ others: Presence[] }> {
    const ttl = await this.config.getNumber('diagramPresenceTtlSeconds');
    const cutoff = new Date(Date.now() - ttl * 1000);
    await this.db.transaction(async (tx) => {
      await this.lockLive(tx, diagramId);
      const [existing] = await tx
        .select({ seenAt: diagramPresenceTable.seenAt })
        .from(diagramPresenceTable)
        .where(and(eq(diagramPresenceTable.diagramId, diagramId), eq(diagramPresenceTable.userEmail, actor.email)));
      await tx
        .insert(diagramPresenceTable)
        .values({ diagramId, userEmail: actor.email, fullName: actor.fullName })
        .onConflictDoUpdate({
          target: [diagramPresenceTable.diagramId, diagramPresenceTable.userEmail],
          set: { seenAt: sql`now()`, fullName: actor.fullName },
        });
      if (!existing || existing.seenAt < cutoff) {
        await this.audit.appendWithin(tx, { actor: actor.email, action: 'diagram.editing_started', objectType: 'diagram', objectId: diagramId });
      }
    });
    const others = await this.db
      .select({ email: diagramPresenceTable.userEmail, fullName: diagramPresenceTable.fullName })
      .from(diagramPresenceTable)
      .where(
        and(
          eq(diagramPresenceTable.diagramId, diagramId),
          ne(diagramPresenceTable.userEmail, actor.email),
          gt(diagramPresenceTable.seenAt, cutoff),
        ),
      )
      .orderBy(asc(diagramPresenceTable.seenAt));
    return { others };
  }

  /* ----------------------------------------------------------------- chung --- */

  /** Lịch sử (AD-13) + nhật ký (AD-5) trong CÙNG transaction với thay đổi. */
  private async record(tx: Tx, actor: string, diagramId: string, action: string, auditAction: string, changes: unknown): Promise<void> {
    await tx.insert(diagramHistoryTable).values({ diagramId, action, actor, changes: changes ?? null });
    await this.audit.appendWithin(tx, {
      actor,
      action: auditAction,
      objectType: 'diagram',
      objectId: diagramId,
      detail: (changes ?? undefined) as Record<string, unknown> | undefined,
    });
  }
}

export function linkIdsOf(index: CellIndex): string[] {
  return [
    ...new Set(
      index.cells
        .filter((c) => c.kind === 'edge' && c.ims.ims_link_id && UUID_RE.test(c.ims.ims_link_id))
        .map((c) => c.ims.ims_link_id),
    ),
  ];
}

export function toCheckLink(link: PortLink): CheckLink {
  return {
    id: link.id,
    deviceA: link.deviceId,
    deviceB: link.peerDeviceId,
    cableTypeId: link.cableTypeId,
    portA: link.portLabel,
    portB: link.peerPort,
  };
}

function toDiagramLink(link: PortLink, slots: Map<string, number>): DiagramLink {
  const check = toCheckLink(link);
  const colorSlot = link.cableTypeId ? (slots.get(link.cableTypeId) ?? null) : null;
  return {
    ...link,
    colorSlot,
    labelFromA: linkLabelFrom(check, link.deviceId),
    labelFromB: linkLabelFrom(check, link.peerDeviceId),
    edgeStyle: linkEdgeCell(check, { sourceDeviceId: link.deviceId, slot: colorSlot }).style,
  };
}

function tooMany(count: number, max: number): BadRequestException {
  return new BadRequestException({
    code: 'DIAGRAM_AUTOLAYOUT_TOO_MANY',
    message: `Phạm vi có ${count} thiết bị, vượt trần ${max} của một lần dựng nháp — chọn một tủ hoặc danh sách máy nhỏ hơn.`,
  });
}

function emptyInfo(id: string): Omit<DiagramDeviceInfo, 'cell'> {
  return {
    id,
    found: false,
    code: null,
    name: null,
    deviceTypeName: null,
    model: null,
    serial: null,
    status: null,
    ips: [],
    siteCode: null,
    cabinetCode: null,
    u: null,
    uSize: null,
    vendorName: null,
    vendorPhone: null,
    warrantyEnd: null,
    photos: { front: false, back: false },
  };
}

/** Mặt ảnh thật mà các ô thiết bị của phiên bản chọn hiện (`ims_photo`). */
function photoNeedsOf(index: CellIndex): Map<string, Set<PhotoSide>> {
  const needs = new Map<string, Set<PhotoSide>>();
  for (const cell of index.cells) {
    const side = cell.ims[PHOTO_SIDE_ATTR];
    if (cell.kind !== 'device' || !cell.deviceId || (side !== 'front' && side !== 'back')) continue;
    needs.set(cell.deviceId, (needs.get(cell.deviceId) ?? new Set<PhotoSide>()).add(side));
  }
  return needs;
}

/** Cảnh báo cho máy khai U vượt chiều cao tủ (tủ bị hạ chiều cao sau khi khai — dữ liệu cũ). */
function rackOverflow(start: number | null, size: number | null, cabinetCode: string | null, height: number | null): string | null {
  if (start === null || !height || start + (size ?? 1) - 1 <= height) return null;
  const where = [`tủ`, cabinetCode].filter(Boolean).join(' ');
  return `⚠ ${rackUnitLabel(start, size)} vượt ${where} (${height}U)`;
}

function missingSource(code: string): DeviceCellSource {
  return { found: false, code, status: null, ips: [], siteCode: null, cabinetCode: null, u: null, shape: null, iconSvg: null };
}

function sourceOf(info: Omit<DiagramDeviceInfo, 'cell'>, look: { shape: string | null; iconSvg: string | null } | null): DeviceCellSource {
  return {
    found: true,
    code: info.code ?? '',
    status: info.status,
    ips: info.ips,
    siteCode: info.siteCode,
    cabinetCode: info.cabinetCode,
    u: info.u,
    uSize: info.uSize,
    shape: look?.shape ?? null,
    iconSvg: look?.iconSvg ?? null,
  };
}

function statusOf(latestId: string | null, officialId: string | null): DiagramStatus {
  if (!latestId) return 'empty';
  if (!officialId) return 'draft';
  return officialId === latestId ? 'official' : 'official_draft';
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function manageForbidden(): ForbiddenException {
  return new ForbiddenException({
    code: 'DIAGRAM_MANAGE_FORBIDDEN',
    message: 'Thành viên chỉ đổi tên hoặc lưu trữ bản trình bày do mình tạo hoặc phụ trách — việc khác cần Admin/SA.',
  });
}

function assertCanManage(node: DiagramNode, actor: { email: string; role: UserRole }): void {
  if (!canManageNode(node, actor)) throw manageForbidden();
}

function archived(): ConflictException {
  return new ConflictException({ code: 'DIAGRAM_ARCHIVED', message: 'Bản vẽ đã lưu trữ — không sửa được nữa.' });
}

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}
