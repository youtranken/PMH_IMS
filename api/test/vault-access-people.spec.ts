import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { runMigrations } from '../src/database/migration-runner';
import { RolesGuard } from '../src/modules/auth/roles.guard';
import { AccountsController } from '../src/modules/auth/accounts.controller';
import { UsersService } from '../src/modules/users/users.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { AccessListService } from '../src/modules/vault/access-list.service';
import { VaultAccessController } from '../src/modules/vault/vault-access.controller';
import type { Database } from '../src/database/database.module';
import type { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import type { CatalogApiService } from '../src/modules/catalog/catalog.api';
import type { DevicesApiService } from '../src/modules/devices/devices.api';
import type { SoftwareApiService } from '../src/modules/software/software.api';
import type { ServiceAccountsApiService } from '../src/modules/service-accounts/service-accounts.api';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Màn Quyền xem két (`/admin/vault-access`) mở cho SA và Admin, nhưng danh sách người nó cần
 * từng lấy từ `/accounts` — route CHỈ SA. Admin mở màn là gặp LoadError.
 *
 * Sửa bằng một đường đọc HẸP trong module vault, KHÔNG mở rộng `/accounts`: `/accounts` trả
 * cả SĐT, mã nhân viên, ngày sinh, số lần đăng nhập hỏng, mốc khoá… — Admin không cần những
 * thứ đó để gán quyền két, và mở cả cửa cho một màn là lộ nhiều hơn màn đó cần.
 */

const TEST_TIMEOUT = 120_000;

function contextFor(role: string, cls: object, handler: unknown): ExecutionContext {
  const request = { user: { role } };
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function handlerOf(cls: { prototype: object }, name: string): unknown {
  return (cls.prototype as Record<string, unknown>)[name];
}

describe('Quyền xem két · danh sách người cho SA/Admin', () => {
  const guard = new RolesGuard(new Reflector());

  it.each([
    ['sa', true],
    ['admin', true],
    ['member', false],
  ])('GET /vault/access/people với vai %s → cho qua: %p', (role, allowed) => {
    const handler = handlerOf(VaultAccessController, 'people');
    expect(typeof handler).toBe('function');
    let outcome: unknown;
    try {
      outcome = guard.canActivate(contextFor(role, VaultAccessController, handler));
    } catch (error) {
      outcome = error;
    }
    if (allowed) expect(outcome).toBe(true);
    else expect(outcome).toMatchObject({ response: { code: 'FORBIDDEN_ROLE' } });
  });

  it('không mở rộng /accounts: Admin vẫn bị chặn ở danh sách tài khoản', () => {
    const handler = handlerOf(AccountsController, 'list');
    expect(typeof handler).toBe('function');
    expect(() => guard.canActivate(contextFor('admin', AccountsController, handler))).toThrow(
      'Bạn không có quyền thực hiện thao tác này.',
    );
  });

  describe('dữ liệu trả về', () => {
    let scratch: ScratchDb;
    let access: AccessListService;

    beforeAll(async () => {
      scratch = await createScratchDb('ims_vault_access_people');
      await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
      const users = new UsersApiService(new UsersService(scratch.db));
      access = new AccessListService(
        {} as Database,
        {} as AuditWriterService,
        {} as CatalogApiService,
        {} as DevicesApiService,
        {} as SoftwareApiService,
        {} as ServiceAccountsApiService,
        users,
      );
      await scratch.pool.query(
        `INSERT INTO users (email, full_name, role, password_hash, phone, employee_code, status)
         VALUES ('b-member@pmh.com.vn', 'Bình Member', 'member', 'hash-bi-mat', '0909', 'NV01', 'active'),
                ('a-admin@pmh.com.vn', 'An Admin', 'admin', 'hash-bi-mat', NULL, NULL, 'active'),
                ('c-off@pmh.com.vn', 'Cường Nghỉ', 'member', 'hash-bi-mat', NULL, NULL, 'disabled')`,
      );
    }, TEST_TIMEOUT);

    afterAll(async () => {
      await scratch?.drop();
    }, TEST_TIMEOUT);

    it('chỉ id · email · họ tên · vai · trạng thái — không gì hơn', async () => {
      const people = await access.people();
      expect(people.length).toBe(3);
      for (const person of people) {
        expect(Object.keys(person).sort()).toEqual(['email', 'fullName', 'id', 'role', 'status']);
      }
      expect(JSON.stringify(people)).not.toContain('hash-bi-mat');
      expect(JSON.stringify(people)).not.toContain('0909');
    });

    it('xếp theo họ tên, có cả tài khoản đã vô hiệu (màn còn phải thấy lời gán cũ của họ)', async () => {
      const people = await access.people();
      expect(people.map((person) => person.email)).toEqual([
        'a-admin@pmh.com.vn',
        'b-member@pmh.com.vn',
        'c-off@pmh.com.vn',
      ]);
      expect(people.find((person) => person.email === 'c-off@pmh.com.vn')?.status).toBe('disabled');
    });
  });
});
