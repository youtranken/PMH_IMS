import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { pageOffset, type Page, type PageQuery } from '../../common/pagination';
import { escapeLike, pgConstraint } from '../../common/sql';
import { AuditWriterService } from '../audit/audit-writer.service';
import { CatalogApiService } from '../catalog/catalog.api';
import { SystemConfigService } from '../config-sys/system-config.service';
import { expandPortTemplate, portLayoutSummary, withTemplatePorts, type PortTemplateGroup } from './port-template';
import { modelKey } from './device-model-key';
import { deviceModelTable, deviceTable } from './devices.schema';
import { DevicePortsService } from './device-ports.service';
import { DevicesService } from './devices.service';
import { RACK_U_MAX, rackOverlap } from './rack-units';

export interface DeviceModelItem {
  id: string;
  deviceTypeId: string;
  deviceTypeName: string;
  model: string;
  manufacturer: string | null;
  rackMountable: boolean;
  uSize: number | null;
  photoFrontFileId: string | null;
  portTemplate: PortTemplateGroup[];
  /** Số cổng cổng mẫu sinh ra. */
  portCount: number;
  /** Số máy đang trỏ tới model (kể cả máy đã thanh lý — khoá ngoại vẫn giữ chúng). */
  deviceCount: number;
  updatedAt: Date;
}

export interface DeviceModelInput {
  deviceTypeId?: string;
  model?: string;
  manufacturer?: string | null;
  rackMountable?: boolean;
  uSize?: number | null;
  portTemplate?: unknown;
}

export interface DeviceModelFilter {
  search?: string;
  deviceTypeId?: string;
  manufacturer?: string;
}

/**
 * Danh mục Model thiết bị (Q-26) — `devices` là chủ `device_model` (AD-3). Model mang đặc tính chung
 * của một loại máy (gắn tủ + Số U, hãng, ảnh); máy trỏ tới nó qua `device.device_model_id`.
 *
 * Đổi đặc tính của model là đổi cả loạt máy, nên ghi model và các máy của nó chung một transaction,
 * và kiểm chồng U của CẢ loạt trước khi ghi — không để một nửa số máy đổi Số U còn nửa kia thì không.
 */
