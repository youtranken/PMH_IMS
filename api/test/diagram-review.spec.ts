import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { DiagramReviewService } from '../src/modules/diagrams/diagram-review.service';
import { DiagramsService } from '../src/modules/diagrams/diagrams.service';
import type { IpamApiService } from '../src/modules/ipam/ipam.api';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';
import { noPhotos } from './device-photos-stub';

/**
 * Gửi duyệt / duyệt / trả về / phát hành bản vẽ (Q-23, AD-6, AD-18) trên Postgres thật: tự kiểm
 * đỏ chặn trước khi có yêu cầu nào, duyệt chạy lại tự kiểm trong CÙNG transaction đổi cờ chính
 * thức + trạng thái yêu cầu + thư báo, không ai tự duyệt bản mình gửi, và trả về phải kèm ghi chú.
 */

const TEST_TIMEOUT = 180_000;
const SA = { email: 'e2e-review-sa@qa.test', role: 'sa' as const, fullName: 'E2E SA Duyệt' };
const ADMIN = { email: 'e2e-review-admin@qa.test', role: 'admin' as const, fullName: 'E2E Admin Duyệt' };
const MEMBER = { email: 'e2e-review-member@qa.test', role: 'member' as const, fullName: 'E2E Thành viên Vẽ' };

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;
const noopSweep = { register: () => undefined } as unknown as SweepService;

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function deviceCell(id: string, deviceId: string, code: string, opts: { parent?: string; x?: number } = {}): string {
  return `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="${id}"><mxCell style="shape=mxgraph.cisco.switches.workgroup_switch;" vertex="1" parent="${opts.parent ?? '1'}"><mxGeometry x="${opts.x ?? 0}" y="0" width="100" height="40" as="geometry"/></mxCell></UserObject>`;
}

