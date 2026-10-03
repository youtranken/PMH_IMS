import { BadRequestException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CatalogApiService } from '../catalog/catalog.api';
import { SystemConfigService } from '../config-sys/system-config.service';
import { UsersApiService } from '../users/users.api';
import type { CellIndex } from './diagram-cells';
import { compareCellIndex, compareCounts, type CellCompare } from './diagram-compare';
import {
  cableLegend,
  composeExportSvg,
  exportBand,
  exportFileName,
  exportFooterLines,
  exportScale,
  type ExportBand,
  type ExportMeta,
  type ExportStatus,
  type LegendItem,
} from './diagram-export';
import { EXPORT_TIMEOUT_CODE, pngToPdf, renderPng } from './diagram-render';
import { diagramHistoryTable, diagramTable, diagramVersionLabelTable, diagramVersionTable } from './diagram.schema';

export type ExportFormat = 'png' | 'pdf';

/** Độ nét raster mong muốn: chữ 11px của nhãn draw.io còn đọc được khi in A4. */
const PREFERRED_SCALE = 2;

export interface ExportActor {
  email: string;
  fullName: string;
}

export interface ExportFile {
  body: Buffer;
  contentType: string;
  fileName: string;
  seq: number;
  status: ExportStatus;
  kind: 'official' | 'presentation';
  footer: string[];
  /** Dải trên đầu file (nháp / bản cũ / trình bày); `null` = bản chính thức hiện hành. */
  band: ExportBand | null;
  legend: LegendItem[];
}

export interface CompareView {
  from: { id: string; seq: number };
  to: { id: string; seq: number; savedAt: string; svg: string | null };
  result: CellCompare;
  counts: { added: number; removed: number; changed: number };
}

function versionNotFound(): NotFoundException {
  return new NotFoundException({ code: 'DIAGRAM_VERSION_NOT_FOUND', message: 'Không tìm thấy phiên bản này của bản vẽ.' });
}

/**
 * Xuất PNG/PDF và so sánh hai phiên bản (FR-044, Q-23, AD-17). Đọc bảng của chính module
 * `diagrams`; không gọi `vault`, không ghi gì ngoài một dòng nhật ký mỗi lượt.
 */
