import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { diffRecord, type RecordChanges } from '../../common/record-diff';
import { conflictOnUnique } from '../../common/sql';
import type { Tx } from '../../common/tx';
import { devicePortTable, deviceTable } from './devices.schema';
import { DevicesService } from './devices.service';
import { portVlanOf } from './port-vlan';

export interface PortInput {
  portLabel?: string;
  connectedDeviceId?: string | null;
  connectedLabel?: string | null;
  connectedPort?: string | null;
  usedBy?: string | null;
  vlan?: string | null;
  note?: string | null;
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
}

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
    const id = await this.db.transaction(async (tx) => {
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
      await this.devices.recordWithin(tx, actor, deviceId, 'port-added', portChanges(null, after));
      return inserted[0].id;
    });
    return this.requireRow(deviceId, id);
  }

  async update(
    actor: string,
    deviceId: string,
    portId: string,
    input: PortInput,
  ): Promise<PortRow> {
    const values = await this.prepare(deviceId, input, portId);
    await this.db.transaction(async (tx) => {
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
      const changes = portChanges(before.snapshot, await this.snapshotWithin(tx, portId));
      if (!hasPortChange(changes)) return;
      await this.devices.recordWithin(tx, actor, deviceId, 'port-updated', changes);
    });
    return this.requireRow(deviceId, portId);
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
        portChanges(before.snapshot, null),
      );
    });
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
      vlan: row.port.vlan,
      usedBy: row.port.usedBy,
      note: row.port.note,
    };
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
