import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import type {
  DeviceTimelineEntry,
  DeviceTimelineProvider,
} from '../../common/device-timeline.registry';
import { DeviceTimelineRegistry } from '../../common/device-timeline.registry';
import { UI_PATHS } from '../../common/ui-paths';
import { DRIZZLE_DB, type Database } from '../../database/database.module';
import { ipAddressTable, ipHistoryTable } from './ipam.schema';

type Changes = Record<string, unknown> | null;

/**
 * Một dòng `ip_history` có nghĩa gì với MỘT máy: IP về tay máy (`ip-assigned`), rời máy
 * (`ip-released`), hay không liên quan (`null`).
 *
 * Ba bộ ghi lịch sử IP ghi chủ theo ba hình dạng khác nhau: lúc tạo `deviceId` phẳng, lúc
 * chuyển trạng thái cặp `previousDeviceId`/`deviceId`, lúc sửa hồ sơ `deviceId: {before, after}`.
 * Đọc sai một hình dạng là máy "chưa từng dùng IP nào" trong khi nó đã dùng.
 */
export function ipDeviceEvent(
  row: { action: string; changes: Changes },
  deviceId: string,
): 'ip-assigned' | 'ip-released' | null {
  const changes = row.changes;
  if (!changes) return null;
  const owner = changes.deviceId;
  if (owner && typeof owner === 'object') {
    const pair = owner as { before?: unknown; after?: unknown };
    if (pair.after === deviceId && pair.before !== deviceId) return 'ip-assigned';
    if (pair.before === deviceId && pair.after !== deviceId) return 'ip-released';
    return null;
  }
  if ('previousDeviceId' in changes) {
    if (owner === deviceId && changes.previousDeviceId !== deviceId) return 'ip-assigned';
    if (changes.previousDeviceId === deviceId && owner !== deviceId) return 'ip-released';
    return null;
  }
  return owner === deviceId ? 'ip-assigned' : null;
}

/** "Máy này từng dùng IP nào, từ khi nào tới khi nào" — nguồn `ipam` của dòng thời gian thiết bị. */
@Injectable()
export class IpDeviceTimeline implements DeviceTimelineProvider, OnModuleInit {
  readonly source = 'ipam';

  constructor(
    private readonly registry: DeviceTimelineRegistry,
    @Inject(DRIZZLE_DB) private readonly db: Database,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async timelineFor(deviceId: string, limit: number): Promise<DeviceTimelineEntry[]> {
    const rows = await this.db
      .select({
        id: ipHistoryTable.id,
        action: ipHistoryTable.action,
        actor: ipHistoryTable.actor,
        changes: ipHistoryTable.changes,
        createdAt: ipHistoryTable.createdAt,
        address: ipAddressTable.address,
        subnetId: ipAddressTable.subnetId,
      })
      .from(ipHistoryTable)
      .innerJoin(ipAddressTable, eq(ipAddressTable.id, ipHistoryTable.ipAddressId))
      .where(
        sql`(${ipHistoryTable.changes} ->> 'deviceId' = ${deviceId}
          OR ${ipHistoryTable.changes} ->> 'previousDeviceId' = ${deviceId}
          OR ${ipHistoryTable.changes} -> 'deviceId' ->> 'before' = ${deviceId}
          OR ${ipHistoryTable.changes} -> 'deviceId' ->> 'after' = ${deviceId})`,
      )
      .orderBy(desc(ipHistoryTable.createdAt))
      .limit(limit);
    const out: DeviceTimelineEntry[] = [];
    for (const row of rows) {
      const action = ipDeviceEvent({ action: row.action, changes: row.changes as Changes }, deviceId);
      if (!action) continue;
      out.push({
        id: row.id,
        source: this.source,
        action,
        at: row.createdAt,
        actor: row.actor,
        subject: row.address,
        link: UI_PATHS.subnetAt(row.subnetId, row.address),
      });
    }
    return out;
  }
}