function cabinetFrame(id: string, cabinetId: string): string {
  return `<UserObject label="Tủ E2E" ims_cabinet_id="${cabinetId}" id="${id}"><mxCell style="container=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="400" height="600" as="geometry"/></mxCell></UserObject>`;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="d1"><rect width="10" height="10"/></g></svg>';

describe('Sơ đồ mạng · gửi duyệt, duyệt, trả về, phát hành (Q-23)', () => {
  let scratch: ScratchDb;
  let diagrams: DiagramsService;
  let review: DiagramReviewService;
  let siteId: string;
  let typeId: string;
  let cabinetA: string;
  let cabinetB: string;
  let seq = 0;

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: number }>(sql, params);
    return rows[0].n;
  }

  async function newDevice(code: string, extra: { cabinetId?: string } = {}): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id, site_id, cabinet_id) VALUES ($1, $5, $2, $3, $4) RETURNING id`,
      [code, typeId, siteId, extra.cabinetId ?? null, code],
    );
    return rows[0].id;
  }

  async function drawn(name: string, body: string, by = MEMBER.email) {
    seq += 1;
    const diagram = await diagrams.create(by, { name: `E2E ${name} ${seq}`, nodeType: 'floor' });
    const version = await diagrams.save(by, diagram.id, { xml: page(body), svg: SVG, basedOnVersionId: null });
    return { diagramId: diagram.id, versionId: version.id };
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagram_review');
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
    diagrams = new DiagramsService(db, audit, config, catalog, devices, ipam, users);
    review = new DiagramReviewService(
      db,
      audit,
      diagrams,
      devices,
      new ApprovalsApiService(new ApprovalsService(db, audit, kinds)),
      new OutboxService(db, config, noopSweep),
      users,
      kinds,
    );
    review.onModuleInit();

    for (const user of [SA, ADMIN, MEMBER]) {
      await scratch.pool.query(`INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, 'x')`, [
        user.email,
        user.fullName,
        user.role,
      ]);
    }
    siteId = (await scratch.pool.query<{ id: string }>(`INSERT INTO site (code, name) VALUES ('E2E-RV', 'Site duyệt') RETURNING id`)).rows[0].id;
    typeId = (await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('Switch E2E RV') RETURNING id`)).rows[0].id;
    cabinetA = (
      await scratch.pool.query<{ id: string }>(`INSERT INTO cabinet (code, site_id) VALUES ('E2E-RV-A', $1) RETURNING id`, [siteId])
    ).rows[0].id;
    cabinetB = (
      await scratch.pool.query<{ id: string }>(`INSERT INTO cabinet (code, site_id) VALUES ('E2E-RV-B', $1) RETURNING id`, [siteId])
    ).rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('máy đã thanh lý trên bản vẽ → gửi duyệt bị chặn (đỏ), không tạo yêu cầu, không thư', async () => {
    const dev = await newDevice('SW-E2E-RV-RET');
    const { diagramId } = await drawn('Đỏ', deviceCell('d1', dev, 'SW-E2E-RV-RET'));
    await scratch.pool.query(`UPDATE device SET status = 'retired' WHERE id = $1`, [dev]);
    const outboxBefore = await count(`SELECT count(*)::int AS n FROM outbox`);
    await expect(review.submit(MEMBER, diagramId, { reason: 'Vẽ xong tầng' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'DIAGRAM_CHECK_FAILED', errors: [{ code: 'DEVICE_RETIRED', cellId: 'd1' }] },
    });
    expect(await count(`SELECT count(*)::int AS n FROM approval WHERE subject_id = $1`, [diagramId])).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM outbox`)).toBe(outboxBefore);
  });

  it('cảnh báo vàng cho qua: tạo yêu cầu + thư báo người duyệt (outbox) + lịch sử; cây hiện "chờ duyệt"', async () => {
    const dev = await newDevice('SW-E2E-RV-Y', { cabinetId: cabinetB });
    const { diagramId, versionId } = await drawn('Vàng', cabinetFrame('f1', cabinetA) + deviceCell('d1', dev, 'SW-E2E-RV-Y', { parent: 'f1' }));
    const result = await review.submit(MEMBER, diagramId, { reason: 'Vẽ xong tầng 3' });
    expect(result.warnings.map((w) => w.code)).toEqual(['DEVICE_CABINET_MISMATCH']);
    expect(result.approval).toMatchObject({ kind: 'diagram_publish', state: 'pending', requester: MEMBER.email, subjectId: diagramId });
    expect(result.approval.payload).toMatchObject({ versionId });
    expect(
      await count(`SELECT count(*)::int AS n FROM outbox WHERE topic = 'approval.requested' AND payload->>'approvalId' = $1`, [result.approval.id]),
    ).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM diagram_history WHERE diagram_id = $1 AND action = 'review.submitted'`, [diagramId])).toBe(1);
    const [node] = await review.overlay([await diagrams.node(diagramId)]);
    expect(node).toMatchObject({ status: 'pending', pendingApprovalId: result.approval.id, officialSeq: null });

    // Một bản vẽ chỉ một yêu cầu chờ — kể cả người khác gửi.
    await expect(review.submit(ADMIN, diagramId, { reason: 'Gửi lần hai' })).rejects.toMatchObject({ status: 409 });
  });

  it('không ai tự duyệt bản mình gửi; Thành viên không duyệt/phát hành được', async () => {
    const dev = await newDevice('SW-E2E-RV-SELF');
    const { diagramId } = await drawn('Tự duyệt', deviceCell('d1', dev, 'SW-E2E-RV-SELF'), ADMIN.email);
    const { approval } = await review.submit(ADMIN, diagramId, { reason: 'Admin gửi' });
    await expect(review.approve(ADMIN, diagramId, approval.id)).rejects.toMatchObject({
      status: 403,
      response: { code: 'CANNOT_APPROVE_OWN_REQUEST' },
    });
    await expect(review.approve(MEMBER, diagramId, approval.id)).rejects.toMatchObject({ status: 403 });
    await expect(review.publish(MEMBER, diagramId, {})).rejects.toMatchObject({ status: 403 });
    expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = $1 AND official_version_id IS NULL`, [diagramId])).toBe(1);
  });

  it('trả về → sửa → gửi lại → duyệt: bản chính thức, yêu cầu đóng, thư báo người gửi', async () => {
    const dev = await newDevice('SW-E2E-RV-FLOW');
    const { diagramId, versionId } = await drawn('Luồng', deviceCell('d1', dev, 'SW-E2E-RV-FLOW'));
    const first = await review.submit(MEMBER, diagramId, { reason: 'Lần 1' });

    // Trả về phải có ít nhất một ghi chú (ghim hay ghi chú chung).
    await expect(review.returnToSender(SA, diagramId, first.approval.id, {})).rejects.toMatchObject({
      status: 400,
      response: { code: 'DIAGRAM_RETURN_NOTE_REQUIRED' },
    });
    const pin = await review.addComment(SA, diagramId, { versionId, cellId: 'd1', anchor: { x: 10, y: 20 }, body: 'Sai cổng uplink' });
    expect(pin).toMatchObject({ approvalId: first.approval.id, cellId: 'd1', kind: 'note' });
    const returned = await review.returnToSender(SA, diagramId, first.approval.id, {});
    expect(returned.state).toBe('returned');
    expect(
      await count(
        `SELECT count(*)::int AS n FROM outbox WHERE topic = 'approval.decided' AND payload->>'approvalId' = $1 AND payload->>'state' = 'returned'`,
        [first.approval.id],
      ),
    ).toBe(1);
    expect((await review.overlay([await diagrams.node(diagramId)]))[0].status).toBe('draft');

    // Người gửi trả lời trong luồng, đánh dấu đã xử lý, sửa và gửi lại.
    await review.addComment(MEMBER, diagramId, { versionId, parentId: pin.id, body: 'Đã đổi sang Gi0/48' });
    await review.resolveComment(MEMBER, diagramId, pin.id, true);
    const threads = await review.comments(diagramId);
    expect(threads.find((t) => t.id === pin.id)).toMatchObject({
      resolved: true,
      replies: [{ body: 'Đã đổi sang Gi0/48', author: MEMBER.email }],
    });
    const fixed = await diagrams.save(MEMBER.email, diagramId, { xml: page(deviceCell('d1', dev, 'SW-E2E-RV-FLOW', { x: 50 })), svg: SVG, basedOnVersionId: versionId });
    const second = await review.submit(MEMBER, diagramId, { reason: 'Lần 2 đã sửa' });
    expect(second.approval.payload).toMatchObject({ versionId: fixed.id });

    const approved = await review.approve(SA, diagramId, second.approval.id, 'OK');
    expect(approved.state).toBe('approved');
    const { rows } = await scratch.pool.query<{ official_version_id: string }>(`SELECT official_version_id FROM diagram WHERE id = $1`, [diagramId]);
    expect(rows[0].official_version_id).toBe(fixed.id);
    expect(await count(`SELECT count(*)::int AS n FROM diagram_history WHERE diagram_id = $1 AND action = 'version.published'`, [diagramId])).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.published' AND object_id = $1`, [diagramId])).toBe(1);
    expect(
      await count(`SELECT count(*)::int AS n FROM outbox WHERE topic = 'approval.decided' AND payload->>'approvalId' = $1 AND payload->>'state' = 'approved'`, [
        second.approval.id,
      ]),
    ).toBe(1);
    expect((await review.overlay([await diagrams.node(diagramId)]))[0]).toMatchObject({ status: 'official', officialSeq: 2, officialVersionId: fixed.id });
  });

  it('duyệt chạy lại tự kiểm: máy vừa thanh lý sau khi gửi → không duyệt được, yêu cầu vẫn chờ, cờ chính thức không đổi', async () => {
    const dev = await newDevice('SW-E2E-RV-LATE');
    const { diagramId } = await drawn('Muộn', deviceCell('d1', dev, 'SW-E2E-RV-LATE'));
    const { approval } = await review.submit(MEMBER, diagramId, { reason: 'Gửi' });
    await scratch.pool.query(`UPDATE device SET status = 'retired' WHERE id = $1`, [dev]);
    await expect(review.approve(SA, diagramId, approval.id)).rejects.toMatchObject({ response: { code: 'DIAGRAM_CHECK_FAILED' } });
    expect(await count(`SELECT count(*)::int AS n FROM approval WHERE id = $1 AND state = 'pending'`, [approval.id])).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = $1 AND official_version_id IS NULL`, [diagramId])).toBe(1);
  });

  it('người gửi tự rút; người khác rút → 403', async () => {
    const dev = await newDevice('SW-E2E-RV-WD');
    const { diagramId } = await drawn('Rút', deviceCell('d1', dev, 'SW-E2E-RV-WD'));
    const { approval } = await review.submit(MEMBER, diagramId, { reason: 'Gửi' });
    await expect(review.withdraw(ADMIN, diagramId, approval.id)).rejects.toMatchObject({ status: 403 });
    expect((await review.withdraw(MEMBER, diagramId, approval.id)).state).toBe('withdrawn');
    expect((await review.overlay([await diagrams.node(diagramId)]))[0].status).toBe('draft');
  });

  it('Admin/SA tự phát hành (lưu vẫn là nháp); tự kiểm đỏ cũng chặn phát hành', async () => {
    const dev = await newDevice('SW-E2E-RV-PUB');
    const { diagramId, versionId } = await drawn('Phát hành', deviceCell('d1', dev, 'SW-E2E-RV-PUB'), SA.email);
    expect((await review.overlay([await diagrams.node(diagramId)]))[0]).toMatchObject({ status: 'draft', officialVersionId: null });
    const published = await review.publish(SA, diagramId, {});
    expect(published).toMatchObject({ versionId, seq: 1 });
    expect((await review.overlay([await diagrams.node(diagramId)]))[0]).toMatchObject({ status: 'official', officialSeq: 1 });
    expect(await count(`SELECT count(*)::int AS n FROM approval WHERE subject_id = $1`, [diagramId])).toBe(0);

    const v2 = await diagrams.save(SA.email, diagramId, { xml: page(deviceCell('d1', dev, 'SW-E2E-RV-PUB', { x: 99 })), svg: SVG, basedOnVersionId: versionId });
    await scratch.pool.query(`UPDATE device SET status = 'retired' WHERE id = $1`, [dev]);
    await expect(review.publish(SA, diagramId, { versionId: v2.id })).rejects.toMatchObject({ response: { code: 'DIAGRAM_CHECK_FAILED' } });
    await scratch.pool.query(`UPDATE device SET status = 'in_use' WHERE id = $1`, [dev]);
  });

  it('khôi phục bản chính thức cũ một cú bấm: phiên bản MỚI chép bản cũ và thành chính thức, không xoá gì', async () => {
    const dev = await newDevice('SW-E2E-RV-RST');
    const { diagramId, versionId: v1 } = await drawn('Khôi phục', deviceCell('d1', dev, 'SW-E2E-RV-RST'), SA.email);
    await review.publish(SA, diagramId, {});
    const v2 = await diagrams.save(SA.email, diagramId, { xml: page(deviceCell('d1', dev, 'SW-E2E-RV-RST', { x: 300 })), svg: SVG, basedOnVersionId: v1 });
    await review.publish(SA, diagramId, { versionId: v2.id });
    const pubs = await review.publications(diagramId);
    expect(pubs.publishedVersionIds).toEqual(expect.arrayContaining([v1, v2.id]));

    const restored = await review.restoreOfficial(SA, diagramId, v1);
    expect(restored).toMatchObject({ seq: 3 });
    const { rows } = await scratch.pool.query<{ official_version_id: string; restored: string }>(
      `SELECT d.official_version_id, v.restored_from_version_id AS restored FROM diagram d JOIN diagram_version v ON v.id = d.official_version_id WHERE d.id = $1`,
      [diagramId],
    );
    expect(rows[0]).toEqual({ official_version_id: restored.versionId, restored: v1 });
    expect(await count(`SELECT count(*)::int AS n FROM diagram_version WHERE diagram_id = $1`, [diagramId])).toBe(3);
    await expect(review.restoreOfficial(MEMBER, diagramId, v1)).rejects.toMatchObject({ status: 403 });
  });

  it('bình luận: nhãn trông như mật khẩu bị chặn; phiên bản của bản vẽ khác → 404; trả lời phải trỏ luồng gốc cùng bản vẽ', async () => {
    const dev = await newDevice('SW-E2E-RV-CMT');
    const { diagramId, versionId } = await drawn('Bình luận', deviceCell('d1', dev, 'SW-E2E-RV-CMT'));
    const other = await drawn('Bình luận khác', deviceCell('d1', dev, 'SW-E2E-RV-CMT'));
    await expect(review.addComment(SA, diagramId, { versionId, cellId: 'd1', body: 'mật khẩu Xk9#mQ2!vLp7' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'NOTE_LOOKS_LIKE_SECRET' },
    });
    await expect(review.addComment(SA, diagramId, { versionId: other.versionId, body: 'x' })).rejects.toMatchObject({ status: 404 });
    const root = await review.addComment(SA, other.diagramId, { versionId: other.versionId, body: 'Ghi chú chung' });
    expect(root).toMatchObject({ cellId: null, approvalId: null });
    await expect(review.addComment(SA, diagramId, { versionId, parentId: root.id, body: 'trả lời lạc' })).rejects.toMatchObject({ status: 404 });
    expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.commented' AND object_id = $1`, [other.diagramId])).toBe(1);
  });

  it('lượt dọn E2E (vùng `diagrams` của reset-e2e.mjs) dọn cả yêu cầu duyệt và luồng bình luận', async () => {
    const dev = await newDevice('SW-E2E-RV-RESET');
    const { diagramId, versionId } = await drawn('Dọn', deviceCell('d1', dev, 'SW-E2E-RV-RESET'));
    const { approval } = await review.submit(MEMBER, diagramId, { reason: 'Gửi' });
    const pin = await review.addComment(SA, diagramId, { versionId, cellId: 'd1', body: 'Sửa chỗ này' });
    await review.addComment(MEMBER, diagramId, { versionId, parentId: pin.id, body: 'Đã sửa' });
    await review.resolveComment(MEMBER, diagramId, pin.id, true);
    await review.returnToSender(SA, diagramId, approval.id, {});

    const source = readFileSync(join(__dirname, '..', 'scripts', 'reset-e2e.mjs'), 'utf8');
    const block = /\n {2}diagrams: \[([\s\S]*?)\n {2}\],/.exec(source);
    const client = await scratch.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [, statement] of block![1].matchAll(/`([^`]+)`/g)) await client.query(statement);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    expect(await count(`SELECT count(*)::int AS n FROM diagram_comment WHERE diagram_id = $1`, [diagramId])).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM approval WHERE id = $1`, [approval.id])).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM approval_history WHERE approval_id = $1`, [approval.id])).toBe(0);
    // Trigger chỉ-thêm bật lại sau lượt dọn (bảng đã trống nên hỏi thẳng pg_trigger).
    const { rows } = await scratch.pool.query<{ tgenabled: string }>(
      `SELECT tgenabled FROM pg_trigger WHERE tgname = 'diagram_comment_no_delete'`,
    );
    expect(rows[0].tgenabled).toBe('O');
  });

  it('trang duyệt: tóm tắt so với bản chính thức + cảnh báo vàng + danh sách ô để ghim', async () => {
    const devA = await newDevice('SW-E2E-RV-PG-A');
    const devB = await newDevice('SW-E2E-RV-PG-B', { cabinetId: cabinetB });
    // Máy A đứng ngoài khung tủ (x=900) — chỉ máy B nằm trong khung sai tủ.
    const { diagramId, versionId } = await drawn('Trang duyệt', deviceCell('d1', devA, 'SW-E2E-RV-PG-A', { x: 900 }), SA.email);
    await review.publish(SA, diagramId, {});
    await diagrams.save(MEMBER.email, diagramId, {
      xml: page(deviceCell('d1', devA, 'SW-E2E-RV-PG-A', { x: 900 }) + cabinetFrame('f1', cabinetA) + deviceCell('d2', devB, 'SW-E2E-RV-PG-B', { parent: 'f1' })),
      svg: SVG,
      basedOnVersionId: versionId,
    });
    const { approval } = await review.submit(MEMBER, diagramId, { reason: 'Thêm máy B' });
    const page1 = await review.review(diagramId);
    expect(page1.approval).toMatchObject({ id: approval.id, requesterName: MEMBER.fullName });
    expect(page1.summary).toBe('Thêm 1 thiết bị, 1 hình tự do');
    expect(page1.officialSeq).toBe(1);
    expect(page1.warnings.map((w) => w.code)).toEqual(['DEVICE_CABINET_MISMATCH']);
    expect(page1.errors).toEqual([]);
    expect(page1.cells.map((c) => c.id).sort()).toEqual(['d1', 'd2', 'f1']);
  });
});