@Injectable()
export class DiagramExportService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly config: SystemConfigService,
    private readonly users: UsersApiService,
    private readonly catalog: CatalogApiService,
  ) {}

  /**
   * Dựng file từ SVG ĐÃ LƯU của phiên bản (không nhận ảnh từ client). Dòng `diagram.exported` chỉ
   * ghi khi đã có file — lỗi trần/hết giờ không để lại dòng nhật ký nói "đã xuất".
   */
  async export(actor: ExportActor, diagramId: string, versionId: string, format: ExportFormat): Promise<ExportFile> {
    const [maxMegapixels, timeoutSeconds, timeZone] = await Promise.all([
      this.config.getNumber('diagramExportMaxMegapixels'),
      this.config.getNumber('diagramExportTimeoutSeconds'),
      this.config.getString('appTimezone'),
    ]);
    const source = await this.source(diagramId, versionId);
    if (!source.svg) {
      throw new BadRequestException({ code: 'DIAGRAM_EXPORT_NO_IMAGE', message: 'Phiên bản này chưa có ảnh xem để xuất.' });
    }
    const meta: ExportMeta = { ...source.meta, exporter: actor, exportedAt: new Date(), timeZone };
    const legend = cableLegend(source.cellIndex, source.svg, await this.cableTypeNames(source.cellIndex));
    const composed = composeExportSvg(source.svg, meta, legend);
    const scale = exportScale(composed.width, composed.height, maxMegapixels, PREFERRED_SCALE);
    if (scale.value === null) throw new BadRequestException({ code: 'DIAGRAM_EXPORT_TOO_LARGE', message: scale.reason });

    let png: Buffer;
    try {
      png = await renderPng(composed.svg, scale.value, timeoutSeconds * 1000);
    } catch (error) {
      if ((error as Error).message === EXPORT_TIMEOUT_CODE) {
        throw new ServiceUnavailableException({
          code: 'DIAGRAM_EXPORT_TIMEOUT',
          message: `Xuất bản vẽ quá ${timeoutSeconds} giây — thử lại, hoặc tách bản vẽ con cho nhỏ hơn.`,
        });
      }
      throw error;
    }
    const footer = exportFooterLines(meta);
    const body =
      format === 'png'
        ? png
        : await pngToPdf(png, composed, { title: `${meta.path.join(' / ')} — phiên bản #${meta.seq}`, subject: footer.join('\n'), author: actor.fullName });

    await this.db.transaction((tx) =>
      this.audit.appendWithin(tx, {
        actor: actor.email,
        action: 'diagram.exported',
        objectType: 'diagram',
        objectId: diagramId,
        detail: { versionId, seq: meta.seq, format, status: meta.status, bytes: body.length },
      }),
    );
    return {
      body,
      contentType: format === 'png' ? 'image/png' : 'application/pdf',
      fileName: exportFileName(meta, format),
      seq: meta.seq,
      status: meta.status,
      kind: meta.kind,
      footer,
      band: exportBand(meta),
      legend,
    };
  }

  /**
   * So sánh tô màu `from` → `to` (hai phiên bản bất kỳ của cùng bản vẽ). Trả ảnh xem của `to`, nên
   * đây cũng là đọc nội dung: ghi `diagram.viewed` như màn xem (NFR-03).
   */
  async compare(actor: string, diagramId: string, fromId: string, toId: string): Promise<CompareView> {
    const rows = await this.db
      .select({
        id: diagramVersionTable.id,
        seq: diagramVersionTable.seq,
        svg: diagramVersionTable.svg,
        cellIndex: diagramVersionTable.cellIndex,
        createdAt: diagramVersionTable.createdAt,
      })
      .from(diagramVersionTable)
      .where(and(eq(diagramVersionTable.diagramId, diagramId), inArray(diagramVersionTable.id, [fromId, toId])));
    const from = rows.find((r) => r.id === fromId);
    const to = rows.find((r) => r.id === toId);
    if (!from || !to) throw versionNotFound();
    await this.db.transaction((tx) =>
      this.audit.appendWithin(tx, {
        actor,
        action: 'diagram.viewed',
        objectType: 'diagram',
        objectId: diagramId,
        detail: { versionId: to.id, seq: to.seq, mode: 'compare', fromVersionId: from.id, fromSeq: from.seq },
      }),
    );
    const result = compareCellIndex(from.cellIndex, to.cellIndex);
    return {
      from: { id: from.id, seq: from.seq },
      to: { id: to.id, seq: to.seq, savedAt: to.createdAt.toISOString(), svg: to.svg },
      result,
      counts: compareCounts(result),
    };
  }

  /** Mọi thứ của chân trang trừ người xuất và giờ xuất. */
  private async source(diagramId: string, versionId: string) {
    const [diagram] = await this.db
      .select({ kind: diagramTable.kind, official: diagramTable.officialVersionId, sourceVersionId: diagramTable.sourceVersionId })
      .from(diagramTable)
      .where(eq(diagramTable.id, diagramId));
    if (!diagram) throw new NotFoundException({ code: 'DIAGRAM_NOT_FOUND', message: 'Không tìm thấy bản vẽ.' });
    const [version] = await this.db
      .select()
      .from(diagramVersionTable)
      .where(and(eq(diagramVersionTable.diagramId, diagramId), eq(diagramVersionTable.id, versionId)));
    if (!version) throw versionNotFound();

    const [label] = await this.db
      .select({ label: diagramVersionLabelTable.label })
      .from(diagramVersionLabelTable)
      .where(eq(diagramVersionLabelTable.versionId, versionId))
      .orderBy(desc(diagramVersionLabelTable.createdAt), desc(diagramVersionLabelTable.id))
      .limit(1);
    // Lần phát hành GẦN NHẤT của chính phiên bản này: người phát hành là người duyệt (Q-23).
    const [published] = await this.db
      .select({ actor: diagramHistoryTable.actor, at: diagramHistoryTable.createdAt })
      .from(diagramHistoryTable)
      .where(
        and(
          eq(diagramHistoryTable.diagramId, diagramId),
          eq(diagramHistoryTable.action, 'version.published'),
          sql`${diagramHistoryTable.changes} ->> 'versionId' = ${versionId}`,
        ),
      )
      .orderBy(desc(diagramHistoryTable.createdAt), desc(diagramHistoryTable.id))
      .limit(1);
    const [official] = diagram.official
      ? await this.db.select({ seq: diagramVersionTable.seq }).from(diagramVersionTable).where(eq(diagramVersionTable.id, diagram.official))
      : [];
    const names = await this.users.namesByEmails([...new Set([version.savedBy, published?.actor].filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase()))]);
    const nameOf = (email: string) => names.get(email.toLowerCase()) ?? email;

    let status: ExportStatus = 'draft';
    if (diagram.official === versionId) status = 'official';
    else if (published) status = 'superseded';

    const meta: Omit<ExportMeta, 'exporter' | 'exportedAt' | 'timeZone'> = {
      path: await this.pathNames(diagramId),
      kind: diagram.kind,
      seq: version.seq,
      versionLabel: label?.label ?? null,
      status,
      approvedAt: published?.at ?? null,
      approvedBy: published ? nameOf(published.actor) : null,
      drawnBy: nameOf(version.savedBy),
      savedAt: version.createdAt,
      presentationBaseSeq: diagram.kind === 'presentation' ? await this.versionSeq(diagram.sourceVersionId) : null,
      supersededBySeq: status === 'superseded' ? (official?.seq ?? null) : null,
    };
    return { meta, svg: version.svg, cellIndex: version.cellIndex };
  }

  /** Tên các nút từ gốc cây tới bản vẽ này (đường dẫn trên chân trang). */
  private async pathNames(diagramId: string): Promise<string[]> {
    const { rows } = await this.db.execute<{ name: string; depth: number }>(sql`
      WITH RECURSIVE up AS (
        SELECT id, parent_id, name, 0 AS depth FROM diagram WHERE id = ${diagramId}
        UNION ALL
        SELECT d.id, d.parent_id, d.name, up.depth + 1 FROM diagram d JOIN up ON d.id = up.parent_id WHERE up.depth < 64
      ) SELECT name, depth FROM up ORDER BY depth DESC
    `);
    return rows.map((r) => r.name);
  }

  /**
   * Số của phiên bản chính thức đã chép ra bản trình bày (`source_version_id`) — dải "Dựa trên bản
   * chính thức phiên bản N" nói bản ĐÃ CHÉP, không phải bản chính thức hiện hành của bản gốc. Hàng
   * nguồn đã bị dọn thì không biết: dải chỉ còn dòng "BẢN TRÌNH BÀY".
   */
  private async versionSeq(versionId: string | null): Promise<number | null> {
    if (!versionId) return null;
    const [row] = await this.db.select({ seq: diagramVersionTable.seq }).from(diagramVersionTable).where(eq(diagramVersionTable.id, versionId));
    return row?.seq ?? null;
  }

  /**
   * Tên loại dây theo id cho chú giải, qua `catalog.api` (chủ `cable_type`, AD-2). Lấy cả loại đã
   * ngưng: bản cũ vẽ bằng loại dây nay đã ngưng vẫn phải có chú giải đúng tên.
   */
  private async cableTypeNames(index: CellIndex): Promise<Map<string, string>> {
    const used = new Set(index.cells.map((c) => (c.kind === 'edge' ? c.ims.ims_cable_type_id : undefined)).filter(Boolean));
    if (used.size === 0) return new Map();
    return new Map((await this.catalog.cableTypes()).filter((t) => used.has(t.id)).map((t) => [t.id, t.name]));
  }
}
