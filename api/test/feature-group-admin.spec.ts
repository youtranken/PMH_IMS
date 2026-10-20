import { runMigrations } from '../src/database/migration-runner';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import { FeatureHolderRegistry } from '../src/common/feature-holders.registry';
import { ApprovalsApiService } from '../src/modules/approvals/approvals.api';
import { ApprovalsService } from '../src/modules/approvals/approvals.service';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { AccountsService } from '../src/modules/auth/accounts.service';
import { FeatureGroupsAdminService } from '../src/modules/auth/feature-groups-admin.service';
import { KnownDeviceService } from '../src/modules/auth/known-device.service';
import { LoginFailureService } from '../src/modules/auth/login-failure.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { SessionService } from '../src/modules/auth/session.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { IsoAccessService } from '../src/modules/iso-forms/iso-access.service';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { FeatureGroupsService } from '../src/modules/users/feature-groups.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

const TEST_TIMEOUT = 120_000;
const noopSweep = { register: () => undefined } as unknown as SweepService;
const SA = { id: '', email: 'e2e-nhom-sa@pmh.com.vn', role: 'sa' as const };

/** Q-31: quản trị nhóm quyền qua service thật trên DB trắng — tx, nhật ký, người phụ trách ISO. */
describe('Q-31 · quản trị nhóm quyền', () => {
  let scratch: ScratchDb;
  let groups: FeatureGroupsAdminService;
  let iso: IsoAccessService;
  let accounts: AccountsService;
  let seq = 0;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_feature_group_admin');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const config = new SystemConfigService(db);
    const users = new UsersService(db);
    const audit = new AuditWriterService(db);
    iso = new IsoAccessService(db, audit, new UsersApiService(users));
    const holders = new FeatureHolderRegistry();
    holders.register({ features: ['iso_0203', 'iso_0208'], holdings: (ids) => iso.holdings(ids) });
    groups = new FeatureGroupsAdminService(db, new FeatureGroupsService(db), users, holders, audit);
    accounts = new AccountsService(
      db,
      users,
      new SessionService(db, config, noopSweep),
      new PasswordService('p'.repeat(64)),
      audit,
      new OutboxService(db, config, noopSweep),
      new LoginFailureService(db, config, noopSweep),
      new ApprovalsApiService(new ApprovalsService(db, audit, new ApprovalKindRegistry())),
      config,
      new KnownDeviceService(db, config, noopSweep),
    );
    SA.id = await user('sa', 'E2E SA');
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  async function user(role: string, fullName = 'E2E Thành viên'): Promise<string> {
    seq += 1;
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO users (email, full_name, role, password_hash, must_change_password)
       VALUES ($1, $2, $3, 'x', false) RETURNING id`,
      [`e2e-nhom-admin-${seq}@pmh.com.vn`, fullName, role],
    );
    return rows[0].id;
  }

  async function groupOf(userId: string): Promise<string | null> {
    const { rows } = await scratch.pool.query<{ g: string | null }>(
      `SELECT feature_group_id AS g FROM users WHERE id = $1`,
      [userId],
    );
    return rows[0].g;
  }

  async function auditActions(objectId: string): Promise<string[]> {
    const { rows } = await scratch.pool.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE object_id = $1 ORDER BY id`,
      [objectId],
    );
    return rows.map((row) => row.action);
  }

  it('tạo nhóm: lưu ô tick theo thứ tự màn, bỏ trùng, ghi nhật ký', async () => {
    const { id } = await groups.create(SA, { name: '  E2E Mạng  ', features: ['network', 'overview', 'network'] });
    const list = await groups.list();
    expect(list.find((g) => g.id === id)).toEqual({ id, name: 'E2E Mạng', features: ['overview', 'network'], memberCount: 0 });
    expect(await auditActions(id)).toEqual(['feature_group.created']);
  });

  it('tạo nhóm trùng tên (khác hoa thường) → 409 FEATURE_GROUP_NAME_TAKEN', async () => {
    await groups.create(SA, { name: 'E2E Trùng', features: ['assets'] });
    await expect(groups.create(SA, { name: 'e2e trùng', features: ['assets'] })).rejects.toMatchObject({
      status: 409,
      response: { code: 'FEATURE_GROUP_NAME_TAKEN' },
    });
  });

  it('nhóm không tick gì hoặc tick khóa lạ → 400', async () => {
    await expect(groups.create(SA, { name: 'E2E Rỗng', features: [] })).rejects.toMatchObject({ status: 400 });
    await expect(groups.create(SA, { name: 'E2E Lạ', features: ['expiry'] })).rejects.toMatchObject({ status: 400 });
  });

  it('gán Member vào nhóm, đổi về Đủ quyền; SA/Admin không gán được', async () => {
    const { id } = await groups.create(SA, { name: 'E2E Gán', features: ['assets'] });
    const member = await user('member');
    await groups.assign(SA, member, id);
    expect(await groupOf(member)).toBe(id);
    await groups.assign(SA, member, null);
    expect(await groupOf(member)).toBeNull();
    expect(await auditActions(member)).toEqual(['account.feature_group.changed', 'account.feature_group.changed']);

    const admin = await user('admin');
    await expect(groups.assign(SA, admin, id)).rejects.toMatchObject({
      status: 400,
      response: { code: 'FEATURE_GROUP_MEMBER_ONLY' },
    });
  });

  it('xoá nhóm còn người → 409 FEATURE_GROUP_IN_USE; hết người thì xoá được', async () => {
    const { id } = await groups.create(SA, { name: 'E2E Xoá', features: ['network'] });
    const member = await user('member');
    await groups.assign(SA, member, id);
    await expect(groups.remove(SA, id)).rejects.toMatchObject({ status: 409, response: { code: 'FEATURE_GROUP_IN_USE' } });
    await groups.assign(SA, member, null);
    await groups.remove(SA, id);
    expect((await groups.list()).some((g) => g.id === id)).toBe(false);
  });

  describe('người phụ trách phiếu ISO phải thấy phiếu (Q-31)', () => {
    it('không gán làm người phụ trách 0208 một Member mà nhóm ẩn 0208', async () => {
      const { id } = await groups.create(SA, { name: 'E2E Không 0208', features: ['network'] });
      const member = await user('member', 'E2E Chị Lan');
      await groups.assign(SA, member, id);
      await expect(iso.setOwners(SA, '0208', { primaryUserId: member, backupUserId: null })).rejects.toMatchObject({
        status: 400,
        response: { code: 'ISO_OWNER_FEATURE_HIDDEN', message: expect.stringContaining('E2E Chị Lan') },
      });
    });

    it('bỏ tick 0203 khỏi nhóm khi trong nhóm có người phụ trách 0203 → 409 nêu tên', async () => {
      const { id } = await groups.create(SA, { name: 'E2E Có 0203', features: ['iso_0203', 'assets'] });
      const member = await user('member', 'E2E Anh Tùng');
      await groups.assign(SA, member, id);
      await iso.setOwners(SA, '0203', { primaryUserId: null, backupUserId: member });

      await expect(groups.update(SA, id, { features: ['assets'] })).rejects.toMatchObject({
        status: 409,
        response: { code: 'FEATURE_GROUP_HOLDER', message: expect.stringContaining('E2E Anh Tùng đang phụ trách phiếu 0203') },
      });
      // Đổi tên (không đụng tick) vẫn được.
      await groups.update(SA, id, { name: 'E2E Có 0203 mới' });

      const { id: other } = await groups.create(SA, { name: 'E2E Chỉ tài sản', features: ['assets'] });
      await expect(groups.assign(SA, member, other)).rejects.toMatchObject({
        status: 409,
        response: { code: 'FEATURE_GROUP_HOLDER' },
      });
      expect(await groupOf(member)).toBe(id);

      // Gỡ người phụ trách rồi thì bỏ tick được.
      await iso.setOwners(SA, '0203', { primaryUserId: null, backupUserId: null });
      await groups.update(SA, id, { features: ['assets'] });
    });
  });

  it('tạo tài khoản Member kèm nhóm trong cùng transaction', async () => {
    const { id } = await groups.create(SA, { name: 'E2E Tạo kèm', features: ['overview'] });
    const { user: created } = await accounts.create(SA, {
      email: 'e2e-nhom-tao-moi@pmh.com.vn',
      fullName: 'E2E Tạo kèm nhóm',
      role: 'member',
      featureGroupId: id,
    });
    expect(created.featureGroupId).toBe(id);
    await expect(
      accounts.create(SA, { email: 'e2e-nhom-tao-admin@pmh.com.vn', fullName: 'E2E Admin kèm nhóm', role: 'admin', featureGroupId: id }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'FEATURE_GROUP_INVALID' } });
  });

  it('đổi vai Member → Quản trị thì bỏ nhóm (SA/Admin luôn đủ quyền)', async () => {
    const { id } = await groups.create(SA, { name: 'E2E Đổi vai', features: ['network'] });
    const member = await user('member');
    await groups.assign(SA, member, id);
    await accounts.setRole(SA, member, 'admin');
    expect(await groupOf(member)).toBeNull();
  });
});
