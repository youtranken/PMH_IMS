import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import type {
  DeviceTimelineEntry,
  DeviceTimelineProvider,
} from '../../common/device-timeline.registry';
import { DeviceTimelineRegistry } from '../../common/device-timeline.registry';
import { UI_PATHS } from '../../common/ui-paths';
import { DRIZZLE_DB, type Database } from '../../database/database.module';
import { licenseAssignmentTable, softwareTable } from './software.schema';

/**
 * "Máy này từng dùng key nào" — nguồn `software` của dòng thời gian thiết bị (DEV-086).
 *
 * Đọc thẳng `license_assignment` (bảng của chính module này, AD-3): gỡ ghế không xoá dòng mà
 * đánh `released_at`, nên mỗi ghế cho hai sự kiện — gán và (nếu có) gỡ.
 */
@Injectable()
export class LicenseDeviceTimeline implements DeviceTimelineProvider, OnModuleInit {
  readonly source = 'software';

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
        id: licenseAssignmentTable.id,
        softwareId: licenseAssignmentTable.softwareId,
        assignedAt: licenseAssignmentTable.assignedAt,
        assignedBy: licenseAssignmentTable.assignedBy,
        releasedAt: licenseAssignmentTable.releasedAt,
        releasedBy: licenseAssignmentTable.releasedBy,
        code: softwareTable.code,
      })
      .from(licenseAssignmentTable)
      .innerJoin(softwareTable, eq(softwareTable.id, licenseAssignmentTable.softwareId))
      .where(eq(licenseAssignmentTable.deviceId, deviceId))
      .orderBy(desc(licenseAssignmentTable.assignedAt))
      .limit(limit);
    const out: DeviceTimelineEntry[] = [];
    for (const row of rows) {
      const link = UI_PATHS.software(row.softwareId);
      out.push({
        id: `${row.id}:assigned`,
        source: this.source,
        action: 'license-assigned',
        at: row.assignedAt,
        actor: row.assignedBy,
        subject: row.code,
        link,
      });
      if (row.releasedAt) {
        out.push({
          id: `${row.id}:released`,
          source: this.source,
          action: 'license-released',
          at: row.releasedAt,
          actor: row.releasedBy ?? '',
          subject: row.code,
          link,
        });
      }
    }
    return out;
  }
}
