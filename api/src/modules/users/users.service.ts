import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '../../database/database.module';
import type { Database } from '../../database/database.module';
import type { Tx } from '../../common/tx';
import type { Page, PageQuery } from '../../common/pagination';
import { pageOffset } from '../../common/pagination';
import type { SealedValue } from '../../common/crypto/envelope.types';
import type { UserRole } from '../auth/types';
import { usersTable } from './users.schema';
import type { UserCredentials, UserRecord } from './users.types';

/**
 * Chủ sở hữu bảng `users` (AD-3). Module khác KHÔNG query bảng này — đi qua UsersApiService.
 * Mọi hàm ghi nhận `tx` tường minh (AD-5).
 */
@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const rows = await this.db.select().from(usersTable).where(eq(usersTable.email, email));
    return rows[0] ? toCredentials(rows[0]) : null;
  }

  async findCredentialsById(id: string): Promise<UserCredentials | null> {
    const rows = await this.db.select().from(usersTable).where(eq(usersTable.id, id));
    return rows[0] ? toCredentials(rows[0]) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const found = await this.findCredentialsById(id);
    return found ? strip(found) : null;
  }

  async list(query: PageQuery): Promise<Page<UserRecord>> {
    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(usersTable)
        .orderBy(asc(usersTable.fullName))
        .limit(query.limit)
        .offset(pageOffset(query)),
      this.db.select({ value: count() }).from(usersTable),
    ]);
    return {
      items: rows.map((r) => strip(toCredentials(r))),
      total: Number(totalRows[0]?.value ?? 0),
    };
  }

  /** Đếm SA đang hoạt động — chặn hạ/khóa SA cuối cùng (NFR-01 "2 SA", dual control). */
  async countActiveSa(exceptUserId?: string): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.role, 'sa'),
          eq(usersTable.status, 'active'),
          exceptUserId ? ne(usersTable.id, exceptUserId) : sql`true`,
        ),
      );
    return Number(rows[0]?.value ?? 0);
  }

  async createWithin(
    tx: Tx,
    input: {
      email: string;
      fullName: string;
      role: UserRole;
      passwordHash: string;
      totpLoginRequired: boolean;
    },
  ): Promise<UserRecord> {
    const rows = await tx
      .insert(usersTable)
      .values({ ...input, mustChangePassword: true })
      .returning();
    return strip(toCredentials(rows[0]));
  }

  async setPasswordWithin(
    tx: Tx,
    userId: string,
    passwordHash: string,
    mustChangePassword: boolean,
  ): Promise<void> {
    await tx
      .update(usersTable)
      .set({ passwordHash, mustChangePassword, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
  }

  async setStatusWithin(
    tx: Tx,
    userId: string,
    status: 'active' | 'locked' | 'disabled',
  ): Promise<void> {
    await tx
      .update(usersTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
  }

  async setTotpLoginRequiredWithin(tx: Tx, userId: string, required: boolean): Promise<void> {
    await tx
      .update(usersTable)
      .set({ totpLoginRequired: required, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
  }

  /** Lưu TOTP secret đã envelope (AD-4) — không bao giờ lưu plaintext. */
  async setTotpSecretWithin(tx: Tx, userId: string, sealed: SealedValue): Promise<void> {
    await tx
      .update(usersTable)
      .set({
        totpSecretCt: sealed.ciphertext,
        totpSecretIv: sealed.iv,
        totpSecretTag: sealed.tag,
        totpDekWrapped: sealed.wrappedDek,
        totpKeyVersion: sealed.keyVersion,
        totpEnrolledAt: null,
        totpLastTimestep: null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));
  }

  async markTotpEnrolledWithin(tx: Tx, userId: string, timeStep: number): Promise<void> {
    await tx
      .update(usersTable)
      .set({ totpEnrolledAt: new Date(), totpLastTimestep: timeStep, updatedAt: new Date() })
      .where(eq(usersTable.id, userId));
  }

  /** Chống replay (NFR-01): ghi lại time step vừa dùng. */
  async setTotpLastTimestep(userId: string, timeStep: number): Promise<void> {
    await this.db
      .update(usersTable)
      .set({ totpLastTimestep: timeStep })
      .where(eq(usersTable.id, userId));
  }

  async clearTotpWithin(tx: Tx, userId: string): Promise<void> {
    await tx
      .update(usersTable)
      .set({
        totpSecretCt: null,
        totpSecretIv: null,
        totpSecretTag: null,
        totpDekWrapped: null,
        totpKeyVersion: null,
        totpEnrolledAt: null,
        totpLastTimestep: null,
        updatedAt: new Date(),
      })
      .where(eq(usersTable.id, userId));
  }

  async applyLockoutState(
    userId: string,
    state: { failedAttempts: number; lockedUntil: Date | null },
  ): Promise<void> {
    await this.db.update(usersTable).set(state).where(eq(usersTable.id, userId));
  }

  async markLoginSuccess(userId: string): Promise<void> {
    await this.db
      .update(usersTable)
      .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(usersTable.id, userId));
  }

  async listRecipients(roles: UserRole[]): Promise<{ email: string; fullName: string }[]> {
    const rows = await this.db
      .select({ email: usersTable.email, fullName: usersTable.fullName, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.status, 'active'));
    return rows
      .filter((r) => roles.includes(r.role as UserRole))
      .map((r) => ({ email: r.email, fullName: r.fullName }));
  }
}

type Row = typeof usersTable.$inferSelect;

function toCredentials(row: Row): UserCredentials {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role as UserRole,
    status: row.status as UserCredentials['status'],
    mustChangePassword: row.mustChangePassword,
    totpEnrolledAt: row.totpEnrolledAt,
    totpLoginRequired: row.totpLoginRequired,
    failedAttempts: row.failedAttempts,
    lockedUntil: row.lockedUntil,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    passwordHash: row.passwordHash,
    totpSecretCt: row.totpSecretCt ?? null,
    totpSecretIv: row.totpSecretIv ?? null,
    totpSecretTag: row.totpSecretTag ?? null,
    totpDekWrapped: row.totpDekWrapped ?? null,
    totpKeyVersion: row.totpKeyVersion ?? null,
    totpLastTimestep: row.totpLastTimestep ?? null,
  };
}

/**
 * Bóc mọi trường bí mật trước khi bản ghi rời module (AD-4): controller/UI không bao giờ
 * nhìn thấy password_hash hay TOTP secret, kể cả dạng ciphertext.
 */
function strip(user: UserCredentials): UserRecord {
  const rest: Record<string, unknown> = { ...user };
  for (const key of [
    'passwordHash',
    'totpSecretCt',
    'totpSecretIv',
    'totpSecretTag',
    'totpDekWrapped',
    'totpKeyVersion',
    'totpLastTimestep',
  ]) {
    delete rest[key];
  }
  return rest as unknown as UserRecord;
}
