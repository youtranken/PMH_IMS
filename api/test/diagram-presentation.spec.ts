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
import { newerOfficialSeq } from '../src/modules/diagrams/diagram-presentation';
import { DiagramReviewService } from '../src/modules/diagrams/diagram-review.service';
import { DiagramsService } from '../src/modules/diagrams/diagrams.service';
import type { IpamApiService } from '../src/modules/ipam/ipam.api';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Bản trình bày (Q-23, FR-045) trên Postgres thật: nhân bản từ bản chính thức là một hàng
 * `diagram` riêng không đụng bản gốc; thiết bị dự kiến chỉ lưu được ở bản trình bày; bản trình
 * bày không gửi duyệt / phát hành được; bản gốc phát hành bản mới thì bản trình bày biết.
 */

const TEST_TIMEOUT = 180_000;
const SA = { email: 'e2e-pres-sa@qa.test', role: 'sa' as const, fullName: 'E2E SA Trình bày' };
const ADMIN = { email: 'e2e-pres-admin@qa.test', role: 'admin' as const, fullName: 'E2E Admin Trình bày' };
const MEMBER = { email: 'e2e-pres-member@qa.test', role: 'member' as const, fullName: 'E2E Thành viên Trình bày' };

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;
const noopSweep = { register: () => undefined } as unknown as SweepService;

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function deviceCell(id: string, deviceId: string, code: string): string {
  return `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="${id}"><mxCell style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="40" as="geometry"/></mxCell></UserObject>`;
}

