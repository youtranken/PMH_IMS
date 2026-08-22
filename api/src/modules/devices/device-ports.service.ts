import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import { pgErrorCode, PG_UNIQUE_VIOLATION } from '../../common/sql';
import { devicePortTable, deviceTable } from './devices.schema';
import { DevicesService } from './devices.service';

export interface PortInput {
  portLabel?: string;
  connectedDeviceId?: string | null;
  connectedLabel?: string | null;
  connectedPort?: string | null;
  usedBy?: string | null;
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
  note: string | null;
}

/** Chiều ngược: cổng của thiết bị KHÁC đang cắm vào thiết bị đang xem. */
export interface IncomingPortRow {
  id: string;
  /** Thiết bị đang giữ bản ghi (đầu kia của sợi dây). */
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  portLabel: string;
  connectedPort: string | null;
  usedBy: string | null;
  note: string | null;
}

export interface PortMap {
  ports: PortRow[];
  incoming: IncomingPortRow[];
}

/**
 * Port map (story 2.4, AD-14). Thuộc module `devices` vì bảng `device_port` chỉ nói về
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
      let inserted;
      try {
        inserted = await tx
          .insert(devicePortTable)
          .values({ ...values, deviceId } as never)
          .returning();
      } catch (error) {
        throw this.translate(error);
      }
      await this.devices.recordWithin(tx, actor, deviceId, 'port-added', {
        portLabel: { before: null, after: values.portLabel as string },
      });
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
    const before = await this.requireRow(deviceId, portId);
    const values = await this.prepare(deviceId, input, portId);
    await this.db.transaction(async (tx) => {
      try {
        await tx
          .update(devicePortTable)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(devicePortTable.id, portId));
      } catch (error) {
        throw this.translate(error);
      }
      await this.devices.recordWithin(tx, actor, deviceId, 'port-updated', {
        portLabel: {
          before: before.portLabel,
          after: (values.portLabel as string | undefined) ?? before.portLabel,
        },
      });
    });
    return this.requireRow(deviceId, portId);
  }

  async remove(actor: string, deviceId: string, portId: string): Promise<void> {
    const before = await this.requireRow(deviceId, portId);
    await this.db.transaction(async (tx) => {
      await this.devices.recordWithin(tx, actor, deviceId, 'port-removed', {
        portLabel: { before: before.portLabel, after: null },
      });
      await tx.delete(devicePortTable).where(eq(devicePortTable.id, portId));
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
    for (const key of ['connectedLabel', 'connectedPort', 'usedBy', 'note'] as const) {
      if (input[key] !== undefined) {
        const text = input[key]?.trim();
        values[key] = text ? text : null;
      }
    }
    // Trùng tên cổng trong cùng thiết bị: bắt sớm để câu lỗi nói được TÊN CỔNG,
    // thay vì để unique constraint bắn ra một câu SQL.
    const label = values.portLabel as string | undefined;
    if (label) {
      const clash = await this.db
        .select({ id: devicePortTable.id })
        .from(devicePortTable)
        .where(
          and(
            eq(devicePortTable.deviceId, deviceId),
            eq(devicePortTable.portLabel, label),
            portId ? ne(devicePortTable.id, portId) : undefined,
          ),
        );
      if (clash.length > 0) {
        throw new ConflictException({
          code: 'PORT_LABEL_TAKEN',
          message: `Thiết bị này đã có dòng cho cổng "${label}".`,
        });
      }
    }
    return values;
  }

  private async requireRow(deviceId: string, portId: string): Promise<PortRow> {
    const map = await this.listFor(deviceId);
    const found = map.ports.find((port) => port.id === portId);
    if (!found) {
      throw new NotFoundException({
        code: 'PORT_NOT_FOUND',
        message: 'Không tìm thấy dòng port map này.',
      });
    }
    return found;
  }

  private translate(error: unknown): unknown {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      return new ConflictException({
        code: 'PORT_LABEL_TAKEN',
        message: 'Thiết bị này đã có dòng cho cổng đó.',
      });
    }
    return error;
  }
}