@Injectable()
export class DeviceModelsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly catalog: CatalogApiService,
    private readonly audit: AuditWriterService,
    private readonly devices: DevicesService,
    private readonly config: SystemConfigService,
    private readonly ports: DevicePortsService,
  ) {}

  async list(filter: DeviceModelFilter, query: PageQuery): Promise<Page<DeviceModelItem>> {
    const where = this.whereOf(filter);
    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(deviceModelTable)
        .where(where)
        .orderBy(asc(sql`coalesce(${deviceModelTable.manufacturer}, '')`), asc(deviceModelTable.model), asc(deviceModelTable.id))
        .limit(query.limit)
        .offset(pageOffset(query)),
      this.db.select({ value: count() }).from(deviceModelTable).where(where),
    ]);
    return { items: await this.decorate(rows), total: Number(total[0]?.value ?? 0) };
  }

  async get(id: string): Promise<DeviceModelItem> {
    const [row] = await this.db.select().from(deviceModelTable).where(eq(deviceModelTable.id, id));
    if (!row) throw notFound();
    return (await this.decorate([row]))[0];
  }

  async create(actor: string, input: DeviceModelInput): Promise<DeviceModelItem> {
    const values = this.validated(input, null, await this.portMax());
    await this.catalog.assertRefs({ deviceTypeId: values.deviceTypeId }, null);
    await this.assertUnique(values.model, null);
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(deviceModelTable).values(values).returning({ id: deviceModelTable.id });
        await this.audit.appendWithin(tx, { actor, action: 'device.model-created', objectType: 'device_model', objectId: row.id, detail: { ...values } });
        return row.id;
      });
    } catch (error) {
      // Hai lượt tạo cùng khoá lọt qua phép kiểm ở trên cùng lúc: UNIQUE chặn lượt sau.
      if (pgConstraint(error) === 'device_model_model_key_key') await this.assertUnique(values.model, null);
      throw error;
    }
    return this.get(id);
  }

  async update(actor: string, id: string, patch: DeviceModelInput): Promise<DeviceModelItem> {
    const max = await this.portMax();
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(deviceModelTable).where(eq(deviceModelTable.id, id)).for('update');
      if (!before) throw notFound();
      const values = this.validated({ ...before, ...stripUndefined(patch) }, before, max);
      if (values.model !== before.model) await this.assertUnique(values.model, id, tx);
      // Khoá các máy theo thứ tự id: lượt lan cổng mẫu đọc rồi ghi danh sách cổng của chúng, cùng lúc
      // một lượt khai dây có thể đang thêm cổng riêng vào chính máy đó.
      const members = await tx.select().from(deviceTable).where(eq(deviceTable.deviceModelId, id)).orderBy(asc(deviceTable.id)).for('update');
      if (values.deviceTypeId !== before.deviceTypeId) {
        if (members.length > 0) {
          throw new ConflictException({
            code: 'DEVICE_MODEL_TYPE_LOCKED',
            message: `Model còn ${members.length} máy dùng — không đổi loại thiết bị được. Tạo model mới cho loại kia.`,
          });
        }
        await this.catalog.assertRefs({ deviceTypeId: values.deviceTypeId }, null);
      }
      const racked = members.filter((d) => d.rackUStart !== null && d.status !== 'retired');
      // Máy nằm trong tủ dù chưa khai U cũng chặn: model không gắn tủ thì mọi lượt sửa máy đó sau này
      // đều bị `applyModel` từ chối.
      const inCabinet = members.filter((d) => d.cabinetId !== null && d.status !== 'retired');
      if (!values.rackMountable && inCabinet.length > 0) {
        throw new ConflictException({
          code: 'DEVICE_MODEL_IN_RACK',
          message: `Còn ${inCabinet.length} máy thuộc model đang nằm trong tủ (${inCabinet.map((d) => d.code).join(', ')}) — bỏ tủ của các máy đó trước khi chuyển model sang không gắn tủ.`,
        });
      }
      if (values.uSize !== before.uSize && racked.length > 0) await this.assertRegrowFree(tx, racked, values.uSize!);

      await tx.update(deviceModelTable).set({ ...values, updatedAt: new Date() }).where(eq(deviceModelTable.id, id));
      for (const member of members) {
        const next: Record<string, unknown> = {};
        if (values.model !== member.model) next.model = values.model;
        if (member.rackUStart !== null && values.uSize !== null && values.uSize !== member.rackUSize) next.rackUSize = values.uSize;
        if (Object.keys(next).length === 0) continue;
        const changes = Object.fromEntries(Object.entries(next).map(([k, after]) => [k, { before: member[k as keyof typeof member], after }]));
        await this.devices.updateWithin(tx, member.id, next);
        await this.devices.recordWithin(tx, actor, member.id, 'updated', changes);
      }
      if (JSON.stringify(values.portTemplate) !== JSON.stringify(before.portTemplate)) {
        await this.spreadTemplate(tx, actor, members, expandPortTemplate(values.portTemplate, max), max);
      }
      await this.audit.appendWithin(tx, {
        actor,
        action: 'device.model-updated',
        objectType: 'device_model',
        objectId: id,
        detail: { before: pick(before), after: values, devices: members.length },
      });
    });
    return this.get(id);
  }

  /**
   * Cổng mẫu mới lan sang các máy của model (Q-26 07/10): chỉ THÊM cổng còn thiếu — máy tạo trước khi
   * model có mẫu vẫn chọn được cổng mẫu khi khai dây. Cổng đang có dây mà chưa nằm trong danh sách
   * (máy chưa có danh sách lúc khai dây) được ghi vào làm cổng riêng, để không thành cổng "ngoài
   * danh sách". Máy thanh lý giữ nguyên như hồ sơ đóng.
   */
  private async spreadTemplate(tx: Tx, actor: string, members: (typeof deviceTable.$inferSelect)[], template: ReturnType<typeof expandPortTemplate>, max: number): Promise<void> {
    for (const member of members) {
      if (member.status === 'retired') continue;
      const layout = member.portLayout ?? [];
      const listed = new Set(layout.map((p) => p.label.toLowerCase()));
      const wired = (await this.ports.wiredLabels(tx, member.id)).filter((label) => !listed.has(label.toLowerCase()));
      const { ports, added } = withTemplatePorts([...layout, ...wired.map((label) => ({ label, kind: 'other' as const }))], template);
      if (added.length === 0) continue;
      if (ports.length > max) {
        throw new BadRequestException({
          code: 'PORT_TEMPLATE_INVALID',
          message: `Máy ${member.code} sẽ có ${ports.length} cổng, quá trần ${max} — bớt cổng riêng của máy đó hoặc thu gọn mẫu.`,
        });
      }
      await this.devices.updateWithin(tx, member.id, { portLayout: ports });
      await this.devices.recordWithin(tx, actor, member.id, 'ports-layout', {
        portLayout: { before: portLayoutSummary(layout) || null, after: portLayoutSummary(ports) },
      });
    }
  }

  async remove(actor: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(deviceModelTable).where(eq(deviceModelTable.id, id)).for('update');
      if (!before) throw notFound();
      const [{ value }] = await tx.select({ value: count() }).from(deviceTable).where(eq(deviceTable.deviceModelId, id));
      if (Number(value) > 0) {
        throw new ConflictException({
          code: 'DEVICE_MODEL_IN_USE',
          message: `Model còn ${Number(value)} máy dùng — gán model khác cho các máy đó trước khi xoá.`,
        });
      }
      await tx.delete(deviceModelTable).where(eq(deviceModelTable.id, id));
      await this.audit.appendWithin(tx, { actor, action: 'device.model-deleted', objectType: 'device_model', objectId: id, detail: pick(before) });
    });
  }

  private whereOf(filter: DeviceModelFilter): SQL | undefined {
    const term = filter.search?.trim();
    return and(
      filter.deviceTypeId ? eq(deviceModelTable.deviceTypeId, filter.deviceTypeId) : undefined,
      filter.manufacturer ? ilike(deviceModelTable.manufacturer, filter.manufacturer.trim()) : undefined,
      term
        ? or(
            sql`${deviceModelTable.modelKey} LIKE ${`%${escapeLike(modelKey(term))}%`}`,
            ilike(deviceModelTable.manufacturer, `%${escapeLike(term)}%`),
          )
        : undefined,
    );
  }

  private async decorate(rows: (typeof deviceModelTable.$inferSelect)[]): Promise<DeviceModelItem[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [lists, counts] = await Promise.all([
      this.catalog.lists({ includeInactive: true }),
      this.db
        .select({ id: deviceTable.deviceModelId, value: count() })
        .from(deviceTable)
        .where(inArray(deviceTable.deviceModelId, ids))
        .groupBy(deviceTable.deviceModelId),
    ]);
    const types = new Map(lists.deviceTypes.map((t) => [t.id, t.name]));
    const used = new Map(counts.map((c) => [c.id, Number(c.value)]));
    return rows.map((row) => ({
      id: row.id,
      deviceTypeId: row.deviceTypeId,
      deviceTypeName: types.get(row.deviceTypeId) ?? '(không rõ loại)',
      model: row.model,
      manufacturer: row.manufacturer,
      rackMountable: row.rackMountable,
      uSize: row.uSize,
      photoFrontFileId: row.photoFrontFileId,
      portTemplate: row.portTemplate,
      portCount: expandPortTemplate(row.portTemplate, Number.MAX_SAFE_INTEGER).length,
      deviceCount: used.get(row.id) ?? 0,
      updatedAt: row.updatedAt,
    }));
  }

  /** Model trùng khoá chuẩn hoá → 409 kèm model sẵn có, để form mời "Dùng model này". */
  private async assertUnique(model: string, selfId: string | null, db: Pick<Database, 'select'> | Tx = this.db): Promise<void> {
    const [existing] = await db
      .select({ id: deviceModelTable.id, model: deviceModelTable.model })
      .from(deviceModelTable)
      .where(and(eq(deviceModelTable.modelKey, modelKey(model)), selfId ? ne(deviceModelTable.id, selfId) : undefined));
    if (existing) {
      throw new ConflictException({
        code: 'DEVICE_MODEL_DUPLICATE',
        message: `Đã có model "${existing.model}" — cùng mã sau khi bỏ khoảng trắng, gạch và chữ hoa/thường. Dùng model đó.`,
        existing,
      });
    }
  }

  /**
   * Đổi Số U của model: kiểm cả loạt máy trong tủ với Số U mới, so với mọi máy còn lại của tủ (máy cùng
   * model cũng đã mang Số U mới). Khoá theo tủ cùng khoá của `assertRackFreeWithin`, theo thứ tự id
   * để hai lượt đổi hai model chung tủ không khoá chéo nhau.
   */
  private async assertRegrowFree(tx: Tx, racked: (typeof deviceTable.$inferSelect)[], uSize: number): Promise<void> {
    const cabinetIds = [...new Set(racked.map((d) => d.cabinetId!))].sort();
    for (const cabinetId of cabinetIds) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`device-rack:${cabinetId}`}, 0))`);
    }
    const cabinets = await this.catalog.cabinetsByIds(cabinetIds);
    const memberIds = new Set(racked.map((d) => d.id));
    const neighbours = await tx
      .select({ id: deviceTable.id, code: deviceTable.code, name: deviceTable.name, cabinetId: deviceTable.cabinetId, start: deviceTable.rackUStart, size: deviceTable.rackUSize })
      .from(deviceTable)
      .where(and(inArray(deviceTable.cabinetId, cabinetIds), ne(deviceTable.status, 'retired'), sql`${deviceTable.rackUStart} IS NOT NULL`));
    const clashes: string[] = [];
    for (const device of racked) {
      const height = cabinets.get(device.cabinetId!)?.uHeight ?? RACK_U_MAX;
      const top = device.rackUStart! + uSize - 1;
      if (top > height) {
        clashes.push(`${device.code} (U${device.rackUStart}–U${top} vượt tủ ${height}U)`);
        continue;
      }
      const others = neighbours
        .filter((n) => n.cabinetId === device.cabinetId && n.id !== device.id)
        .map((n) => ({ code: n.code, name: n.name, start: n.start!, size: memberIds.has(n.id) ? uSize : n.size! }));
      const taken = rackOverlap({ start: device.rackUStart!, size: uSize }, others);
      if (taken) clashes.push(`${device.code} (đè ${taken.code})`);
    }
    if (clashes.length > 0) {
      throw new ConflictException({
        code: 'DEVICE_MODEL_U_CLASH',
        message: `Đổi Số U làm máy chồng U trong tủ: ${clashes.join(', ')}. Dời các máy đó trước rồi đổi Số U.`,
      });
    }
  }

  private portMax(): Promise<number> {
    return this.config.getNumber('devicePortTemplateMax');
  }

  /** Đầu vào hợp lệ thành hàng ghi được; `before` = hàng đang có (sửa), `null` = tạo mới. */
  private validated(input: DeviceModelInput, before: typeof deviceModelTable.$inferSelect | null, portMax: number) {
    const model = (input.model ?? '').trim();
    if (!model || model.length > 120 || modelKey(model).length === 0) {
      throw bad('DEVICE_MODEL_NAME_INVALID', 'Mã model từ 1 đến 120 ký tự và phải có chữ hoặc số.');
    }
    const deviceTypeId = input.deviceTypeId ?? before?.deviceTypeId;
    if (!deviceTypeId) throw bad('FIELD_REQUIRED', 'Thiếu Loại thiết bị.');
    const manufacturer = input.manufacturer?.trim() || null;
    if (manufacturer && manufacturer.length > 60) throw bad('DEVICE_MODEL_MANUFACTURER_INVALID', 'Hãng tối đa 60 ký tự.');
    const rackMountable = Boolean(input.rackMountable);
    const uSize = input.uSize ?? null;
    if (rackMountable && (uSize === null || !Number.isInteger(uSize) || uSize < 1 || uSize > RACK_U_MAX)) {
      throw bad('DEVICE_MODEL_U_INVALID', `Model gắn tủ cần Số U từ 1 đến ${RACK_U_MAX}.`);
    }
    if (!rackMountable && uSize !== null) throw bad('DEVICE_MODEL_U_INVALID', 'Model không gắn tủ thì không có Số U.');
    const raw = input.portTemplate ?? before?.portTemplate ?? [];
    // Kiểm bằng chính phép mở mẫu (dải, trùng tên, trần) rồi lưu các nhóm đã làm sạch.
    expandPortTemplate(raw, portMax);
    const portTemplate = (raw as { pattern?: unknown; kind?: unknown }[])
      .filter((g) => typeof g?.pattern === 'string' && g.pattern.trim())
      .map((g) => ({ pattern: (g.pattern as string).trim(), kind: g.kind as PortTemplateGroup['kind'] }));
    return { deviceTypeId, model, manufacturer, rackMountable, uSize, portTemplate };
  }
}

function pick(row: typeof deviceModelTable.$inferSelect) {
  return { deviceTypeId: row.deviceTypeId, model: row.model, manufacturer: row.manufacturer, rackMountable: row.rackMountable, uSize: row.uSize, portTemplate: row.portTemplate };
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function bad(code: string, message: string): BadRequestException {
  return new BadRequestException({ code, message });
}

function notFound(): NotFoundException {
  return new NotFoundException({ code: 'DEVICE_MODEL_NOT_FOUND', message: 'Không tìm thấy model này.' });
}
