import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import { sessionsTable } from './sessions.schema';

export interface SessionRecord {
  id: string;
  userId: string;
  csrfToken: string;
  ip: string | null;
  userAgent: string | null;
  steppedUpAt: Date | null;
  totpPending: boolean;
  createdAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

/**
 * Phiên server-side (AD-8). Cookie chỉ mang id; mọi quyết định sống/chết đọc từ DB
 * để SA đá phiên là chết NGAY, không chờ token hết hạn.
 */
@Injectable()
export class SessionService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  /** Tạo phiên mới TRONG transaction đăng nhập (AD-5). */
  async createWithin(
    tx: Tx,
    params: {
      userId: string;
      ip: string | null;
      userAgent: string | null;
      absoluteHours: number;
      totpPending: boolean;
    },
  ): Promise<SessionRecord> {
    const rows = await tx
      .insert(sessionsTable)
      .values({
        userId: params.userId,
        csrfToken: randomBytes(32).toString('hex'),
        ip: params.ip,
        userAgent: params.userAgent,
        totpPending: params.totpPending,
        absoluteExpiresAt: new Date(Date.now() + params.absoluteHours * 3_600_000),
      })
      .returning();
    return rows[0];
  }

  async find(id: string): Promise<SessionRecord | null> {
    const rows = await this.db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
    return rows[0] ?? null;
  }

  async touch(id: string): Promise<void> {
    await this.db
      .update(sessionsTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessionsTable.id, id));
  }

  /** Qua TOTP đăng nhập: bỏ cờ chờ + đóng dấu step-up trong CÙNG transaction (AD-5). */
  async completeTotpWithin(tx: Tx, id: string): Promise<void> {
    await tx
      .update(sessionsTable)
      .set({ totpPending: false, steppedUpAt: new Date() })
      .where(eq(sessionsTable.id, id));
  }

  /** FR-022: đóng dấu vừa gõ TOTP — grace tính từ mốc này. */
  async markSteppedUp(id: string): Promise<void> {
    await this.db
      .update(sessionsTable)
      .set({ steppedUpAt: new Date() })
      .where(eq(sessionsTable.id, id));
  }

  async revoke(id: string, reason: string): Promise<void> {
    await this.db
      .update(sessionsTable)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessionsTable.id, id), isNull(sessionsTable.revokedAt)));
  }

  /**
   * NFR-01: đổi mật khẩu / reset MFA / SA khóa user → mọi phiên của user chết NGAY.
   * Chạy trong transaction của hành động gây ra nó (AD-5).
   */
  async revokeAllForUserWithin(
    tx: Tx,
    userId: string,
    reason: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const rows = await tx
      .update(sessionsTable)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(sessionsTable.userId, userId),
          isNull(sessionsTable.revokedAt),
          exceptSessionId ? sql`${sessionsTable.id} <> ${exceptSessionId}` : sql`true`,
        ),
      )
      .returning({ id: sessionsTable.id });
    return rows.length;
  }

  /** Danh sách phiên đang mở của một user — màn SA quản trị phiên (story 1.4). */
  async listActive(userId: string): Promise<SessionRecord[]> {
    const rows = await this.db
      .select()
      .from(sessionsTable)
      .where(and(eq(sessionsTable.userId, userId), isNull(sessionsTable.revokedAt)));
    return rows;
  }

  /** Dọn phiên chết quá 30 ngày — chặn bảng phình vô hạn. Gọi từ sweep (worker). */
  async purgeOld(): Promise<number> {
    const rows = await this.db
      .delete(sessionsTable)
      .where(lt(sessionsTable.lastSeenAt, sql`now() - interval '30 days'`))
      .returning({ id: sessionsTable.id });
    return rows.length;
  }
}
