import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { diffRecord, type RecordChanges } from '../../common/record-diff';
import { conflictOnUnique } from '../../common/sql';
import type { Tx } from '../../common/tx';
import { devicePortTable, deviceTable } from './devices.schema';
import { DevicesService } from './devices.service';
import { planBulkPorts, type BulkPlanReason } from './port-plan';
import { portVlanOf } from './port-vlan';
import { normalizePortLayout, portLayoutSummary, type PhysicalPort } from './port-template';

/** Mặt cổng của một máy (Q-26): cổng vật lý + đầu kia của cổng đang có dây. */
export interface PortPanel {
  ports: (PhysicalPort & { peer: string | null })[];
  /** Cổng đang có dây mà không nằm trong danh sách cổng (khai trước khi có danh sách). */
  unlisted: { label: string; peer: string }[];
  used: number;
  total: number;
}

export interface PortInput {
  portLabel?: string;
  connectedDeviceId?: string | null;
  connectedLabel?: string | null;
  connectedPort?: string | null;
  usedBy?: string | null;
  vlan?: string | null;
  note?: string | null;
  /** Loại dây (danh mục `cable_type`); `null`/`''` = bỏ loại dây. */
  cableTypeId?: string | null;
}

export interface PortRow {
  id: string;
  deviceId: string;
  portLabel: string;
  connectedDeviceId: string | null;
  /** Mã thiết bị đầu kia (tra sẵn) — bảng cần hiện MÃ, không phải uuid. */
  connectedDeviceCode: string | null;
  connectedDeviceName: string | null;
  connectedLabel: string | null;
  connectedPort: string | null;
  usedBy: string | null;
  /**
   * VLAN của cổng — `text`, không phải số: "trunk" là giá trị có thật và hay gặp nhất trên
   * cổng uplink. Ép kiểu số là ép bỏ trống ô cho cổng quan trọng nhất của con switch. Chỉ
   * nhận số 1–4094 hoặc "trunk" (`portVlanOf`, CHECK `device_port_vlan_check`).
   */
  vlan: string | null;
  note: string | null;
  cableTypeId: string | null;
}

/** Chiều ngược: cổng của thiết bị KHÁC đang cắm vào thiết bị đang xem. */
interface IncomingPortRow {
  id: string;
  /** Thiết bị đang giữ bản ghi (đầu kia của sợi dây). */
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  portLabel: string;
  connectedPort: string | null;
  usedBy: string | null;
  /** VLAN của cổng switch đang cắm vào máy này — nhìn từ máy trạm/server cũng phải biết. */
  vlan: string | null;
  note: string | null;
  cableTypeId: string | null;
}

/**
 * Một sợi dây giữa HAI máy có hồ sơ, nhìn từ ngoài module (sơ đồ mạng — AD-18). `id` là id dòng
 * `device_port` — chính là `ims_link_id` trên nét vẽ. Đầu A là máy giữ bản ghi.
 */
export interface PortLink {
  id: string;
  deviceId: string;
  deviceCode: string;
  portLabel: string;
  peerDeviceId: string;
  peerDeviceCode: string;
  peerPort: string | null;
  cableTypeId: string | null;
  vlan: string | null;
  note: string | null;
}

/** Khai một sợi dây giữa hai máy (hộp "Khai kết nối" của sơ đồ mạng). */
export interface LinkInput {
  portLabel: string;
  connectedDeviceId: string;
  connectedPort?: string | null;
  cableTypeId?: string | null;
}

export interface BulkLinkInput {
  startPort: string;
  endPort?: string | null;
  /** Máy đầu kia theo đúng thứ tự người dùng xếp — máy thứ i nhận cổng thứ i của dải. */
  targets: string[];
  /** Cổng phía các máy kia (vd "eth0"), dùng chung cho cả lô; vắng = không ghi. */
  peerPort?: string | null;
  cableTypeId?: string | null;
}

const BULK_REASON: Record<BulkPlanReason, string> = {
  'no-targets': 'Chưa chọn máy nào để nối.',
  'start-not-numbered': 'Cổng bắt đầu phải kết thúc bằng số (vd Gi1/0/1) để tự tăng.',
  'end-mismatch': 'Cổng cuối phải cùng kiểu với cổng bắt đầu và không nhỏ hơn nó.',
  'not-enough': 'Dải cổng không đủ cổng trống cho số máy đã chọn — không nối máy nào.',
};

export interface PortMap {
  ports: PortRow[];
  incoming: IncomingPortRow[];
}

/**
 * Các ô lịch sử ghi lại cho một dòng port map. Đầu kia ghi bằng MÃ thiết bị: uuid trong tab
 * Lịch sử không ai đọc được.
 */
const TRACKED = [
  'connectedDevice',
  'connectedLabel',
  'connectedPort',
  'cableType',
  'vlan',
  'usedBy',
  'note',
] as const;

type PortSnapshot = { portLabel: string } & Record<(typeof TRACKED)[number], string | null>;

/**
 * Trước/sau của một lượt thêm (`before` null), sửa, gỡ (`after` null). `portLabel` luôn có mặt,
 * kể cả khi không đổi: câu lịch sử ("Sửa cổng Gi1/0/12") đọc tên cổng từ đó.
 */
function portChanges(before: PortSnapshot | null, after: PortSnapshot | null): RecordChanges {
  const empty = Object.fromEntries(TRACKED.map((field) => [field, null]));
  return {
    portLabel: { before: before?.portLabel ?? null, after: after?.portLabel ?? null },
    ...diffRecord(TRACKED, before ?? empty, after ?? empty),
  };
}

/** Lưu lại y nguyên thì không có gì để kể — không đẻ dòng "đã sửa" rỗng trong tab Lịch sử. */
function hasPortChange(changes: RecordChanges): boolean {
  return (
    Object.keys(changes).length > 1 || changes.portLabel.before !== changes.portLabel.after
  );
}

/**
 * Mã lớp khoá advisory `(int, int)` của port map — riêng với mã lớp của
 * `audit/security-probe.service.ts` (42_001), xem chú thích ở đó.
 */
