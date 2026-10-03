import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { redactMessage } from '../../common/log-redact';
import { isoDateInTz, startOfDayInTz } from '../../common/today';
import { MailContentRegistry, type MailContent } from '../../common/mail-content.registry';
import { UI_PATHS } from '../../common/ui-paths';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { AuditWriterService } from '../audit/audit-writer.service';
import { SystemConfigService } from '../config-sys/system-config.service';
import { DevicesApiService } from '../devices/devices.api';
import { IpamApiService } from '../ipam/ipam.api';
import { OutboxService } from '../outbox/outbox.service';
import { SweepService } from '../queue/sweep.service';
import { UsersApiService } from '../users/users.api';
import type { CellIndex } from './diagram-cells';
import { checkDrift, type DriftDevice } from './diagram-drift';
import type { CheckLink, Finding } from './diagram-finding';
import { diagramDriftTable, diagramTable, diagramVersionTable, type DeviceSnapshotEntry } from './diagram.schema';
import { linkIdsOf, toCheckLink } from './diagrams.service';

export const DIAGRAM_DRIFT_TOPIC = 'diagram.drift';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cảnh báo lệch kho (Q-23, AD-18): tính lệch của một phiên bản với kho HIỆN TẠI (chỉ đọc qua
 * `devices.api` / `ipam.api`), giữ số lệch của bản chính thức trong bộ đệm `diagram_drift` cho cây
 * bản vẽ, và lượt quét hằng ngày báo người phụ trách khi số tăng.
 *
 * Không có đường nào sửa bản vẽ hay sơ đồ cổng: "không ép sửa".
 */
