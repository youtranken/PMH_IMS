import { Pool } from 'pg';
import { ensureAppRole } from '../src/database/app-role';
import { runMigrations } from '../src/database/migration-runner';
import { ApprovalKindRegistry } from '../src/common/approvals/approvals-registry';
import type { DeviceRetirementRegistry } from '../src/common/device-retirement.registry';
import { DeviceSearchRegistry } from '../src/common/device-search.registry';
import { ApprovalsApiService } from '../src/modules/approvals/approvals.api';
import { ApprovalsService } from '../src/modules/approvals/approvals.service';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { CatalogApiService } from '../src/modules/catalog/catalog.api';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { DevicePortsService } from '../src/modules/devices/device-ports.service';
import { DevicesApiService } from '../src/modules/devices/devices.api';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DiagramPruneService } from '../src/modules/diagrams/diagram-prune.service';
import { DiagramReviewService } from '../src/modules/diagrams/diagram-review.service';
import { DiagramsService } from '../src/modules/diagrams/diagrams.service';
import type { IpamApiService } from '../src/modules/ipam/ipam.api';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { appDbPassword, appDbUrl, createScratchDb, migrationsDir, type ScratchDb } from './db';
import { noPhotos } from './device-photos-stub';

/**
 * "Bỏ bản nháp" và "Xoá hẳn" (Q-23) trên Postgres thật. Lời hứa: phiên bản vẫn chỉ-thêm ở tầng DB
 * với MỌI đường trừ hàm `diagram_delete_versions` (0056); bản chính thức, bản đặt tên, bản từng
 * phát hành không bao giờ mất, kể cả khi gọi thẳng hàm; và xoá chạy cùng transaction với dòng
 * lịch sử + nhật ký (AD-5).
 */

const TEST_TIMEOUT = 180_000;
const SA = { email: 'e2e-prune-sa@qa.test', role: 'sa' as const, fullName: 'E2E SA Dọn' };
const ADMIN = { email: 'e2e-prune-admin@qa.test', role: 'admin' as const, fullName: 'E2E Admin Dọn' };
const MEMBER = { email: 'e2e-prune-member@qa.test', role: 'member' as const, fullName: 'E2E Thành viên Dọn' };

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;
const noopSweep = { register: () => undefined } as unknown as SweepService;

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function shape(id: string, value: string): string {
  return `<mxCell id="${id}" value="${value}" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>`;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="s1"><rect width="10" height="10"/></g></svg>';

/** SQLSTATE của câu lệnh — ném lại nếu nó KHÔNG lỗi. */
async function sqlStateOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as { code?: string }).code ?? 'KHÔNG-CÓ-MÃ';
  }
  throw new Error('Câu lệnh KHÔNG bị chặn');
}

