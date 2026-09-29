import {
  bigint,
  boolean,
  customType,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/** citext: email so sánh không phân biệt hoa/thường (migration 0000 bật extension). */
const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** Người dùng (NFR-01) — bảng tạo bằng migration 0002_users.sql. Chủ sở hữu: module auth/users (AD-3). */
export const usersTable = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: citext('email').notNull(),
  fullName: text('full_name').notNull(),
  // Liên hệ (migration 0031): gọi được người giữ máy lúc 2h sáng, và đối chiếu được sang
  // bảng lương. Cả hai cho phép rỗng — tài khoản cũ chưa có sẵn hai giá trị này.
  phone: text('phone'),
  employeeCode: text('employee_code'),
  birthDate: date('birth_date'),
  role: text('role').notNull(),
  passwordHash: text('password_hash').notNull(),
  mustChangePassword: boolean('must_change_password').notNull().default(true),
  // TOTP secret cất bằng envelope (AD-4, NFR-02) — 5 cột khớp SealedValue.
  totpSecretCt: customType<{ data: Buffer }>({ dataType: () => 'bytea' })('totp_secret_ct'),
  totpSecretIv: customType<{ data: Buffer }>({ dataType: () => 'bytea' })('totp_secret_iv'),
  totpSecretTag: customType<{ data: Buffer }>({ dataType: () => 'bytea' })('totp_secret_tag'),
  totpDekWrapped: customType<{ data: Buffer }>({ dataType: () => 'bytea' })('totp_dek_wrapped'),
  totpKeyVersion: integer('totp_key_version'),
  totpEnrolledAt: timestamp('totp_enrolled_at', { withTimezone: true }),
  totpLastTimestep: bigint('totp_last_timestep', { mode: 'number' }),
  totpLoginRequired: boolean('totp_login_required').notNull().default(true),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  status: text('status').notNull().default('active'),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// `known_device` khai ở `auth/known-device.schema.ts`, không ở đây — module `auth` là nơi
// duy nhất đọc/ghi bảng đó, nên nó phải là nơi khai schema (AD-3).
