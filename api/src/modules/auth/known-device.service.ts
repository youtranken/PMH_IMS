import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { knownDeviceTable } from './known-device.schema';

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
    // MỘT câu, chạy trong CHÍNH transaction đăng nhập — không đọc-rồi-ghi.
    // Bản cũ `select` bằng `this.db` (pool) rồi mới `insert` bằng `tx`: hai tab đăng nhập
    // cùng lúc từ một máy thì cả hai không thấy hàng, cả hai INSERT, và UNIQUE
    // (user_id, device_hash) của 0008 ném 23505 — không ai bắt, nên 500 và rollback cả
    // lượt đăng nhập. `xmax = 0` là cách Postgres cho biết hàng vừa được CHÈN chứ không
    // phải bị cập nhật, tức đây có đúng là thiết bị lạ hay không.
    const rows = await tx
      .insert(knownDeviceTable)
      .values({
        userId,
        deviceHash,
        label: label ? label.slice(0, 200) : null,
      })
      .onConflictDoUpdate({
        target: [knownDeviceTable.userId, knownDeviceTable.deviceHash],
        set: { lastSeenAt: new Date() },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    return rows[0]?.inserted === true;
  }
}