describe('Sơ đồ mạng · bỏ bản nháp, xoá hẳn (Q-23)', () => {
  let scratch: ScratchDb;
  let diagrams: DiagramsService;
  let review: DiagramReviewService;
  let prune: DiagramPruneService;
  let n = 0;

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: number }>(sql, params);
    return rows[0].n;
  }

  /** Bản vẽ có `saves` lần lưu, mỗi lần một hình khác để tóm tắt không rỗng. */
  async function drawn(saves: number, by = SA.email, name = 'Bản') {
    n += 1;
    const diagram = await diagrams.create(by, { name: `E2E ${name} ${n}`, nodeType: 'floor' });
    const ids: string[] = [];
    for (let i = 1; i <= saves; i += 1) {
      const saved = await diagrams.save(by, diagram.id, { xml: page(shape(`s${i}`, `Hình ${i}`)), svg: SVG, basedOnVersionId: ids.at(-1) ?? null });
      ids.push(saved.id);
    }
    return { id: diagram.id, versions: ids };
  }

  async function seqs(diagramId: string): Promise<number[]> {
    const { rows } = await scratch.pool.query<{ seq: number }>(`SELECT seq FROM diagram_version WHERE diagram_id = $1 ORDER BY seq`, [diagramId]);
    return rows.map((r) => r.seq);
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagram_prune');
    // Dựng role bằng đúng hàm `main.ts` gọi, với đúng mật khẩu trong `.env`: bài đòn tấn công bên
    // dưới chạy BẰNG `ims_app`, không bằng chủ sở hữu.
    await ensureAppRole(scratch.pool, 'ims_app', appDbPassword());
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const audit = new AuditWriterService(db);
    const config = new SystemConfigService(db);
    const catalog = new CatalogApiService(new CatalogService(db, audit));
    const devicesService = new DevicesService(db, catalog, audit, noRetirement, new DeviceSearchRegistry());
    const devices = new DevicesApiService(devicesService, new DevicePortsService(db, devicesService), noPhotos);
    const ipam = { heldAddressesOf: (ids: string[]) => Promise.resolve(new Map(ids.map((id) => [id, []]))) } as unknown as IpamApiService;
    const users = new UsersApiService(new UsersService(db));
    const kinds = new ApprovalKindRegistry();
    const approvals = new ApprovalsApiService(new ApprovalsService(db, audit, kinds));
    diagrams = new DiagramsService(db, audit, config, catalog, devices, ipam, users);
    review = new DiagramReviewService(db, audit, diagrams, devices, approvals, new OutboxService(db, config, noopSweep), users, kinds);
    review.onModuleInit();
    prune = new DiagramPruneService(db, audit, approvals);
    for (const user of [SA, ADMIN, MEMBER]) {
      await scratch.pool.query(`INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, 'x')`, [user.email, user.fullName, user.role]);
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  describe('hàng rào ở DB (0056)', () => {
    it('DELETE phiên bản không qua hàm → trigger chặn (P0001), kể cả chủ sở hữu', async () => {
      const d = await drawn(2);
      expect(await sqlStateOf(() => scratch.pool.query(`DELETE FROM diagram_version WHERE id = $1`, [d.versions[1]]))).toBe('P0001');
      expect(await seqs(d.id)).toEqual([1, 2]);
    });

    it('cờ đặt tay cho bản vẽ KHÁC không mở được bản vẽ này', async () => {
      const d = await drawn(2);
      const other = await drawn(1);
      const client = await scratch.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('ims.diagram_prune', $1, true)`, [`drafts:${other.id}`]);
        expect(await sqlStateOf(() => client.query(`DELETE FROM diagram_version WHERE id = $1`, [d.versions[1]]))).toBe('P0001');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    });

    it('gọi thẳng hàm xoá bản chính thức / bản đặt tên / bản từng phát hành → từ chối', async () => {
      const d = await drawn(4);
      await review.publish(SA, d.id, { versionId: d.versions[1] });
      await diagrams.label(SA, d.id, d.versions[2], 'Bản E2E quan trọng');
      for (const victim of [d.versions[1], d.versions[2]]) {
        expect(await sqlStateOf(() => scratch.pool.query(`SELECT diagram_delete_versions($1, $2::uuid[], 'drafts')`, [d.id, [victim]]))).toBe('P0001');
      }
      // Lùi bản chính thức về #1 (khôi phục làm chính thức) — #2 thôi là bản chính thức nhưng từng phát hành.
      await review.restoreOfficial(SA, d.id, d.versions[0]);
      expect(await sqlStateOf(() => scratch.pool.query(`SELECT diagram_delete_versions($1, $2::uuid[], 'drafts')`, [d.id, [d.versions[1]]]))).toBe('P0001');
      expect(await seqs(d.id)).toEqual([1, 2, 3, 4, 5]);
    });

    it('UPDATE phiên bản vẫn bị chặn; chế độ lạ của hàm bị từ chối', async () => {
      const d = await drawn(1);
      expect(await sqlStateOf(() => scratch.pool.query(`UPDATE diagram_version SET summary = 'x' WHERE id = $1`, [d.versions[0]]))).toBe('P0001');
      expect(await sqlStateOf(() => scratch.pool.query(`SELECT diagram_delete_versions($1, $2::uuid[], 'all')`, [d.id, d.versions]))).toBe('P0001');
    });

    it('purge qua hàm khi bản vẽ chưa là bia mộ → từ chối', async () => {
      const d = await drawn(2);
      expect(await sqlStateOf(() => scratch.pool.query(`SELECT diagram_delete_versions($1, $2::uuid[], 'purge')`, [d.id, d.versions]))).toBe('P0001');
    });
  });

  describe('Bỏ bản nháp', () => {
    it('xoá các lần lưu sau bản chính thức, kéo theo bình luận + tên đã gỡ; một dòng lịch sử + nhật ký', async () => {
      const d = await drawn(5);
      await review.publish(SA, d.id, { versionId: d.versions[1] });
      await review.addComment(SA, d.id, { versionId: d.versions[3], body: 'Ghim E2E trên bản nháp' });
      await diagrams.label(SA, d.id, d.versions[4], 'Tạm E2E');
      await diagrams.label(SA, d.id, d.versions[4], null);

      const preview = await prune.draftPreview(SA, d.id);
      expect(preview).toMatchObject({ count: 3, ranges: '#3–#5', keepSeq: 2, blockedByApprovalId: null });

      const result = await prune.discardDrafts(SA, d.id);
      expect(result).toMatchObject({ count: 3, ranges: '#3–#5' });
      expect(await seqs(d.id)).toEqual([1, 2]);
      expect(await count(`SELECT count(*)::int AS n FROM diagram_comment WHERE diagram_id = $1`, [d.id])).toBe(0);
      expect(await count(`SELECT count(*)::int AS n FROM diagram_version_label WHERE diagram_id = $1`, [d.id])).toBe(0);
      expect(await count(`SELECT count(*)::int AS n FROM diagram_history WHERE diagram_id = $1 AND action = 'versions.discarded'`, [d.id])).toBe(1);
      const { rows } = await scratch.pool.query<{ detail: { count: number; ranges: string } }>(
        `SELECT detail FROM audit_log WHERE action = 'diagram.drafts_discarded' AND object_id = $1`,
        [d.id],
      );
      expect(rows.map((r) => r.detail)).toEqual([expect.objectContaining({ count: 3, ranges: '#3–#5' })]);
      // Cây trở lại "chính thức", lưu tiếp lấy số kế tiếp sau #2.
      const node = await diagrams.node(d.id);
      expect(node.status).toBe('official');
      // Thẻ cây "v2 · <tên>": tên người lưu đi kèm cây, không phải tra riêng.
      expect(node.latestVersion).toMatchObject({ seq: 2, savedBy: SA.email, savedByName: SA.fullName });
      const next = await diagrams.save(SA.email, d.id, { xml: page(shape('z', 'Sau dọn')), svg: SVG, basedOnVersionId: d.versions[1] });
      expect(next.seq).toBe(3);
    });

    it('bản đặt tên + bản nó dựa vào được giữ', async () => {
      const d = await drawn(5);
      await review.publish(SA, d.id, { versionId: d.versions[0] });
      await diagrams.label(SA, d.id, d.versions[3], 'Mốc E2E');
      await prune.discardDrafts(ADMIN, d.id);
      // Mỗi lần lưu dựa trên lần trước: #4 đặt tên giữ #3, #3 giữ #2 (cả chuỗi); chỉ #5 bỏ.
      expect(await seqs(d.id)).toEqual([1, 2, 3, 4]);
    });

    it('có người lưu thêm sau khi hộp xác nhận mở → 409, không xoá gì; xác nhận lại dải mới thì được', async () => {
      const d = await drawn(3);
      await review.publish(SA, d.id, { versionId: d.versions[0] });
      const seen = (await prune.draftPreview(SA, d.id)).ranges;
      expect(seen).toBe('#2–#3');
      await diagrams.save(SA.email, d.id, { xml: page(shape('n', 'Mới')), svg: SVG, basedOnVersionId: d.versions[2] });
      await expect(prune.discardDrafts(SA, d.id, seen)).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_DRAFTS_CHANGED' } });
      expect(await seqs(d.id)).toEqual([1, 2, 3, 4]);
      await prune.discardDrafts(SA, d.id, '#2–#4');
      expect(await seqs(d.id)).toEqual([1]);
    });

    it('bỏ TỪ một bản chọn: chính thức #12, nháp #13–#15, từ #14 → giữ #13, xoá #14–#15; lịch sử ghi đúng dải', async () => {
      const d = await drawn(15);
      await review.publish(SA, d.id, { versionId: d.versions[11] });
      expect(await prune.draftPreview(SA, d.id, 14)).toMatchObject({ count: 2, ranges: '#14–#15', keepSeq: 12, keptDrafts: 0 });
      // Dải người dùng đã thấy là dải của CHÍNH lựa chọn đó, không phải dải mặc định #13–#15.
      expect(await prune.discardDrafts(SA, d.id, '#14–#15', 14)).toMatchObject({ count: 2, ranges: '#14–#15' });
      expect((await seqs(d.id)).slice(-2)).toEqual([12, 13]);
      const { rows } = await scratch.pool.query<{ changes: { ranges: string; fromSeq: number } }>(
        `SELECT changes FROM diagram_history WHERE diagram_id = $1 AND action = 'versions.discarded'`,
        [d.id],
      );
      expect(rows.map((r) => r.changes)).toEqual([expect.objectContaining({ ranges: '#14–#15', fromSeq: 14 })]);
    });

    it('bỏ từ một bản chọn: bản đặt tên trong dải vẫn giữ', async () => {
      const d = await drawn(5);
      await review.publish(SA, d.id, { versionId: d.versions[0] });
      // Lưu mới không dựa trên bản đặt tên, để chỉ riêng nhãn giữ nó lại.
      await diagrams.label(SA, d.id, d.versions[4], 'Mốc E2E');
      const extra = await diagrams.save(SA.email, d.id, { xml: page(shape('x', 'Rẽ nhánh')), svg: SVG, basedOnVersionId: d.versions[0] });
      expect(extra.seq).toBe(6);
      await prune.discardDrafts(SA, d.id, undefined, 4);
      // #4 bị #5 (đặt tên, dựa trên #4) kéo lại; #6 không ai trỏ tới → xoá.
      expect(await seqs(d.id)).toEqual([1, 2, 3, 4, 5]);
    });

    it('cây mang số phiên bản + số nháp + số máy/dây/tủ của lần lưu mới nhất (bản đồ không hỏi mã)', async () => {
      const d = await drawn(4);
      await review.publish(SA, d.id, { versionId: d.versions[1] });
      const dev = (id: string, uuid: string) =>
        `<UserObject label="SW-E2E-${id}" ims_device_id="${uuid}" ims_device_code="SW-E2E-${id}" id="${id}"><mxCell style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></UserObject>`;
      const [a, b] = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2'];
      const cable = `<UserObject label="" ims_link_id="00000000-0000-4000-8000-0000000000c3" id="e1"><mxCell style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="d1" target="d2"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject>`;
      const { rows: site } = await scratch.pool.query<{ id: string }>(`INSERT INTO site (code, name) VALUES ('E2E-PRUNE', 'Site E2E') RETURNING id`);
      const { rows: cab } = await scratch.pool.query<{ id: string }>(`INSERT INTO cabinet (site_id, code) VALUES ($1, 'E2E-R1') RETURNING id`, [site[0].id]);
      const rack = `<UserObject label="Tủ E2E" ims_cabinet_id="${cab[0].id}" id="r1"><mxCell style="rounded=0;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="200" height="300" as="geometry"/></mxCell></UserObject>`;
      await diagrams.save(SA.email, d.id, { xml: page(dev('d1', a) + dev('d2', b) + dev('d3', a) + cable + rack), svg: SVG, basedOnVersionId: d.versions[3] });
      const node = (await diagrams.tree()).find((x) => x.id === d.id);
      // Hai ô cùng một máy vẫn là MỘT máy; nháp = lần lưu sau bản chính thức (#3–#5).
      expect(node).toMatchObject({ versionCount: 5, draftCount: 3, stats: { devices: 2, cables: 1, cabinets: 1 } });
      await prune.discardDrafts(SA, d.id, undefined, 4);
      expect((await diagrams.node(d.id)) as unknown).toMatchObject({ versionCount: 3, draftCount: 1, stats: { devices: 0, cables: 0, cabinets: 0 } });
    });

    it('số bắt đầu không nằm sau bản chính thức → 400, không xoá gì', async () => {
      const d = await drawn(3);
      await review.publish(SA, d.id, { versionId: d.versions[1] });
      await expect(prune.draftPreview(SA, d.id, 2)).rejects.toMatchObject({ status: 400, response: { code: 'DIAGRAM_DRAFT_FROM_INVALID' } });
      await expect(prune.discardDrafts(SA, d.id, undefined, 1)).rejects.toMatchObject({ status: 400, response: { code: 'DIAGRAM_DRAFT_FROM_INVALID' } });
      expect(await seqs(d.id)).toEqual([1, 2, 3]);
    });

    it('chưa có bản chính thức: giữ phiên bản đầu', async () => {
      const d = await drawn(3);
      await prune.discardDrafts(SA, d.id);
      expect(await seqs(d.id)).toEqual([1]);
    });

    it('không có bản nháp → 409, không ghi gì', async () => {
      const d = await drawn(2);
      await review.publish(SA, d.id, { versionId: d.versions[1] });
      await expect(prune.discardDrafts(SA, d.id)).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_NO_DRAFTS' } });
      expect(await count(`SELECT count(*)::int AS n FROM diagram_history WHERE diagram_id = $1 AND action = 'versions.discarded'`, [d.id])).toBe(0);
    });

    it('yêu cầu chờ duyệt trỏ vào bản sẽ xoá → 409, bảo rút trước; rút xong thì bỏ được', async () => {
      const d = await drawn(3, MEMBER.email);
      await review.publish(SA, d.id, { versionId: d.versions[0] });
      const { approval } = await review.submit(MEMBER, d.id, { reason: 'Gửi duyệt E2E' });
      expect((await prune.draftPreview(SA, d.id)).blockedByApprovalId).toBe(approval.id);
      await expect(prune.discardDrafts(SA, d.id)).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_DISCARD_PENDING' } });
      expect(await seqs(d.id)).toEqual([1, 2, 3]);
      await review.withdraw(MEMBER, d.id, approval.id);
      await prune.discardDrafts(SA, d.id);
      expect(await seqs(d.id)).toEqual([1]);
    });

    it('Thành viên: bản chính thức → 403; bản trình bày của mình → được', async () => {
      const d = await drawn(3);
      await review.publish(SA, d.id, { versionId: d.versions[0] });
      await expect(prune.discardDrafts(MEMBER, d.id)).rejects.toMatchObject({ status: 403 });
      const copy = await diagrams.createPresentation(MEMBER.email, d.id, {});
      await diagrams.save(MEMBER.email, copy.id, { xml: page(shape('p', 'Dự kiến')), svg: SVG, basedOnVersionId: null });
      await diagrams.save(MEMBER.email, copy.id, { xml: page(shape('p', 'Dự kiến 2')), svg: SVG, basedOnVersionId: null });
      await prune.discardDrafts(MEMBER, copy.id);
      expect(await seqs(copy.id)).toEqual([1]);
    });

    it('phát hành và bỏ bản nháp cùng lúc: bản chính thức không bao giờ trỏ vào hàng đã xoá', async () => {
      for (let round = 0; round < 4; round += 1) {
        const d = await drawn(3);
        const [published, discarded] = await Promise.allSettled([
          review.publish(SA, d.id, { versionId: d.versions[2] }),
          prune.discardDrafts(SA, d.id),
        ]);
        const { rows } = await scratch.pool.query<{ official: string | null; alive: boolean }>(
          `SELECT d.official_version_id AS official, EXISTS (SELECT 1 FROM diagram_version v WHERE v.id = d.official_version_id) AS alive
             FROM diagram d WHERE d.id = $1`,
          [d.id],
        );
        if (published.status === 'fulfilled') {
          expect(rows[0]).toEqual({ official: d.versions[2], alive: true });
          // Phát hành trước: không còn bản nháp sau #3 → bỏ bản nháp chịu 409 hoặc không xoá gì.
          expect(await seqs(d.id)).toEqual([1, 2, 3]);
        } else {
          expect(discarded.status).toBe('fulfilled');
          expect(rows[0].official).toBeNull();
          expect(await seqs(d.id)).toEqual([1]);
        }
      }
    });
  });

  describe('Xoá hẳn', () => {
    it('bản chưa phát hành: còn bia mộ + lịch sử, mất phiên bản/tên/bình luận/người đang sửa; cây và mở đều không thấy', async () => {
      const d = await drawn(2, MEMBER.email, 'Xoá');
      await diagrams.label(MEMBER, d.id, d.versions[0], 'Tên E2E');
      await review.addComment(MEMBER, d.id, { versionId: d.versions[1], body: 'Ghi chú E2E' });
      await diagrams.heartbeat({ email: MEMBER.email, fullName: MEMBER.fullName }, d.id);
      const { name } = await diagrams.node(d.id);

      await prune.purge(MEMBER, d.id, name);

      expect(await count(`SELECT count(*)::int AS n FROM diagram_version WHERE diagram_id = $1`, [d.id])).toBe(0);
      expect(await count(`SELECT count(*)::int AS n FROM diagram_version_label WHERE diagram_id = $1`, [d.id])).toBe(0);
      expect(await count(`SELECT count(*)::int AS n FROM diagram_comment WHERE diagram_id = $1`, [d.id])).toBe(0);
      expect(await count(`SELECT count(*)::int AS n FROM diagram_presence WHERE diagram_id = $1`, [d.id])).toBe(0);
      expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = $1 AND deleted_at IS NOT NULL AND deleted_by = $2`, [d.id, MEMBER.email])).toBe(1);
      expect(await count(`SELECT count(*)::int AS n FROM diagram_history WHERE diagram_id = $1 AND action = 'deleted'`, [d.id])).toBe(1);
      expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.deleted' AND object_id = $1`, [d.id])).toBe(1);
      expect((await diagrams.tree()).some((x) => x.id === d.id)).toBe(false);
      await expect(diagrams.node(d.id)).rejects.toMatchObject({ status: 404 });
      // Tên được giải phóng cho bản vẽ mới.
      await expect(diagrams.create(SA.email, { name, nodeType: 'floor' })).resolves.toBeDefined();
    });

    it('bản từng phát hành → 409, không xoá gì', async () => {
      const d = await drawn(2, SA.email, 'Đã phát hành');
      await review.publish(SA, d.id, { versionId: d.versions[0] });
      const { name } = await diagrams.node(d.id);
      await expect(prune.purge(SA, d.id, name)).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_PUBLISHED' } });
      expect(await seqs(d.id)).toEqual([1, 2]);
    });

    it('còn bản vẽ con (kể cả con đã lưu trữ) → 409', async () => {
      const parent = await drawn(1, SA.email, 'Cha');
      const child = await diagrams.create(SA.email, { name: `E2E Con ${n}`, nodeType: 'room', parentId: parent.id });
      await diagrams.archive(SA, child.id);
      const { name } = await diagrams.node(parent.id);
      await expect(prune.purge(SA, parent.id, name)).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_HAS_CHILDREN' } });
    });

    it('đang chờ duyệt → 409; gõ sai tên → 400; người khác (Thành viên) → 403', async () => {
      const d = await drawn(1, MEMBER.email, 'Chờ');
      const { name } = await diagrams.node(d.id);
      await expect(prune.purge(MEMBER, d.id, 'tên sai')).rejects.toMatchObject({ status: 400, response: { code: 'DIAGRAM_CONFIRM_NAME' } });
      const other = { email: 'e2e-prune-other@qa.test', role: 'member' as const };
      await expect(prune.purge(other, d.id, name)).rejects.toMatchObject({ status: 403 });
      await review.submit(MEMBER, d.id, { reason: 'Gửi E2E' });
      await expect(prune.purge(SA, d.id, name)).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_REVIEW_PENDING' } });
    });
  });

  describe('Xóa vĩnh viễn bản đã lưu trữ (Q-23 05/10)', () => {
    /** Ảnh "PNG" đủ lớn để được tách ra `diagram_image`; mỗi `seed` một nội dung. */
    const photo = (seed: number) => Buffer.alloc(3000, seed).toString('base64');
    const imageCell = (id: string, b64: string) =>
      `<mxCell id="${id}" value="" style="shape=image;aspect=fixed;image=data:image/png,${b64};" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="80" as="geometry"/></mxCell>`;

    /** Bản vẽ từng phát hành (#1 chính thức, #2 đặt tên, #3 nháp + bình luận) rồi được lưu trữ. */
    async function publishedThenArchived(name: string) {
      const d = await drawn(3, SA.email, name);
      await review.publish(SA, d.id, { versionId: d.versions[0] });
      await diagrams.label(SA, d.id, d.versions[1], 'Mốc E2E');
      await review.addComment(SA, d.id, { versionId: d.versions[2], body: 'Ghi chú E2E' });
      await diagrams.archive(SA, d.id);
      return { ...d, name: (await scratch.pool.query<{ name: string }>(`SELECT name FROM diagram WHERE id = $1`, [d.id])).rows[0].name };
    }

    it('bản từng phát hành, có tên phiên bản, bình luận, ảnh: mất hết nội dung; còn bia mộ + lịch sử + nhật ký; ảnh dùng chung với bản khác vẫn giữ', async () => {
      const shared = photo(41);
      const own = photo(42);
      const d = await publishedThenArchived('Vĩnh viễn');
      const other = await drawn(1, SA.email, 'Giữ ảnh');
      await diagrams.save(SA.email, other.id, { xml: page(imageCell('i1', shared)), svg: SVG, basedOnVersionId: other.versions[0] });
      const doomed = await drawn(1, SA.email, 'Ảnh riêng');
      await diagrams.save(SA.email, doomed.id, { xml: page(imageCell('i1', shared) + imageCell('i2', own)), svg: SVG, basedOnVersionId: doomed.versions[0] });
      await review.publish(SA, doomed.id, { versionId: doomed.versions[0] });
      await diagrams.archive(SA, doomed.id);
      const doomedName = (await diagrams.archivedList()).find((x) => x.id === doomed.id)!.name;
      const images = async () => count(`SELECT count(*)::int AS n FROM diagram_image`);
      const before = await images();

      const result = await prune.erase(SA, d.id, d.name);
      expect(result).toEqual({ versions: 3 });
      for (const table of ['diagram_version', 'diagram_version_label', 'diagram_comment', 'diagram_presence', 'diagram_drift']) {
        expect(await count(`SELECT count(*)::int AS n FROM ${table} WHERE diagram_id = $1`, [d.id])).toBe(0);
      }
      expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = $1 AND deleted_at IS NOT NULL AND deleted_by = $2 AND official_version_id IS NULL`, [d.id, SA.email])).toBe(1);
      expect(await count(`SELECT count(*)::int AS n FROM diagram_history WHERE diagram_id = $1 AND action = 'version.published'`, [d.id])).toBe(1);
      const { rows: erased } = await scratch.pool.query<{ changes: Record<string, unknown> }>(
        `SELECT changes FROM diagram_history WHERE diagram_id = $1 AND action = 'erased'`,
        [d.id],
      );
      expect(erased).toHaveLength(1);
      expect(erased[0].changes).toMatchObject({ name: d.name, versions: 3, published: true });
      expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.erased' AND object_id = $1`, [d.id])).toBe(1);
      expect((await diagrams.archivedList()).some((x) => x.id === d.id)).toBe(false);
      await expect(diagrams.node(d.id)).rejects.toMatchObject({ status: 404 });

      await prune.erase(ADMIN, doomed.id, doomedName);
      // Ảnh riêng của bản bị xoá mất; ảnh bản khác còn dùng thì giữ.
      expect(await images()).toBe(before - 1);
      expect(await count(`SELECT count(*)::int AS n FROM diagram_version_image vi JOIN diagram_version v ON v.id = vi.version_id WHERE v.diagram_id = $1`, [other.id])).toBe(1);
    });

    it('chưa lưu trữ → 409 DIAGRAM_NOT_ARCHIVED; Thành viên → 403; gõ sai tên → 400; không xoá gì', async () => {
      const live = await drawn(2, SA.email, 'Đang dùng');
      const liveName = (await diagrams.node(live.id)).name;
      await review.publish(SA, live.id, { versionId: live.versions[0] });
      await expect(prune.erase(SA, live.id, liveName)).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_NOT_ARCHIVED' } });
      const d = await publishedThenArchived('Quyền');
      await expect(prune.erase(MEMBER, d.id, d.name)).rejects.toMatchObject({ status: 403 });
      await expect(prune.erase(SA, d.id, 'tên sai')).rejects.toMatchObject({ status: 400, response: { code: 'DIAGRAM_CONFIRM_NAME' } });
      expect(await seqs(d.id)).toEqual([1, 2, 3]);
      expect(await seqs(live.id)).toEqual([1, 2]);
    });

    it('còn bản vẽ con chưa xoá vĩnh viễn (kể cả đã lưu trữ) → 409 nêu tên con; xoá con trước thì xoá được cha', async () => {
      const p = await drawn(1, SA.email, 'Cha VV');
      const child = await diagrams.create(SA.email, { name: `E2E Con VV ${n}`, nodeType: 'room', parentId: p.id });
      await diagrams.archive(SA, child.id);
      await diagrams.archive(SA, p.id);
      const pName = (await diagrams.archivedList()).find((x) => x.id === p.id)!.name;
      await expect(prune.erase(SA, p.id, pName)).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_HAS_CHILDREN', message: expect.stringContaining(child.name) } });
      // Bản cha chỉ lưu trữ được khi mọi con đã lưu trữ: câu báo chỉ đường tới khu "Đã lưu trữ".
      const message = await prune.erase(SA, p.id, pName).then(
        () => '',
        (error: { response: { message: string } }) => error.response.message,
      );
      expect(message).toBe(
        `Bản vẽ còn 1 bản vẽ con chưa xóa vĩnh viễn: "${child.name}". Mở khu "Đã lưu trữ" của /diagrams, xóa vĩnh viễn từng bản vẽ con trước rồi mới xóa được bản này.`,
      );
      await prune.erase(SA, child.id, child.name);
      await expect(prune.erase(SA, p.id, pName)).resolves.toEqual({ versions: 1 });
    });

    it('bản trình bày nhân bản từ nó không chặn — chỉ mất liên kết tới phiên bản nguồn', async () => {
      const s2 = await drawn(1, SA.email, 'Nguồn TB');
      await review.publish(SA, s2.id, { versionId: s2.versions[0] });
      const pres = await diagrams.createPresentation(SA.email, s2.id, {});
      await diagrams.archive(SA, s2.id);
      const name = (await diagrams.archivedList()).find((x) => x.id === s2.id)!.name;
      await prune.erase(SA, s2.id, name);
      const { rows } = await scratch.pool.query<{ sv: string | null; deleted: string | null }>(`SELECT source_version_id AS sv, deleted_at AS deleted FROM diagram WHERE id = $1`, [pres.id]);
      expect(rows[0]).toEqual({ sv: null, deleted: null });
      expect(await count(`SELECT count(*)::int AS n FROM diagram_version WHERE diagram_id = $1`, [pres.id])).toBe(1);
    });

    describe('hàng rào ở DB (0058)', () => {
      it('chế độ erase trên bản vẽ chưa là bia mộ (kể cả đã lưu trữ) → P0001', async () => {
        const d = await publishedThenArchived('Rào 1');
        expect(await sqlStateOf(() => scratch.pool.query(`SELECT diagram_delete_versions($1, $2::uuid[], 'erase')`, [d.id, d.versions]))).toBe('P0001');
        expect(await seqs(d.id)).toEqual([1, 2, 3]);
      });

      it('bia mộ lưu trữ và xoá trong CÙNG một lượt (không lưu trữ trước) → P0001 với bản từng phát hành', async () => {
        const d = await drawn(2, SA.email, 'Rào 2');
        await review.publish(SA, d.id, { versionId: d.versions[0] });
        const client = await scratch.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`UPDATE diagram SET official_version_id = NULL, archived_at = now(), archived_by = 'x', deleted_at = now(), deleted_by = 'x' WHERE id = $1`, [d.id]);
          expect(await sqlStateOf(() => client.query(`SELECT diagram_delete_versions($1, $2::uuid[], 'erase')`, [d.id, d.versions]))).toBe('P0001');
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
        expect(await seqs(d.id)).toEqual([1, 2]);
      });

      it('cờ erase đặt tay cho bản vẽ KHÁC không mở được bản vẽ này; chế độ drafts vẫn giữ bản chính thức', async () => {
        const d = await drawn(2, SA.email, 'Rào 3');
        await review.publish(SA, d.id, { versionId: d.versions[0] });
        const other = await publishedThenArchived('Rào 3 khác');
        const client = await scratch.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SELECT set_config('ims.diagram_prune', $1, true)`, [`erase:${other.id}`]);
          expect(await sqlStateOf(() => client.query(`DELETE FROM diagram_version WHERE id = $1`, [d.versions[0]]))).toBe('P0001');
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
        expect(await sqlStateOf(() => scratch.pool.query(`SELECT diagram_delete_versions($1, $2::uuid[], 'drafts')`, [d.id, [d.versions[0]]]))).toBe('P0001');
        expect(await seqs(d.id)).toEqual([1, 2]);
      });
    });
  });

  /**
   * Đòn: `ims_app` bị chiếm có UPDATE trên `diagram`. Nó tự đặt `archived_at` lùi về quá khứ,
   * `deleted_at` = bây giờ, bỏ trỏ bản chính thức, rồi gọi chế độ `erase` để xoá sạch lịch sử đã
   * phát hành của một bản vẽ ĐANG DÙNG — không qua bước lưu trữ nào. Chạy bằng chính `ims_app`.
   */
  describe('đòn của ims_app bị chiếm: tự viết mốc lưu trữ để xoá vĩnh viễn', () => {
    let app: Pool;

    beforeAll(() => {
      app = new Pool({ connectionString: appDbUrl(scratch.name) });
      app.on('error', () => undefined);
    });

    afterAll(async () => {
      await app?.end();
    });

    it('lùi archived_at + đặt bia mộ trong một câu rồi gọi erase → P0001, mọi phiên bản còn nguyên', async () => {
      const d = await drawn(3, SA.email, 'Đòn 1');
      await review.publish(SA, d.id, { versionId: d.versions[0] });
      await app.query(
        `UPDATE diagram SET official_version_id = NULL, archived_at = now() - interval '1 day', archived_by = 'x',
                            deleted_at = now(), deleted_by = 'x' WHERE id = $1`,
        [d.id],
      );
      expect(await sqlStateOf(() => app.query(`SELECT diagram_delete_versions($1, $2::uuid[], 'erase')`, [d.id, d.versions]))).toBe('P0001');
      expect(await seqs(d.id)).toEqual([1, 2, 3]);
    });

    it('lùi archived_at của một bia mộ có sẵn ở lượt sau → vẫn P0001', async () => {
      const d = await drawn(2, SA.email, 'Đòn 2');
      await review.publish(SA, d.id, { versionId: d.versions[0] });
      await app.query(
        `UPDATE diagram SET official_version_id = NULL, archived_at = now(), archived_by = 'x', deleted_at = now(), deleted_by = 'x' WHERE id = $1`,
        [d.id],
      );
      await app.query(`UPDATE diagram SET archived_at = '2000-01-01T00:00:00Z' WHERE id = $1`, [d.id]);
      expect(await sqlStateOf(() => app.query(`SELECT diagram_delete_versions($1, $2::uuid[], 'erase')`, [d.id, d.versions]))).toBe('P0001');
      expect(await seqs(d.id)).toEqual([1, 2]);
    });

    it('bia mộ không sống lại: bỏ deleted_at → P0001', async () => {
      const d = await drawn(1, SA.email, 'Đòn 3');
      await diagrams.archive(SA, d.id);
      await prune.erase(SA, d.id, (await scratch.pool.query<{ name: string }>(`SELECT name FROM diagram WHERE id = $1`, [d.id])).rows[0].name);
      expect(await sqlStateOf(() => app.query(`UPDATE diagram SET deleted_at = NULL, deleted_by = NULL WHERE id = $1`, [d.id]))).toBe('P0001');
    });

    it('lối hợp lệ vẫn chạy bằng ims_app: lưu trữ ở một lượt, bia mộ + erase ở lượt sau', async () => {
      const d = await drawn(2, SA.email, 'Hợp lệ');
      await review.publish(SA, d.id, { versionId: d.versions[0] });
      await app.query(`UPDATE diagram SET archived_at = now(), archived_by = 'x' WHERE id = $1`, [d.id]);
      const client = await app.connect();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE diagram SET official_version_id = NULL, deleted_at = now(), deleted_by = 'x' WHERE id = $1`, [d.id]);
        const { rows } = await client.query<{ n: number }>(`SELECT diagram_delete_versions($1, $2::uuid[], 'erase') AS n`, [d.id, d.versions]);
        expect(rows[0].n).toBe(2);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      expect(await seqs(d.id)).toEqual([]);
    });
  });

  describe('quyền của ims_app', () => {
    it('ims_app gọi được hàm xoá; PUBLIC thì không', async () => {
      const { rows } = await scratch.pool.query<{ exec: boolean; pub: boolean }>(
        `SELECT has_function_privilege('ims_app', 'diagram_delete_versions(uuid, uuid[], text)', 'EXECUTE') AS exec,
                has_function_privilege('public', 'diagram_delete_versions(uuid, uuid[], text)', 'EXECUTE') AS pub`,
      );
      expect(rows[0]).toEqual({ exec: true, pub: false });
    });
  });
});