@Injectable()
export class DiagramDriftService implements OnModuleInit {
  private readonly logger = new Logger(DiagramDriftService.name);

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly audit: AuditWriterService,
    private readonly config: SystemConfigService,
    private readonly devices: DevicesApiService,
    private readonly ipam: IpamApiService,
    private readonly outbox: OutboxService,
    private readonly users: UsersApiService,
    private readonly mails: MailContentRegistry,
    sweep: SweepService,
  ) {
    sweep.register({ name: 'diagram-drift', run: () => this.sweepDue() });
  }

  onModuleInit(): void {
    this.mails.register(DIAGRAM_DRIFT_TOPIC, (payload) => this.driftMail(payload));
  }

  /** Lệch kho của một chỉ mục ô so với bản chụp lúc lưu — mọi dữ liệu kho đọc MỘT lượt. */
  async evaluate(index: CellIndex, snapshot: DeviceSnapshotEntry[]): Promise<Finding[]> {
    const ids = [...new Set(index.cells.map((c) => c.deviceId).filter((id): id is string => Boolean(id && UUID_RE.test(id))))];
    const cabinetIds = [
      ...new Set(index.cells.map((c) => (c.kind !== 'edge' ? c.ims.ims_cabinet_id : undefined)).filter((id): id is string => Boolean(id && UUID_RE.test(id)))),
    ];
    // Một tủ không chứa nhiều máy hơn số ô của một bản vẽ — trần của cổng kiểm là trần đọc ở đây.
    const cap = await this.config.getNumber('diagramMaxCells');
    const [found, ips, drawn, touching, inCabinets] = await Promise.all([
      this.devices.getByIds(ids),
      this.ipam.heldAddressesOf(ids),
      this.devices.portLinks(linkIdsOf(index)),
      this.devices.portLinksTouching(ids),
      Promise.all(cabinetIds.map(async (cabinetId) => [cabinetId, (await this.devices.listUsableIn({ cabinetId }, cap)).items] as const)),
    ]);
    const devices = new Map<string, DriftDevice>(
      [...found.values()].map((d) => [
        d.id,
        {
          id: d.id,
          code: d.code,
          status: d.status,
          cabinetId: d.cabinetId,
          ips: ips.get(d.id) ?? [],
          siteCode: d.siteCode,
          cabinetCode: d.cabinetCode,
          u: d.rackUStart,
          uSize: d.rackUSize,
        },
      ]),
    );
    const links = new Map<string, CheckLink>([...drawn].map(([id, link]) => [id, toCheckLink(link)]));
    return checkDrift({
      index,
      snapshot,
      devices,
      links,
      touching: touching.map(toCheckLink),
      cabinetDevices: new Map(inCabinets.map(([cabinetId, items]) => [cabinetId, items.map((d) => ({ id: d.id, code: d.code }))])),
    });
  }

  /**
   * Lệch kho của phiên bản đang mở. Mở đúng bản chính thức thì ghi số vào bộ đệm cho cây — KHÔNG
   * đụng `notified_count`: đó là mốc so của lượt quét, đẩy nó lên ở đây là nuốt mất thư báo.
   */
  async forVersion(diagramId: string, versionId: string): Promise<Finding[]> {
    const [row] = await this.db
      .select({ cellIndex: diagramVersionTable.cellIndex, snapshot: diagramVersionTable.deviceSnapshot, officialId: diagramTable.officialVersionId })
      .from(diagramVersionTable)
      .innerJoin(diagramTable, eq(diagramTable.id, diagramVersionTable.diagramId))
      .where(and(eq(diagramVersionTable.diagramId, diagramId), eq(diagramVersionTable.id, versionId)));
    if (!row) return [];
    const findings = await this.evaluate(row.cellIndex, row.snapshot);
    if (row.officialId === versionId) {
      await this.db
        .insert(diagramDriftTable)
        .values({ diagramId, versionId, driftCount: findings.length, checkedAt: new Date() })
        .onConflictDoUpdate({
          target: diagramDriftTable.diagramId,
          set: { versionId, driftCount: findings.length, checkedAt: new Date() },
        });
    }
    return findings;
  }

  /** Số lệch của bản chính thức HIỆN HÀNH theo bộ đệm; số tính trên bản chính thức cũ bị bỏ qua. */
  async counts(diagramIds: string[]): Promise<Map<string, number>> {
    if (diagramIds.length === 0) return new Map();
    const rows = await this.db
      .select({ diagramId: diagramDriftTable.diagramId, count: diagramDriftTable.driftCount })
      .from(diagramDriftTable)
      .innerJoin(diagramTable, eq(diagramTable.id, diagramDriftTable.diagramId))
      .where(and(inArray(diagramDriftTable.diagramId, diagramIds), sql`${diagramDriftTable.versionId} = ${diagramTable.officialVersionId}`));
    return new Map(rows.map((r) => [r.diagramId, r.count]));
  }

  /* ------------------------------------------------------------- quét hằng ngày --- */

  /**
   * Sweep gọi mỗi phút (AD-9); mỗi bản chính thức được quét nhiều nhất MỘT lần mỗi ngày, từ giờ
   * `diagram.drift_sweep_hour` — "đã quét hôm nay chưa" đọc từ Postgres (`swept_at`), nên Redis
   * mất vài giờ thì lượt sau quét bù.
   */
  async sweepDue(now: Date = new Date()): Promise<void> {
    const [timeZone, hour] = await Promise.all([this.config.getString('appTimezone'), this.config.getNumber('diagramDriftSweepHour')]);
    const startOfDay = startOfDayInTz(isoDateInTz(timeZone, now), timeZone);
    // Cộng giờ lên nửa đêm địa phương: múi giờ ứng dụng không có giờ mùa hè (Asia/Ho_Chi_Minh).
    if (now.getTime() < startOfDay.getTime() + hour * 3_600_000) return;
    const { rows } = await this.db.execute<{ id: string; official_version_id: string }>(sql`
      SELECT d.id, d.official_version_id
        FROM diagram d
        LEFT JOIN diagram_drift x ON x.diagram_id = d.id
       WHERE d.archived_at IS NULL
         AND d.kind = 'official'
         AND d.official_version_id IS NOT NULL
         AND (x.swept_at IS NULL OR x.swept_at < ${startOfDay.toISOString()}::timestamptz)
       ORDER BY d.id
    `);
    for (const row of rows) {
      try {
        await this.sweepOne(row.id, row.official_version_id, startOfDay, now);
      } catch (error) {
        // Một bản vẽ hỏng không được chặn các bản vẽ xếp sau (SweepService chỉ bắt ở mức handler).
        this.logger.error(`Quét lệch kho bản vẽ ${row.id} lỗi: ${redactMessage(error)}`);
      }
    }
  }

  /**
   * Một bản vẽ: tính lệch NGOÀI transaction (đọc kho), rồi chốt lượt quét + so số + đẩy outbox
   * trong CÙNG một transaction (AD-5) — chốt mà không đẩy được thư thì cả hai cùng lùi, lượt sau
   * làm lại; hai worker cùng quét thì khoá hàng xếp hàng và người sau thấy hôm nay đã quét.
   */
  private async sweepOne(diagramId: string, versionId: string, startOfDay: Date, now: Date): Promise<void> {
    const [version] = await this.db
      .select({ cellIndex: diagramVersionTable.cellIndex, snapshot: diagramVersionTable.deviceSnapshot })
      .from(diagramVersionTable)
      .where(eq(diagramVersionTable.id, versionId));
    if (!version) return;
    const count = (await this.evaluate(version.cellIndex, version.snapshot)).length;
    const enabled = (await this.config.getNumber('diagramDriftNotifyEnabled')) > 0;
    await this.db.transaction(async (tx) => {
      await tx.insert(diagramDriftTable).values({ diagramId }).onConflictDoNothing();
      const [current] = await tx.select().from(diagramDriftTable).where(eq(diagramDriftTable.diagramId, diagramId)).for('update');
      if (current.sweptAt && current.sweptAt >= startOfDay) return;
      const previous = current.notifiedCount;
      await tx
        .update(diagramDriftTable)
        .set({ versionId, driftCount: count, notifiedCount: count, checkedAt: now, sweptAt: now })
        .where(eq(diagramDriftTable.diagramId, diagramId));
      // Số không đổi hay giảm thì không gửi lại; giảm rồi tăng lại thì gửi (mốc đã hạ theo).
      if (!enabled || count <= previous) return;
      // Outbox chỉ giữ id + số (NFR-04): người nhận và tên bản vẽ dựng lại lúc gửi (`driftMail`).
      await this.outbox.enqueueWithin(tx, DIAGRAM_DRIFT_TOPIC, { diagramId, count, previous });
      await this.audit.appendWithin(tx, {
        actor: 'system',
        action: 'diagram.drift_notified',
        objectType: 'diagram',
        objectId: diagramId,
        detail: { versionId, count, previous },
      });
    });
  }

  /**
   * Thư lệch kho cho người phụ trách bản vẽ; bản vẽ chưa có người phụ trách thì người tạo. Bản vẽ
   * đã lưu trữ, hay người nhận không còn tài khoản → không gửi.
   */
  private async driftMail(payload: Record<string, unknown>): Promise<MailContent | null> {
    const diagramId = typeof payload.diagramId === 'string' && UUID_RE.test(payload.diagramId) ? payload.diagramId : null;
    if (!diagramId) return null;
    const [diagram] = await this.db
      .select({ name: diagramTable.name, owner: diagramTable.ownerEmail, createdBy: diagramTable.createdBy, archivedAt: diagramTable.archivedAt })
      .from(diagramTable)
      .where(eq(diagramTable.id, diagramId));
    if (!diagram || diagram.archivedAt) return null;
    const to = diagram.owner ?? diagram.createdBy;
    if (!(await this.users.roleByEmail(to))) return null;
    const count = Number(payload.count ?? 0);
    const previous = Number(payload.previous ?? 0);
    return {
      to: [to],
      subject: `[IMS] Bản vẽ "${diagram.name}" lệch kho: ${count} mục`,
      title: 'Bản vẽ lệch so với kho',
      intro:
        'Dữ liệu kho đã đổi khác lúc vẽ bản chính thức này (máy thanh lý, đổi IP, đổi vị trí, đổi cổng hoặc kết nối mới chưa vẽ). ' +
        'IMS không tự sửa bản vẽ — mở bản vẽ, bấm "Kiểm tra khớp dữ liệu" để xem từng mục.',
      rows: [
        { label: 'Bản vẽ', value: diagram.name },
        { label: 'Số mục lệch', value: previous > 0 ? `${count} (lần quét trước ${previous})` : String(count) },
      ],
      ctaLabel: 'Mở bản vẽ',
      ctaPath: UI_PATHS.diagram(diagramId),
      footnote: 'Thư chỉ gửi khi số mục lệch tăng so với lần quét trước.',
    };
  }
}