function plannedCell(id: string, attrs = 'ims_planned="1" ims_planned_model="AP-9" ims_planned_price="12000000" ims_planned_vendor="NCC E2E"'): string {
  return `<UserObject label="AP dự kiến" ${attrs} id="${id}"><mxCell style="rounded=1;dashed=1;" vertex="1" parent="1"><mxGeometry x="300" y="0" width="100" height="40" as="geometry"/></mxCell></UserObject>`;
}

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function imageCell(id: string, src: string): string {
  return `<mxCell id="${id}" value="" style="shape=image;image=${src};" vertex="1" parent="1"><mxGeometry x="500" y="0" width="80" height="80" as="geometry"/></mxCell>`;
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><g data-cell-id="d1"><rect width="10" height="10"/></g></svg>';

describe('Sơ đồ mạng · bản trình bày (Q-23, FR-045)', () => {
  let scratch: ScratchDb;
  let diagrams: DiagramsService;
  let review: DiagramReviewService;
  let siteId: string;
  let typeId: string;
  let seq = 0;

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: number }>(sql, params);
    return rows[0].n;
  }

  async function newDevice(code: string): Promise<string> {
    const { rows } = await scratch.pool.query<{ id: string }>(
      `INSERT INTO device (code, name, device_type_id, site_id) VALUES ($1, $4, $2, $3) RETURNING id`,
      [code, typeId, siteId, code],
    );
    return rows[0].id;
  }

  /** Bản chính thức: SA vẽ rồi tự phát hành. */
  async function official(name: string, body: string) {
    seq += 1;
    const diagram = await diagrams.create(SA.email, { name: `E2E ${name} ${seq}`, nodeType: 'floor' });
    const version = await diagrams.save(SA.email, diagram.id, { xml: page(body), svg: SVG, basedOnVersionId: null });
    await review.publish(SA, diagram.id, {});
    return { diagramId: diagram.id, versionId: version.id, name: diagram.name };
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagram_presentation');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const audit = new AuditWriterService(db);
    const config = new SystemConfigService(db);
    const catalog = new CatalogApiService(new CatalogService(db, audit));
    const devicesService = new DevicesService(db, catalog, audit, noRetirement, new DeviceSearchRegistry());
    const devices = new DevicesApiService(devicesService, new DevicePortsService(db, devicesService));
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
    siteId = (await scratch.pool.query<{ id: string }>(`INSERT INTO site (code, name) VALUES ('E2E-PR', 'Site trình bày') RETURNING id`)).rows[0].id;
    typeId = (await scratch.pool.query<{ id: string }>(`INSERT INTO device_type (name) VALUES ('Switch E2E PR') RETURNING id`)).rows[0].id;
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('Thành viên nhân bản bản chính thức: hàng diagram mới kind=presentation chép đúng phiên bản chính thức, bản gốc không đổi', async () => {
    const dev = await newDevice('SW-E2E-PR-01');
    const src = await official('Gốc', deviceCell('d1', dev, 'SW-E2E-PR-01'));
    const versionsBefore = await count(`SELECT count(*)::int AS n FROM diagram_version WHERE diagram_id = $1`, [src.diagramId]);

    const pres = await diagrams.createPresentation(MEMBER.email, src.diagramId, {});
    expect(pres).toMatchObject({ kind: 'presentation', parentId: null, status: 'draft', name: `${src.name} — trình bày` });
    expect(pres.source).toMatchObject({ diagramId: src.diagramId, versionId: src.versionId, seq: 1, name: src.name, officialSeq: 1 });

    const { rows } = await scratch.pool.query<{ xml: string; source_xml: string; kind: string; sd: string; sv: string }>(
      `SELECT v.xml, sv.xml AS source_xml, d.kind, d.source_diagram_id AS sd, d.source_version_id AS sv
         FROM diagram d JOIN diagram_version v ON v.diagram_id = d.id JOIN diagram_version sv ON sv.id = d.source_version_id
        WHERE d.id = $1`,
      [pres.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'presentation', sd: src.diagramId, sv: src.versionId });
    expect(rows[0].xml).toBe(rows[0].source_xml);

    // Bản gốc: không thêm phiên bản, cờ chính thức nguyên.
    expect(await count(`SELECT count(*)::int AS n FROM diagram_version WHERE diagram_id = $1`, [src.diagramId])).toBe(versionsBefore);
    expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = $1 AND official_version_id = $2`, [src.diagramId, src.versionId])).toBe(1);

    // Lịch sử + nhật ký của bản mới, cùng transaction.
    expect(
      await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.presentation_created' AND object_id = $1 AND actor = $2`, [
        pres.id,
        MEMBER.email,
      ]),
    ).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM diagram_history WHERE diagram_id = $1 AND action = 'presentation.created'`, [pres.id])).toBe(1);

    // Mở xem vẫn ghi diagram.viewed như mọi bản vẽ.
    const content = await diagrams.content(MEMBER.email, pres.id, { mode: 'view' });
    expect(content.version?.seq).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.viewed' AND object_id = $1`, [pres.id])).toBe(1);
  });

  it('nhiều bản trình bày cho một bản chính thức: tên mặc định không trùng', async () => {
    const src = await official('Nhiều bản', '');
    const a = await diagrams.createPresentation(SA.email, src.diagramId, {});
    const b = await diagrams.createPresentation(ADMIN.email, src.diagramId, {});
    const c = await diagrams.createPresentation(MEMBER.email, src.diagramId, { name: 'E2E Đề xuất mua AP' });
    expect(new Set([a.name, b.name, c.name]).size).toBe(3);
    expect(b.name).toBe(`${src.name} — trình bày (2)`);
    expect(c.name).toBe('E2E Đề xuất mua AP');
  });

  it('bản vẽ chưa phát hành, bản trình bày, bản đã lưu trữ → không nhân bản được, không ghi gì', async () => {
    const draft = await diagrams.create(SA.email, { name: `E2E Nháp ${++seq}`, nodeType: 'floor' });
    await diagrams.save(SA.email, draft.id, { xml: page(''), svg: SVG, basedOnVersionId: null });
    const before = await count(`SELECT count(*)::int AS n FROM diagram WHERE kind = 'presentation'`);
    await expect(diagrams.createPresentation(SA.email, draft.id, {})).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_NOT_OFFICIAL' } });

    const src = await official('Nguồn', '');
    const pres = await diagrams.createPresentation(SA.email, src.diagramId, {});
    await expect(diagrams.createPresentation(SA.email, pres.id, {})).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_NOT_OFFICIAL' } });

    await diagrams.archive(SA, src.diagramId);
    await expect(diagrams.createPresentation(SA.email, src.diagramId, {})).rejects.toMatchObject({ status: 409 });
    expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE kind = 'presentation'`)).toBe(before + 1);
  });

  it('thiết bị dự kiến + ảnh tự do: lưu được ở bản trình bày; vào bản chính thức qua API → 400, không ghi phiên bản', async () => {
    const dev = await newDevice('SW-E2E-PR-02');
    const src = await official('Dự kiến', deviceCell('d1', dev, 'SW-E2E-PR-02'));
    const pres = await diagrams.createPresentation(MEMBER.email, src.diagramId, {});

    const body = deviceCell('d1', dev, 'SW-E2E-PR-02') + plannedCell('p1') + imageCell('img1', PNG_1PX);
    const saved = await diagrams.save(MEMBER.email, pres.id, { xml: page(body), svg: SVG, basedOnVersionId: null });
    expect(saved.seq).toBe(2);
    const content = await diagrams.content(MEMBER.email, pres.id, { mode: 'edit' });
    expect(content.version?.xml).toContain('ims_planned="1"');
    expect(content.version?.xml).toContain('ims_planned_price="12000000"');
    expect(content.version?.xml).toContain('dashed=1');
    expect(content.version?.xml).toContain('data:image/png;base64,');

    // Ảnh trỏ ra ngoài vẫn bị cổng XML từ chối ở bản trình bày.
    await expect(
      diagrams.save(MEMBER.email, pres.id, { xml: page(imageCell('img2', 'https://evil.example/x.png')), svg: SVG, basedOnVersionId: null }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'DIAGRAM_XML_INVALID' } });

    const before = await count(`SELECT count(*)::int AS n FROM diagram_version WHERE diagram_id = $1`, [src.diagramId]);
    for (const attrs of ['ims_planned="1"', 'ims_planned="0"', 'ims_planned_price="1"']) {
      await expect(
        diagrams.save(SA.email, src.diagramId, { xml: page(plannedCell('p9', attrs)), svg: SVG, basedOnVersionId: src.versionId }),
      ).rejects.toMatchObject({ status: 400, response: { code: 'DIAGRAM_PLANNED_NOT_ALLOWED' } });
    }
    expect(await count(`SELECT count(*)::int AS n FROM diagram_version WHERE diagram_id = $1`, [src.diagramId])).toBe(before);
  });

  it('bản trình bày không gửi duyệt, không phát hành, không khôi phục làm chính thức', async () => {
    const src = await official('Không duyệt', '');
    const pres = await diagrams.createPresentation(MEMBER.email, src.diagramId, {});
    await diagrams.save(MEMBER.email, pres.id, { xml: page(plannedCell('p1')), svg: SVG, basedOnVersionId: null });

    // Có thiết bị dự kiến: tự kiểm báo đỏ PLANNED_DEVICE.
    await expect(review.submit(MEMBER, pres.id, { reason: 'Xin duyệt' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'DIAGRAM_CHECK_FAILED', errors: [{ code: 'PLANNED_DEVICE', cellId: 'p1' }] },
    });
    await expect(review.publish(SA, pres.id, {})).rejects.toMatchObject({ response: { code: expect.stringMatching(/DIAGRAM_NOT_REVIEWABLE|DIAGRAM_CHECK_FAILED/) } });

    // Không có thiết bị dự kiến: vẫn không duyệt được (bản trình bày không vào luồng duyệt).
    const clean = await diagrams.save(MEMBER.email, pres.id, { xml: page(''), svg: SVG, basedOnVersionId: null });
    await expect(review.submit(MEMBER, pres.id, { reason: 'Xin duyệt' })).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_NOT_REVIEWABLE' } });
    await expect(review.publish(SA, pres.id, { versionId: clean.id })).rejects.toMatchObject({ status: 409, response: { code: 'DIAGRAM_NOT_REVIEWABLE' } });
    await expect(review.restoreOfficial(SA, pres.id, clean.id)).rejects.toMatchObject({ status: 409 });
    expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = $1 AND official_version_id IS NULL`, [pres.id])).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM approval WHERE subject_id = $1`, [pres.id])).toBe(0);
  });

  it('bản gốc phát hành phiên bản mới → bản trình bày biết (N+k), không tự cập nhật', async () => {
    const dev = await newDevice('SW-E2E-PR-03');
    const src = await official('Bản mới', deviceCell('d1', dev, 'SW-E2E-PR-03'));
    const pres = await diagrams.createPresentation(SA.email, src.diagramId, {});
    expect(newerOfficialSeq(pres.source)).toBeNull();

    await diagrams.save(SA.email, src.diagramId, { xml: page(''), svg: SVG, basedOnVersionId: src.versionId });
    await diagrams.save(SA.email, src.diagramId, { xml: page(deviceCell('d1', dev, 'SW-E2E-PR-03')), svg: SVG, basedOnVersionId: null });
    // Nháp mới chưa phát hành: chưa phải "phiên bản chính thức mới".
    expect(newerOfficialSeq((await diagrams.node(pres.id)).source)).toBeNull();
    await review.publish(SA, src.diagramId, {});

    const node = await diagrams.node(pres.id);
    expect(node.source).toMatchObject({ seq: 1, officialSeq: 3 });
    expect(newerOfficialSeq(node.source)).toBe(3);
    // Nội dung bản trình bày vẫn là bản đã chép.
    expect(await count(`SELECT count(*)::int AS n FROM diagram_version WHERE diagram_id = $1`, [pres.id])).toBe(1);
    // Cây cũng mang thông tin nguồn (không cần mã — chỉ tên + số phiên bản).
    expect((await diagrams.tree()).find((n) => n.id === pres.id)?.source).toMatchObject({ officialSeq: 3 });
  });

  it('bản trình bày đứng ngoài cây chính thức: không làm cha, không chuyển vào cây; không vào "Có mặt trong các bản vẽ"', async () => {
    const dev = await newDevice('SW-E2E-PR-04');
    const src = await official('Ngoài cây', deviceCell('d1', dev, 'SW-E2E-PR-04'));
    const pres = await diagrams.createPresentation(SA.email, src.diagramId, {});

    await expect(diagrams.create(SA.email, { name: `E2E Con ${++seq}`, nodeType: 'room', parentId: pres.id })).rejects.toMatchObject({
      status: 400,
      response: { code: 'DIAGRAM_PARENT_INVALID' },
    });
    await expect(diagrams.update(SA, pres.id, { parentId: src.diagramId })).rejects.toMatchObject({
      status: 400,
      response: { code: 'DIAGRAM_PRESENTATION_NO_PARENT' },
    });
    await expect(diagrams.update(SA, src.diagramId, { parentId: pres.id })).rejects.toMatchObject({
      status: 400,
      response: { code: 'DIAGRAM_PARENT_INVALID' },
    });
    // Đổi tên thì được.
    await expect(diagrams.update(SA, pres.id, { name: `E2E Đổi tên trình bày ${seq}` })).resolves.toMatchObject({ kind: 'presentation' });

    const listed = await diagrams.diagramsWithDevice(dev);
    expect(listed.map((d) => d.id)).toEqual([src.diagramId]);
  });

  it('Thành viên đổi tên + lưu trữ bản trình bày CỦA MÌNH; bản của người khác / bản chính thức → 403; Admin/SA được mọi bản', async () => {
    const OTHER = { email: 'e2e-pres-other@qa.test', role: 'member' as const };
    await scratch.pool.query(`INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, 'E2E Thành viên khác', 'member', 'x') ON CONFLICT DO NOTHING`, [
      OTHER.email,
    ]);
    const src = await official('Quyền', '');
    const mine = await diagrams.createPresentation(MEMBER.email, src.diagramId, {});

    const renamed = await diagrams.update(MEMBER, mine.id, { name: `E2E Của tôi ${seq}` });
    expect(renamed.name).toBe(`E2E Của tôi ${seq}`);
    expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.updated' AND object_id = $1 AND actor = $2`, [mine.id, MEMBER.email])).toBe(1);

    // Người khác: không đổi tên, không lưu trữ, không ghi gì.
    await expect(diagrams.update(OTHER, mine.id, { name: 'E2E Chiếm' })).rejects.toMatchObject({ status: 403, response: { code: 'DIAGRAM_MANAGE_FORBIDDEN' } });
    await expect(diagrams.archive(OTHER, mine.id)).rejects.toMatchObject({ status: 403, response: { code: 'DIAGRAM_MANAGE_FORBIDDEN' } });
    // Chủ bản trình bày cũng chỉ đổi TÊN: loại nút, người phụ trách vẫn của Admin.
    await expect(diagrams.update(MEMBER, mine.id, { ownerEmail: OTHER.email })).rejects.toMatchObject({ status: 403 });
    await expect(diagrams.update(MEMBER, mine.id, { nodeType: 'room' })).rejects.toMatchObject({ status: 403 });
    // Bản chính thức giữ luật cũ: Thành viên không đổi tên, không lưu trữ.
    await expect(diagrams.update(MEMBER, src.diagramId, { name: 'E2E Đổi gốc' })).rejects.toMatchObject({ status: 403 });
    await expect(diagrams.archive(MEMBER, src.diagramId)).rejects.toMatchObject({ status: 403 });
    expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = $1 AND archived_at IS NULL`, [src.diagramId])).toBe(1);

    // Người phụ trách (owner_email) cũng quản được, kể cả khi không phải người tạo.
    await scratch.pool.query(`UPDATE diagram SET owner_email = $1 WHERE id = $2`, [OTHER.email, mine.id]);
    await expect(diagrams.update(OTHER, mine.id, { name: `E2E Phụ trách ${seq}` })).resolves.toMatchObject({ name: `E2E Phụ trách ${seq}` });

    await diagrams.archive(MEMBER, mine.id);
    expect(await count(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'diagram.archived' AND object_id = $1 AND actor = $2`, [mine.id, MEMBER.email])).toBe(1);

    const theirs = await diagrams.createPresentation(OTHER.email, src.diagramId, {});
    await expect(diagrams.update(ADMIN, theirs.id, { name: `E2E Admin đổi ${seq}` })).resolves.toMatchObject({ name: `E2E Admin đổi ${seq}` });
    await diagrams.archive(ADMIN, theirs.id);
  });

  it('DB chặn bản chính thức mang nguồn, và bản trình bày có cha', async () => {
    const src = await official('Ràng buộc', '');
    await expect(
      scratch.pool.query(`UPDATE diagram SET source_diagram_id = $1 WHERE id = $1`, [src.diagramId]),
    ).rejects.toMatchObject({ code: '23514' });
    const pres = await diagrams.createPresentation(SA.email, src.diagramId, {});
    await expect(scratch.pool.query(`UPDATE diagram SET parent_id = $1 WHERE id = $2`, [src.diagramId, pres.id])).rejects.toMatchObject({
      code: '23514',
    });
  });

  /*
   * Lượt dọn E2E (`api/scripts/reset-e2e.mjs`, vùng `diagrams`) chạy đúng câu SQL của script: bản
   * trình bày của một bản vẽ E2E bị dọn theo dù người kiểm đã đổi tên nó (không còn chữ E2E), và
   * khoá ngoại nguồn không chặn lượt xoá.
   */
  it('lượt dọn E2E dọn cả bản trình bày của bản vẽ E2E, kể cả bản đã đổi tên', async () => {
    const src = await official('Dọn', '');
    const pres = await diagrams.createPresentation(MEMBER.email, src.diagramId, {});
    await diagrams.update(SA, pres.id, { name: 'Bản trình bày đã đổi tên' });
    const real = await diagrams.create(SA.email, { name: 'Bản vẽ thật', nodeType: 'company' });

    const script = readFileSync(join(__dirname, '..', 'scripts', 'reset-e2e.mjs'), 'utf8');
    const block = /\n {2}diagrams: \[([\s\S]*?)\n {2}\],/.exec(script);
    if (!block) throw new Error('Không tìm thấy vùng diagrams trong reset-e2e.mjs');
    const client = await scratch.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [, statement] of block[1].matchAll(/`([^`]+)`/g)) await client.query(statement);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = ANY($1)`, [[src.diagramId, pres.id]])).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM diagram WHERE id = $1`, [real.id])).toBe(1);
  });
});