const PORT_LOCK_CLASS = 42_002;

/** Dòng của máy đã thanh lý giữ làm bằng chứng, không chiếm cổng (cùng luật `device_port_peer_port_key`). */
const NOT_OWNER_RETIRED = sql`NOT ${devicePortTable}.owner_retired`;

const ONE_CABLE_HINT = 'Mỗi cổng chỉ một sợi cáp — sửa hoặc gỡ dòng đó trước.';

/** Thứ tự khoá các cổng — chỉ để hai lượt khoá cùng một cặp cổng theo cùng một thứ tự. */
function portKey(deviceId: string, label: string): string {
  return `${deviceId}/${label.toLowerCase()}`;
}

function portNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'PORT_NOT_FOUND',
    message: 'Không tìm thấy dòng port map này.',
  });
}

/**
 * Port map (AD-14). Thuộc module `devices` vì bảng `device_port` chỉ nói về
 * thiết bị — một bảng một chủ (AD-3).
 *
 * Mọi thay đổi cổng ghi vào `device_history` của THIẾT BỊ GIỮ BẢN GHI, để tab Lịch sử
 * trả lời được "hôm đó ai rút dây cổng 12".
 */
@Injectable()
export class DevicePortsService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: Database,
    private readonly devices: DevicesService,
  ) {}

  async listFor(deviceId: string): Promise<PortMap> {
    const [own, incoming] = await Promise.all([
      this.db
        .select({ port: devicePortTable, peer: deviceTable })
        .from(devicePortTable)
        .leftJoin(deviceTable, eq(devicePortTable.connectedDeviceId, deviceTable.id))
        .where(eq(devicePortTable.deviceId, deviceId))
        .orderBy(asc(devicePortTable.portLabel)),
      this.db
        .select({ port: devicePortTable, owner: deviceTable })
        .from(devicePortTable)
        .innerJoin(deviceTable, eq(devicePortTable.deviceId, deviceTable.id))
        .where(eq(devicePortTable.connectedDeviceId, deviceId))
        .orderBy(asc(deviceTable.code), asc(devicePortTable.portLabel)),
    ]);

    return {
      ports: own.map((row) => ({
        id: row.port.id,
        deviceId: row.port.deviceId,
        portLabel: row.port.portLabel,
        connectedDeviceId: row.port.connectedDeviceId,
        connectedDeviceCode: row.peer?.code ?? null,
        connectedDeviceName: row.peer?.name ?? null,
        connectedLabel: row.port.connectedLabel,
        connectedPort: row.port.connectedPort,
        usedBy: row.port.usedBy,
        vlan: row.port.vlan,
        note: row.port.note,
        cableTypeId: row.port.cableTypeId,
      })),
      incoming: incoming.map((row) => ({
        id: row.port.id,
        deviceId: row.owner.id,
        deviceCode: row.owner.code,
        deviceName: row.owner.name,
        portLabel: row.port.portLabel,
        connectedPort: row.port.connectedPort,
        usedBy: row.port.usedBy,
        vlan: row.port.vlan,
        note: row.port.note,
        cableTypeId: row.port.cableTypeId,
      })),
    };
  }

  async create(actor: string, deviceId: string, input: PortInput): Promise<PortRow> {
    const values = await this.prepare(deviceId, input, null);
    if (!values.portLabel) {
      throw new BadRequestException({
        code: 'FIELD_REQUIRED',
        message: 'Thiếu tên cổng.',
      });
    }
    const id = await this.db.transaction((tx) => this.insertWithin(tx, actor, deviceId, values));
    return this.requireRow(deviceId, id);
  }

  /**
   * Mặt cổng (Q-26): mỗi cổng vật lý kèm đầu kia nếu đang có dây — tính từ CẢ hai chiều dây như
   * `takenLabels` (dòng của máy này nối đi, hoặc dòng của máy khác cắm vào nó).
   */
  async panel(deviceId: string): Promise<PortPanel> {
    const device = await this.devices.requireRowWithin(this.db, deviceId);
    const [map, taken] = await Promise.all([this.listFor(deviceId), this.takenLabels(this.db, deviceId)]);
    const peers = new Map<string, { label: string; peer: string }>();
    for (const row of map.ports) {
      const other = row.connectedDeviceCode ?? row.connectedLabel;
      if (other) peers.set(row.portLabel.toLowerCase(), { label: row.portLabel, peer: row.connectedPort ? `${other} · ${row.connectedPort}` : other });
    }
    for (const row of map.incoming) {
      // Dây của máy đã thanh lý không chiếm cổng — cùng luật `takenLabels` / `portUsage`.
      if (row.connectedPort && taken.has(row.connectedPort.toLowerCase())) peers.set(row.connectedPort.toLowerCase(), { label: row.connectedPort, peer: `${row.deviceCode} · ${row.portLabel}` });
    }
    const layout = device.portLayout ?? [];
    const listed = new Set(layout.map((p) => p.label.toLowerCase()));
    const ports = layout.map((p) => ({ ...p, peer: peers.get(p.label.toLowerCase())?.peer ?? null }));
    return {
      ports,
      unlisted: [...peers.entries()].filter(([key]) => !listed.has(key)).map(([, value]) => value),
      used: ports.filter((p) => p.peer).length,
      total: layout.length,
    };
  }

  /**
   * Sửa danh sách cổng của một máy (thêm cổng riêng, bỏ cổng). Bỏ cổng đang có dây bị chặn — dây
   * phải gỡ trước, không để dây trỏ vào một cổng máy không có.
   */
  async setLayout(actor: string, deviceId: string, input: unknown, max: number): Promise<PortPanel> {
    const next = normalizePortLayout(input, max);
    await this.db.transaction(async (tx) => {
      const before = await this.devices.requireRowWithin(tx, deviceId, 'update');
      this.devices.assertNotRetired(before);
      const kept = new Set(next.map((p) => p.label.toLowerCase()));
      const taken = await this.takenLabels(tx, deviceId);
      const busy = (before.portLayout ?? []).filter((p) => !kept.has(p.label.toLowerCase()) && taken.has(p.label.toLowerCase()));
      if (busy.length > 0) {
        throw new ConflictException({
          code: 'PORT_LAYOUT_IN_USE',
          message: `Cổng ${busy.map((p) => p.label).join(', ')} đang có dây — gỡ dây trước khi bỏ cổng.`,
        });
      }
      const from = portLayoutSummary(before.portLayout ?? []);
      const to = portLayoutSummary(next);
      if (from === to && JSON.stringify(before.portLayout) === JSON.stringify(next)) return;
      await this.devices.updateWithin(tx, deviceId, { portLayout: next });
      await this.devices.recordWithin(tx, actor, deviceId, 'ports-layout', { portLayout: { before: from || null, after: to || null } });
    });
    return this.panel(deviceId);
  }

  /**
   * Khoá hàng các máy của một lượt khai dây NGAY ĐẦU transaction, theo thứ tự id. Lượt khai có thể
   * ghi danh sách cổng của máy (`ensureListedWithin`); khoá chia sẻ trước rồi nâng lên khoá ghi giữa
   * chừng thì hai lượt cùng máy chờ nhau mãi (deadlock).
   */
  private async lockDevicesWithin(tx: Tx, ids: (string | null | undefined)[]): Promise<void> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();
    if (unique.length === 0) return;
    await tx.select({ id: deviceTable.id }).from(deviceTable).where(inArray(deviceTable.id, unique)).orderBy(asc(deviceTable.id)).for('update');
  }

  private async assertInLayoutWithin(tx: Tx, deviceId: string, labels: string[]): Promise<void> {
    const [row] = await tx.select({ code: deviceTable.code, layout: deviceTable.portLayout }).from(deviceTable).where(eq(deviceTable.id, deviceId));
    const layout = row?.layout ?? [];
    if (layout.length === 0) return;
    const listed = new Set(layout.map((p) => p.label.toLowerCase()));
    const missing = labels.filter((label) => !listed.has(label.toLowerCase()));
    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'PORT_NOT_IN_LAYOUT',
        message: `${row?.code ?? ''} không có cổng ${missing.join(', ')} — chọn dải nằm trong danh sách cổng của máy, hoặc thêm cổng ở tab Sơ đồ cổng trước.`,
      });
    }
  }

  /**
   * Khai dây vào một cổng KHÔNG có trong danh sách cổng của máy (máy đã có danh sách): cổng được thêm
   * làm cổng riêng — web hỏi "Thêm cổng riêng …?" trước khi gửi. Máy chưa có danh sách giữ cách cũ.
   */
  private async ensureListedWithin(tx: Tx, actor: string, deviceId: string, label: string | null): Promise<void> {
    const name = label?.trim();
    if (!name) return;
    // Khoá hàng máy: hai lượt khai dây cùng lúc vào hai cổng mới đọc cùng một danh sách rồi ghi đè nhau.
    const [row] = await tx.select({ layout: deviceTable.portLayout }).from(deviceTable).where(eq(deviceTable.id, deviceId)).for('update');
    const layout = row?.layout ?? [];
    if (layout.length === 0 || layout.some((p) => p.label.toLowerCase() === name.toLowerCase())) return;
    const next = [...layout, { label: name, kind: 'other' as const }];
    await this.devices.updateWithin(tx, deviceId, { portLayout: next });
    await this.devices.recordWithin(tx, actor, deviceId, 'ports-layout', { portLayout: { before: portLayoutSummary(layout), after: portLayoutSummary(next) } });
  }

  private async insertWithin(tx: Tx, actor: string, deviceId: string, values: Record<string, unknown>): Promise<string> {
    await this.lockDevicesWithin(tx, [deviceId, values.connectedDeviceId as string | null | undefined]);
    // Máy đã thanh lý thì sơ đồ đấu nối đóng băng — xem `DevicesService.assertNotRetired`.
    // TRONG `tx` và có khoá: hỏi trên pool rồi mới mở transaction là chừa lại đúng khoảng
    // hở để một lượt thanh lý chen vào giữa (xem `assertUsableWithin`).
    await this.devices.assertUsableWithin(tx, deviceId);
    if (values.connectedDeviceId) {
      await this.assertPeerUsableWithin(tx, values.connectedDeviceId as string);
    }
    await this.assertOneCableWithin(tx, deviceId, null, {
      portLabel: values.portLabel as string,
      connectedDeviceId: (values.connectedDeviceId as string | null | undefined) ?? null,
      connectedPort: (values.connectedPort as string | null | undefined) ?? null,
    });
    let inserted;
    try {
      inserted = await tx
        .insert(devicePortTable)
        .values({ ...values, deviceId } as never)
        .returning();
    } catch (error) {
      throw this.translate(error, (values.connectedPort as string | null | undefined) ?? null);
    }
    const after = await this.snapshotWithin(tx, inserted[0].id);
    await this.devices.recordWithin(tx, actor, deviceId, 'port-added', await this.namedChanges(null, after));
    await this.ensureListedWithin(tx, actor, deviceId, values.portLabel as string);
    if (values.connectedDeviceId) await this.ensureListedWithin(tx, actor, values.connectedDeviceId as string, (values.connectedPort as string | null) ?? null);
    return inserted[0].id;
  }

  async update(
    actor: string,
    deviceId: string,
    portId: string,
    input: PortInput,
  ): Promise<PortRow> {
    const values = await this.prepare(deviceId, input, portId);
    await this.db.transaction((tx) => this.updateWithin(tx, actor, deviceId, portId, values));
    return this.requireRow(deviceId, portId);
  }

  private async updateWithin(
    tx: Tx,
    actor: string,
    deviceId: string,
    portId: string,
    values: Record<string, unknown>,
  ): Promise<void> {
    await this.devices.assertUsableWithin(tx, deviceId);
    const before = await this.lockWithin(tx, deviceId, portId);
    if (values.connectedDeviceId && values.connectedDeviceId !== before.connectedDeviceId) {
      await this.assertPeerUsableWithin(tx, values.connectedDeviceId as string);
    }
    // Trạng thái SAU khi sửa: ô không gửi lên thì giữ giá trị đang có.
    await this.assertOneCableWithin(tx, deviceId, portId, {
      portLabel: (values.portLabel as string | undefined) ?? before.snapshot.portLabel,
      connectedDeviceId:
        values.connectedDeviceId !== undefined
          ? (values.connectedDeviceId as string | null)
          : before.connectedDeviceId,
      connectedPort:
        values.connectedPort !== undefined
          ? (values.connectedPort as string | null)
          : before.snapshot.connectedPort,
    });
    let updated;
    try {
      updated = await tx
        .update(devicePortTable)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(devicePortTable.id, portId))
        .returning({ id: devicePortTable.id });
    } catch (error) {
      throw this.translate(
        error,
        values.connectedPort !== undefined
          ? (values.connectedPort as string | null)
          : before.snapshot.connectedPort,
      );
    }
    if (updated.length === 0) throw portNotFound();
    const changes = await this.namedChanges(before.snapshot, await this.snapshotWithin(tx, portId));
    if (!hasPortChange(changes)) return;
    await this.devices.recordWithin(tx, actor, deviceId, 'port-updated', changes);
  }

  async remove(actor: string, deviceId: string, portId: string): Promise<void> {
    /*
     * GỠ cũng chặn, có chủ ý. Sơ đồ đấu nối của một máy đã thanh lý là bằng chứng "hồi đó nó
     * cắm vào đâu" — xóa sau khi máy đã đi là làm mất đúng thứ người ta cần lúc truy vết.
     */
    await this.db.transaction(async (tx) => {
      await this.devices.assertUsableWithin(tx, deviceId);
      const before = await this.lockWithin(tx, deviceId, portId);
      const deleted = await tx
        .delete(devicePortTable)
        .where(eq(devicePortTable.id, portId))
        .returning({ id: devicePortTable.id });
      if (deleted.length === 0) throw portNotFound();
      await this.devices.recordWithin(
        tx,
        actor,
        deviceId,
        'port-removed',
        await this.namedChanges(before.snapshot, null),
      );
    });
  }

  // ───────────── Sợi dây giữa hai máy (sơ đồ mạng — Q-23 "vẽ là khai, có hỏi") ─────────────

  /**
   * Khai MỘT sợi dây giữa hai máy có hồ sơ. Cổng đã có dòng "trống" (chỉ VLAN/người dùng, chưa
   * nối đâu) thì nối luôn dòng đó thay vì đẻ dòng thứ hai — trước ở đầu này, rồi ở đầu kia; không
   * có thì thêm dòng ở máy này. Cùng luật một cổng một cáp như mọi đường ghi khác (Q-20).
   */
  async link(actor: string, deviceId: string, input: LinkInput): Promise<PortLink> {
    const portLabel = input.portLabel.trim();
    if (!portLabel) throw new BadRequestException({ code: 'FIELD_REQUIRED', message: 'Thiếu tên cổng.' });
    if (input.connectedDeviceId === deviceId) {
      throw new BadRequestException({ code: 'PORT_SELF_LINK', message: 'Không thể cắm thiết bị vào chính nó.' });
    }
    const peerId = input.connectedDeviceId;
    const peerPort = input.connectedPort?.trim() || null;
    const cableTypeId = input.cableTypeId || null;
    await this.devices.assertCableTypeChoice(cableTypeId, null);
    const id = await this.db.transaction(async (tx) => {
      await this.lockDevicesWithin(tx, [deviceId, peerId]);
      const own = await this.rowByLabelWithin(tx, deviceId, portLabel);
      if (own?.free) {
        await this.updateWithin(tx, actor, deviceId, own.id, { connectedDeviceId: peerId, connectedLabel: null, connectedPort: peerPort, cableTypeId });
        await this.ensureListedWithin(tx, actor, deviceId, portLabel);
        await this.ensureListedWithin(tx, actor, peerId, peerPort);
        return own.id;
      }
      if (own) throw await this.portBusy(tx, deviceId, own.portLabel);
      const theirs = peerPort ? await this.rowByLabelWithin(tx, peerId, peerPort) : null;
      if (theirs?.free) {
        await this.updateWithin(tx, actor, peerId, theirs.id, { connectedDeviceId: deviceId, connectedLabel: null, connectedPort: portLabel, cableTypeId });
        await this.ensureListedWithin(tx, actor, deviceId, portLabel);
        await this.ensureListedWithin(tx, actor, peerId, peerPort);
        return theirs.id;
      }
      if (theirs) throw await this.portBusy(tx, peerId, theirs.portLabel);
      return this.insertWithin(tx, actor, deviceId, { portLabel, connectedDeviceId: peerId, connectedPort: peerPort, cableTypeId });
    });
    const link = (await this.linksByIds([id])).get(id);
    if (!link) throw portNotFound();
    return link;
  }

  /**
   * Gỡ sợi dây của một dòng ("Gỡ luôn kết nối" trên sơ đồ). Dòng còn ghi VLAN/người dùng/ghi chú
   * thì chỉ bỏ phần đầu kia + loại dây (cổng vẫn khai đó); không còn gì thì xoá cả dòng.
   */
  async unlink(actor: string, deviceId: string, portId: string): Promise<{ removed: boolean }> {
    const [row] = await this.db
      .select({ vlan: devicePortTable.vlan, usedBy: devicePortTable.usedBy, note: devicePortTable.note })
      .from(devicePortTable)
      .where(and(eq(devicePortTable.id, portId), eq(devicePortTable.deviceId, deviceId)));
    if (!row) throw portNotFound();
    if (!row.vlan && !row.usedBy && !row.note) {
      await this.remove(actor, deviceId, portId);
      return { removed: true };
    }
    await this.db.transaction((tx) =>
      this.updateWithin(tx, actor, deviceId, portId, { connectedDeviceId: null, connectedLabel: null, connectedPort: null, cableTypeId: null }),
    );
    return { removed: false };
  }

  /** Bảng xem trước "máy → cổng" của Nối hàng loạt — cùng hàm chia cổng với lượt ghi. */
  async bulkPlan(deviceId: string, input: { startPort: string; endPort?: string | null; count: number }) {
    const taken = await this.takenLabels(this.db, deviceId);
    const plan = planBulkPorts({ start: input.startPort, end: input.endPort, count: input.count, taken });
    return { ports: plan.ports, reason: plan.reason ? BULK_REASON[plan.reason] : null };
  }

  /**
   * Nối một switch với N máy trong MỘT transaction: cổng không đủ, hay một máy vướng luật một
   * cổng một cáp, thì không ghi máy nào — nửa lô đã nối nửa lô không là thứ không ai dọn nổi.
   */
  async bulkLink(actor: string, deviceId: string, input: BulkLinkInput): Promise<PortLink[]> {
    const targets = input.targets;
    if (new Set(targets).size !== targets.length) {
      throw new BadRequestException({ code: 'BULK_LINK_DUPLICATE', message: 'Một máy được chọn hai lần.' });
    }
    if (targets.includes(deviceId)) {
      throw new BadRequestException({ code: 'PORT_SELF_LINK', message: 'Không thể cắm thiết bị vào chính nó.' });
    }
    const cableTypeId = input.cableTypeId || null;
    await this.devices.assertCableTypeChoice(cableTypeId, null);
    const peerPort = input.peerPort?.trim() || null;
    const ids = await this.db.transaction(async (tx) => {
      await this.lockDevicesWithin(tx, [deviceId, ...targets]);
      await this.devices.assertUsableWithin(tx, deviceId);
      const plan = planBulkPorts({
        start: input.startPort,
        end: input.endPort,
        count: targets.length,
        taken: await this.takenLabels(tx, deviceId),
      });
      if (plan.reason) throw new BadRequestException({ code: 'BULK_LINK_INVALID', message: BULK_REASON[plan.reason] });
      // Máy có danh sách cổng: dải đánh số không được vượt cổng thật của máy (nối hàng loạt không hỏi
      // "Thêm cổng riêng?" như hộp khai một dây).
      await this.assertInLayoutWithin(tx, deviceId, plan.ports);
      if (peerPort) for (const target of targets) await this.assertInLayoutWithin(tx, target, [peerPort]);
      const out: string[] = [];
      for (let i = 0; i < targets.length; i += 1) {
        const own = await this.rowByLabelWithin(tx, deviceId, plan.ports[i]);
        const values = { connectedDeviceId: targets[i], connectedLabel: null, connectedPort: peerPort, cableTypeId };
        if (own) {
          await this.updateWithin(tx, actor, deviceId, own.id, values);
          out.push(own.id);
        } else {
          out.push(await this.insertWithin(tx, actor, deviceId, { portLabel: plan.ports[i], ...values }));
        }
      }
      return out;
    });
    const links = await this.linksByIds(ids);
    return ids.map((id) => links.get(id)).filter((link): link is PortLink => Boolean(link));
  }

  /**
   * Dây theo id dòng (= `ims_link_id`). Dòng không còn, hay không còn nối tới một máy có hồ sơ,
   * thì VẮNG MẶT — sơ đồ coi đó là "kết nối đã bị gỡ" (nét đỏ).
   */
  async linksByIds(ids: string[]): Promise<Map<string, PortLink>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.linkRows(inArray(devicePortTable.id, unique));
    return new Map(rows.map((link) => [link.id, link]));
  }

  /**
   * Cổng ĐÃ KHAI / ĐANG DÙNG của từng máy (thẻ máy trên sơ đồ, Q-23). Đã khai = dòng sơ đồ
   * cổng của chính máy + dòng máy khác giữ mà trỏ tới nó (một kết nối là một dòng, AD-14); đang dùng =
   * dòng có đầu kia (máy kho, chữ tự do, người dùng). Kho chưa có số cổng vật lý nên "đã khai" là
   * mẫu số thật duy nhất. Dòng của máy đã thanh lý không chiếm cổng nên không đếm.
   */
  async portUsage(deviceIds: string[]): Promise<Map<string, { used: number; declared: number }>> {
    const unique = [...new Set(deviceIds)];
    const out = new Map(unique.map((id) => [id, { used: 0, declared: 0 }]));
    if (unique.length === 0) return out;
    const busy = sql<boolean>`(${devicePortTable.connectedDeviceId} IS NOT NULL OR ${devicePortTable.connectedLabel} IS NOT NULL OR ${devicePortTable.usedBy} IS NOT NULL)`;
    const [own, incoming] = await Promise.all([
      this.db
        .select({ id: devicePortTable.deviceId, declared: sql<number>`count(*)::int`, used: sql<number>`count(*) FILTER (WHERE ${busy})::int` })
        .from(devicePortTable)
        .where(and(inArray(devicePortTable.deviceId, unique), NOT_OWNER_RETIRED))
        .groupBy(devicePortTable.deviceId),
      this.db
        .select({ id: devicePortTable.connectedDeviceId, count: sql<number>`count(*)::int` })
        .from(devicePortTable)
        .where(and(inArray(devicePortTable.connectedDeviceId, unique), NOT_OWNER_RETIRED))
        .groupBy(devicePortTable.connectedDeviceId),
    ]);
    for (const row of own) {
      const at = out.get(row.id);
      if (at) Object.assign(at, { used: at.used + row.used, declared: at.declared + row.declared });
    }
    for (const row of incoming) {
      const at = row.id ? out.get(row.id) : undefined;
      if (at) Object.assign(at, { used: at.used + row.count, declared: at.declared + row.count });
    }
    // Máy có danh sách cổng (Q-26): mẫu số là tổng cổng vật lý ("cổng 12/52"), không phải số dòng đã khai.
    const layouts = await this.db.select({ id: deviceTable.id, layout: deviceTable.portLayout }).from(deviceTable).where(inArray(deviceTable.id, unique));
    for (const row of layouts) {
      const at = out.get(row.id);
      if (at && (row.layout ?? []).length > 0) at.declared = Math.max(row.layout.length, at.used);
    }
    return out;
  }

  /** Mọi dây chạm ít nhất một máy trong danh sách (dòng của máy đã thanh lý không tính). */
  async linksTouching(deviceIds: string[]): Promise<PortLink[]> {
    const unique = [...new Set(deviceIds)];
    if (unique.length === 0) return [];
    return this.linkRows(
      and(
        or(inArray(devicePortTable.deviceId, unique), inArray(devicePortTable.connectedDeviceId, unique)),
        NOT_OWNER_RETIRED,
      ),
    );
  }

  private async linkRows(where: SQL | undefined): Promise<PortLink[]> {
    const rows = await this.db
      .select({ port: devicePortTable, ownerCode: deviceTable.code })
      .from(devicePortTable)
      .innerJoin(deviceTable, eq(deviceTable.id, devicePortTable.deviceId))
      .where(and(where, isNotNull(devicePortTable.connectedDeviceId)));
    const peerIds = [...new Set(rows.map((r) => r.port.connectedDeviceId as string))];
    const peers = peerIds.length
      ? await this.db.select({ id: deviceTable.id, code: deviceTable.code }).from(deviceTable).where(inArray(deviceTable.id, peerIds))
      : [];
    const peerCode = new Map(peers.map((p) => [p.id, p.code]));
    return rows.map(({ port, ownerCode }) => ({
      id: port.id,
      deviceId: port.deviceId,
      deviceCode: ownerCode,
      portLabel: port.portLabel,
      peerDeviceId: port.connectedDeviceId as string,
      peerDeviceCode: peerCode.get(port.connectedDeviceId as string) ?? '',
      peerPort: port.connectedPort,
      cableTypeId: port.cableTypeId,
      vlan: port.vlan,
      note: port.note,
    }));
  }

  /** Dòng của một cổng (không phân biệt hoa/thường), khoá tới hết `tx`; `free` = chưa nối đâu. */
  private async rowByLabelWithin(
    tx: Tx,
    deviceId: string,
    label: string,
  ): Promise<{ id: string; portLabel: string; free: boolean } | null> {
    const [row] = await tx
      .select({
        id: devicePortTable.id,
        portLabel: devicePortTable.portLabel,
        connectedDeviceId: devicePortTable.connectedDeviceId,
        connectedLabel: devicePortTable.connectedLabel,
      })
      .from(devicePortTable)
      .where(and(eq(devicePortTable.deviceId, deviceId), sql`lower(${devicePortTable.portLabel}) = lower(${label})`))
      .for('update');
    if (!row) return null;
    return { id: row.id, portLabel: row.portLabel, free: !row.connectedDeviceId && !row.connectedLabel };
  }

  private async portBusy(tx: Tx, deviceId: string, label: string): Promise<ConflictException> {
    const [device] = await tx.select({ code: deviceTable.code }).from(deviceTable).where(eq(deviceTable.id, deviceId));
    return new ConflictException({
      code: 'PORT_ALREADY_LINKED',
      message: `Cổng "${label}" của ${device?.code ?? ''} đã có cáp. ${ONE_CABLE_HINT}`,
    });
  }

  /**
   * Cổng ĐÃ CHIẾM của một máy (viết thường): dòng của nó đã nối đi đâu đó, hoặc dòng của máy
   * khác đang cắm vào nó. Dòng chỉ ghi VLAN/người dùng là cổng còn trống.
   */
  private async takenLabels(db: Database | Tx, deviceId: string): Promise<Set<string>> {
    const own = await db
      .select({ label: devicePortTable.portLabel })
      .from(devicePortTable)
      .where(
        and(
          eq(devicePortTable.deviceId, deviceId),
          or(isNotNull(devicePortTable.connectedDeviceId), isNotNull(devicePortTable.connectedLabel)),
        ),
      );
    const incoming = await db
      .select({ label: devicePortTable.connectedPort })
      .from(devicePortTable)
      .where(
        and(
          eq(devicePortTable.connectedDeviceId, deviceId),
          isNotNull(devicePortTable.connectedPort),
          NOT_OWNER_RETIRED,
        ),
      );
    return new Set([...own, ...incoming].map((r) => (r.label ?? '').toLowerCase()).filter(Boolean));
  }

  private async prepare(
    deviceId: string,
    input: PortInput,
    portId: string | null,
  ): Promise<Record<string, unknown>> {
    const values: Record<string, unknown> = {};
    if (input.portLabel !== undefined) {
      const label = input.portLabel.trim();
      if (!label) {
        throw new BadRequestException({ code: 'FIELD_REQUIRED', message: 'Thiếu tên cổng.' });
      }
      values.portLabel = label;
    }
    if (input.connectedDeviceId !== undefined) {
      const peerId = input.connectedDeviceId || null;
      if (peerId) {
        if (peerId === deviceId) {
          throw new BadRequestException({
            code: 'PORT_SELF_LINK',
            message: 'Không thể cắm thiết bị vào chính nó.',
          });
        }
        const peer = await this.db
          .select({ id: deviceTable.id })
          .from(deviceTable)
          .where(eq(deviceTable.id, peerId));
        if (peer.length === 0) {
          throw new BadRequestException({
            code: 'DEVICE_NOT_FOUND',
            message: 'Thiết bị đầu kia không tồn tại.',
          });
        }
      }
      values.connectedDeviceId = peerId;
    }
    if (input.vlan !== undefined) {
      const vlan = portVlanOf(input.vlan ?? '');
      if (!vlan.valid) {
        throw new BadRequestException({
          code: 'PORT_VLAN_INVALID',
          message: 'VLAN phải là số từ 1 đến 4094, hoặc "trunk".',
        });
      }
      values.vlan = vlan.value;
    }
    if (input.cableTypeId !== undefined) {
      const next = input.cableTypeId || null;
      let current: string | null = null;
      if (portId) {
        const [row] = await this.db
          .select({ cableTypeId: devicePortTable.cableTypeId })
          .from(devicePortTable)
          .where(eq(devicePortTable.id, portId));
        current = row?.cableTypeId ?? null;
      }
      await this.devices.assertCableTypeChoice(next, current);
      values.cableTypeId = next;
    }
    for (const key of ['connectedLabel', 'connectedPort', 'usedBy', 'note'] as const) {
      if (input[key] !== undefined) {
        const text = input[key]?.trim();
        values[key] = text ? text : null;
      }
    }
    // Trùng tên cổng trong cùng thiết bị: bắt sớm để câu lỗi nói được TÊN CỔNG,
    // thay vì để unique constraint bắn ra một câu SQL. Không phân biệt hoa/thường (Q-20), như
    // chỉ mục `device_port_label_key`; câu lỗi dùng tên đang có để người ta tìm ra dòng đó.
    const label = values.portLabel as string | undefined;
    if (label) {
      const clash = await this.db
        .select({ portLabel: devicePortTable.portLabel })
        .from(devicePortTable)
        .where(
          and(
            eq(devicePortTable.deviceId, deviceId),
            sql`lower(${devicePortTable.portLabel}) = lower(${label})`,
            portId ? ne(devicePortTable.id, portId) : undefined,
          ),
        );
      if (clash.length > 0) {
        throw new ConflictException({
          code: 'PORT_LABEL_TAKEN',
          message: `Thiết bị này đã có dòng cho cổng "${clash[0].portLabel}".`,
        });
      }
    }
    return values;
  }

  /**
   * Không cắm cổng sang máy đã thanh lý: lượt thanh lý gỡ mọi liên kết trỏ vào máy đó
   * (`PortDeviceRetirement`), nên cắm mới vào là dựng lại đúng thứ nó vừa dọn.
   *
   * TRONG `tx` và `FOR SHARE` trên hàng máy đầu kia — bắt cặp với `FOR UPDATE` của
   * `setStatus`: kiểm trên pool rồi mới ghi là chừa khe cho lượt thanh lý chen vào giữa.
   */
  private async assertPeerUsableWithin(tx: Tx, peerId: string): Promise<void> {
    const peer = await this.devices.requireRowWithin(tx, peerId, 'share');
    if (peer.status === 'retired') {
      throw new BadRequestException({
        code: 'PORT_PEER_RETIRED',
        message: `Thiết bị đầu kia ${peer.code} đã thanh lý — không cắm cổng sang máy đã thanh lý.`,
      });
    }
  }

  /**
   * Khoá dòng cổng (của ĐÚNG thiết bị này) tới hết `tx` rồi mới chụp "trước khi sửa".
   *
   * Đọc trên pool rồi mới ghi thì một lượt gỡ của người khác commit vào giữa làm câu
   * UPDATE/DELETE không chạm hàng nào, mà lịch sử vẫn ghi "đã sửa/đã gỡ". Có khoá thì lượt đến
   * sau chờ, rồi thấy hàng đã mất → 404.
   */
  private async lockWithin(
    tx: Tx,
    deviceId: string,
    portId: string,
  ): Promise<{ connectedDeviceId: string | null; snapshot: PortSnapshot }> {
    const locked = await tx
      .select({ connectedDeviceId: devicePortTable.connectedDeviceId })
      .from(devicePortTable)
      .where(and(eq(devicePortTable.id, portId), eq(devicePortTable.deviceId, deviceId)))
      .for('update');
    if (locked.length === 0) throw portNotFound();
    return {
      connectedDeviceId: locked[0].connectedDeviceId,
      snapshot: await this.snapshotWithin(tx, portId),
    };
  }

  /** Ảnh chụp một dòng port map trong `tx` (kèm mã máy đầu kia) để ghi lịch sử. */
  private async snapshotWithin(tx: Tx, portId: string): Promise<PortSnapshot> {
    const [row] = await tx
      .select({ port: devicePortTable, peerCode: deviceTable.code })
      .from(devicePortTable)
      .leftJoin(deviceTable, eq(devicePortTable.connectedDeviceId, deviceTable.id))
      .where(eq(devicePortTable.id, portId));
    return {
      portLabel: row.port.portLabel,
      connectedDevice: row.peerCode ?? null,
      connectedLabel: row.port.connectedLabel,
      connectedPort: row.port.connectedPort,
      cableType: row.port.cableTypeId,
      vlan: row.port.vlan,
      usedBy: row.port.usedBy,
      note: row.port.note,
    };
  }

  /**
   * Trước/sau của lịch sử, loại dây đổi từ id sang TÊN — tab Lịch sử không ai đọc uuid. Chỉ hỏi
   * danh mục khi có loại dây để tra.
   */
  private async namedChanges(before: PortSnapshot | null, after: PortSnapshot | null): Promise<RecordChanges> {
    if (before?.cableType || after?.cableType) {
      const names = await this.devices.cableTypeNames();
      for (const snap of [before, after]) {
        if (snap?.cableType) snap.cableType = names.get(snap.cableType) ?? snap.cableType;
      }
    }
    return portChanges(before, after);
  }

  private async requireRow(deviceId: string, portId: string): Promise<PortRow> {
    const map = await this.listFor(deviceId);
    const found = map.ports.find((port) => port.id === portId);
    if (!found) throw portNotFound();
    return found;
  }

  /**
   * MỘT CỔNG MỘT SỢI CÁP, kiểm cả hai chiều (Q-20). Một sợi dây có hai đầu: đầu GHI
   * (`device_id`, `port_label`) và đầu KIA (`connected_device_id`, `connected_port`). Một cổng
   * không được làm đầu của hai sợi khác nhau, dù nó xuất hiện ở cột GHI của dòng này và cột KIA
   * của dòng khác. Ngoại lệ duy nhất là dòng ngược của CÙNG sợi (X:p1→Y:g1 và Y:g1→X:p1).
   *
   * Chỉ dây nối tới thiết bị CÓ HỒ SƠ mới chiếm cổng. Dòng chỉ ghi VLAN/người dùng, hay đầu kia
   * chỉ là chữ (máy chưa có hồ sơ, hoặc nhãn "(đã thanh lý)" mà `PortDeviceRetirement` để lại)
   * thì không — chặn theo chữ là bắt người ta sửa dòng cũ trước khi được khai máy thật vào.
   * Dòng của máy đã thanh lý cũng không tính, cùng lý do với `device_port_peer_port_key`.
   *
   * Phần "trùng ở cùng một cột" có chỉ mục duy nhất giữ; phần chéo cột thì không chỉ mục nào
   * diễn đạt được, nên mọi lượt ghi khoá advisory theo TỪNG CỔNG mình chạm (đầu ghi + đầu kia)
   * trước khi đọc. Hai lượt đụng cùng một cổng thì xếp hàng; lượt sau đọc thấy dòng lượt trước
   * vừa commit. Khoá theo thứ tự chuỗi để hai lượt khoá chéo hai cổng không deadlock.
   */
  private async assertOneCableWithin(
    tx: Tx,
    deviceId: string,
    portId: string | null,
    row: { portLabel: string; connectedDeviceId: string | null; connectedPort: string | null },
  ): Promise<void> {
    const peerId = row.connectedDeviceId;
    const peerPort = peerId ? row.connectedPort : null;
    const ends: Array<[string, string]> = [[deviceId, row.portLabel]];
    if (peerId && peerPort) ends.push([peerId, peerPort]);
    ends.sort((a, b) => portKey(...a).localeCompare(portKey(...b)));
    for (const [id, label] of ends) {
      // `lower()` của Postgres, không phải của JS: khoá phải băm đúng thứ hai chỉ mục so.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${PORT_LOCK_CLASS}, hashtext(${id}::text || '/' || lower(${label}::text)))`,
      );
    }
    if (!peerId) return;
    const self = portId ?? '00000000-0000-0000-0000-000000000000';

    // Đầu GHI của dòng này đã là đầu KIA của một sợi khác.
    const incoming = await tx.execute<{ owner_code: string; port_label: string }>(sql`
      SELECT d.code AS owner_code, p.port_label
        FROM device_port p JOIN device d ON d.id = p.device_id
       WHERE p.connected_device_id = ${deviceId}::uuid
         AND lower(p.connected_port) = lower(${row.portLabel})
         AND NOT p.owner_retired
         AND p.id <> ${self}::uuid
         AND NOT (p.device_id = ${peerId}::uuid
                  AND (${peerPort}::text IS NULL OR lower(p.port_label) = lower(${peerPort}::text)))
       LIMIT 1`);
    if (incoming.rows.length > 0) {
      const hit = incoming.rows[0];
      throw new ConflictException({
        code: 'PORT_ALREADY_LINKED',
        message:
          `Cổng "${row.portLabel}" của thiết bị này đã có cáp nối từ ${hit.owner_code} cổng ` +
          `"${hit.port_label}". ${ONE_CABLE_HINT}`,
      });
    }
    if (!peerPort) return;

    const [peer] = await tx
      .select({ code: deviceTable.code })
      .from(deviceTable)
      .where(eq(deviceTable.id, peerId));

    // Đầu KIA đã có một dòng khác cắm vào (cùng việc với `device_port_peer_port_key`, nhưng
    // làm trước để câu lỗi nói được máy nào đang giữ cổng).
    const taken = await tx.execute<{ owner_code: string; port_label: string; connected_port: string }>(sql`
      SELECT d.code AS owner_code, p.port_label, p.connected_port
        FROM device_port p JOIN device d ON d.id = p.device_id
       WHERE p.connected_device_id = ${peerId}::uuid
         AND lower(p.connected_port) = lower(${peerPort})
         AND NOT p.owner_retired
         AND p.id <> ${self}::uuid
       LIMIT 1`);
    if (taken.rows.length > 0) {
      const hit = taken.rows[0];
      throw new ConflictException({
        code: 'PORT_PEER_TAKEN',
        message:
          `Cổng "${hit.connected_port}" của ${peer.code} đã có cáp nối từ ${hit.owner_code} cổng ` +
          `"${hit.port_label}". ${ONE_CABLE_HINT}`,
      });
    }

    // Đầu KIA, nhìn từ dòng của chính máy kia, đã nối sang nơi khác.
    const outgoing = await tx.execute<{ port_label: string; target_code: string; connected_port: string | null }>(sql`
      SELECT p.port_label, d.code AS target_code, p.connected_port
        FROM device_port p JOIN device d ON d.id = p.connected_device_id
       WHERE p.device_id = ${peerId}::uuid
         AND lower(p.port_label) = lower(${peerPort})
         AND NOT p.owner_retired
         AND NOT (p.connected_device_id = ${deviceId}::uuid
                  AND (p.connected_port IS NULL OR lower(p.connected_port) = lower(${row.portLabel})))
       LIMIT 1`);
    if (outgoing.rows.length > 0) {
      const hit = outgoing.rows[0];
      const target = hit.connected_port
        ? `${hit.target_code} cổng "${hit.connected_port}"`
        : hit.target_code;
      throw new ConflictException({
        code: 'PORT_PEER_TAKEN',
        message: `Cổng "${hit.port_label}" của ${peer.code} đã có cáp nối sang ${target}. ${ONE_CABLE_HINT}`,
      });
    }
  }

  private translate(error: unknown, peerPort: string | null): unknown {
    const peerTaken = conflictOnUnique(
      error,
      {
        code: 'PORT_PEER_TAKEN',
        message:
          `Cổng ${peerPort ? `"${peerPort}" ` : ''}của thiết bị đầu kia đã có một dòng port map ` +
          'khác ghi đấu vào. Sửa dòng đang có thay vì thêm dòng mới.',
      },
      'device_port_peer_port_key',
    );
    if (peerTaken !== error) return peerTaken;
    return conflictOnUnique(
      error,
      { code: 'PORT_LABEL_TAKEN', message: 'Thiết bị này đã có dòng cho cổng đó.' },
      'device_port_label_key',
    );
  }
}
