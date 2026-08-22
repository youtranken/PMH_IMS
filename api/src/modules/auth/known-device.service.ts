import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { knownDeviceTable } from '../users/users.schema';

/**
 * Nhớ thiết bị đã từng đăng nhập (NFR-01) để chỉ báo email khi có thiết bị LẠ —
 * không phải mỗi lần đăng nhập.
 */
@Injectable()
export class KnownDeviceService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  /** Trả `true` nếu đây là thiết bị MỚI (vừa được ghi lần đầu). */
  async rememberWithin(
    tx: Tx,
    userId: string,
    deviceHash: string,
    label: string | null,
  ): Promise<boolean> {
    const existing = await this.db
      .select({ id: knownDeviceTable.id })
      .from(knownDeviceTable)
      .where(
        and(eq(knownDeviceTable.userId, userId), eq(knownDeviceTable.deviceHash, deviceHash)),
      );
    if (existing.length > 0) {
      await tx
        .update(knownDeviceTable)
        .set({ lastSeenAt: new Date() })
        .where(eq(knownDeviceTable.id, existing[0].id));
      return false;
    }
    await tx.insert(knownDeviceTable).values({
      userId,
      deviceHash,
      label: label ? label.slice(0, 200) : null,
    });
    return true;
  }
}
