import { PDFDocument } from 'pdf-lib';
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
import { DevicesApiService } from '../src/modules/devices/devices.api';
import { DevicesService } from '../src/modules/devices/devices.service';
import { DiagramExportService } from '../src/modules/diagrams/diagram-export.service';
import { DiagramReviewService } from '../src/modules/diagrams/diagram-review.service';
import { DiagramsService } from '../src/modules/diagrams/diagrams.service';
import type { IpamApiService } from '../src/modules/ipam/ipam.api';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import type { SweepService } from '../src/modules/queue/sweep.service';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Xuất PNG/PDF (FR-044) và so sánh phiên bản (Q-23) trên Postgres thật: file dựng từ SVG ĐÃ LƯU,
 * chân trang đọc đúng trạng thái/người duyệt từ sự kiện phát hành, một dòng `diagram.exported`
 * mỗi lượt có file — lỗi trần thì không có dòng nào; so sánh ghi `diagram.viewed`.
 */

const TEST_TIMEOUT = 180_000;
const SA = { email: 'e2e-export-sa@qa.test', role: 'sa' as const, fullName: 'E2E SA Xuất' };
const MEMBER = { email: 'e2e-export-member@qa.test', role: 'member' as const, fullName: 'E2E Thành viên Vẽ' };

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;
const noopSweep = { register: () => undefined } as unknown as SweepService;

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function shape(id: string, value: string, x = 0): string {
  return `<mxCell id="${id}" value="${value}" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="80" height="40" as="geometry"/></mxCell>`;
}

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="400px" height="200px" viewBox="-0.5 -0.5 400 200"><g data-cell-id="s1"><rect x="10" y="10" width="80" height="40" fill="#ffffff" stroke="#000000"/><text x="20" y="35">Tủ E2E</text></g></svg>';

describe('Sơ đồ mạng · xuất PNG/PDF và so sánh phiên bản', () => {
  let scratch: ScratchDb;
  let diagrams: DiagramsService;
  let review: DiagramReviewService;
  let exports: DiagramExportService;
  let n = 0;

  async function auditRows(diagramId: string, action: string) {
    const { rows } = await scratch.pool.query<{ actor: string; detail: Record<string, unknown> }>(
      `SELECT actor, detail FROM audit_log WHERE object_id = $1 AND action = $2 ORDER BY id`,
      [diagramId, action],
    );
    return rows;
  }

  async function drawn(body: string, svg = SVG) {
    n += 1;
    const parent = await diagrams.create(MEMBER.email, { name: `E2E Công ty xuất ${n}`, nodeType: 'company' });
    const diagram = await diagrams.create(MEMBER.email, { name: `E2E Lầu xuất ${n}`, nodeType: 'floor', parentId: parent.id });
    const version = await diagrams.save(MEMBER.email, diagram.id, { xml: page(body), svg, basedOnVersionId: null });
    return { diagramId: diagram.id, versionId: version.id, parentName: parent.name, name: diagram.name };
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagram_export');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const audit = new AuditWriterService(db);
    const config = new SystemConfigService(db);
    const catalog = new CatalogApiService(new CatalogService(db, audit));
    const devices = new DevicesApiService(new DevicesService(db, catalog, audit, noRetirement, new DeviceSearchRegistry()));
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
    exports = new DiagramExportService(db, audit, config, users);
    for (const user of [SA, MEMBER]) {
      await scratch.pool.query(`INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, 'x')`, [user.email, user.fullName, user.role]);
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('bản nháp → PNG có dải "BẢN NHÁP", chân trang nêu đường dẫn cây + người vẽ; một dòng diagram.exported', async () => {
    const { diagramId, versionId, parentName, name } = await drawn(shape('s1', 'Tủ E2E'));
    const file = await exports.export(MEMBER, diagramId, versionId, 'png');
    expect(file.contentType).toBe('image/png');
    expect(file.body.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(file.body.length).toBeGreaterThan(1000);
    expect(file.status).toBe('draft');
    expect(file.footer[0]).toBe(`${parentName} / ${name}`);
    expect(file.footer[1]).toBe('Phiên bản #1 · Bản nháp — chưa duyệt');
    expect(file.footer[2]).toContain('Người vẽ: E2E Thành viên Vẽ');
    expect(file.footer[2]).toContain(`Xuất bởi E2E Thành viên Vẽ <${MEMBER.email}>`);
    expect(file.fileName).toBe(`${name} - v1.png`);
    expect(await auditRows(diagramId, 'diagram.exported')).toEqual([
      { actor: MEMBER.email, detail: expect.objectContaining({ versionId, seq: 1, format: 'png', status: 'draft' }) },
    ]);
  });

  it('bản chính thức → PDF, chân trang có người duyệt (người phát hành) và ngày duyệt; bản bị thay thành "đã thay"', async () => {
    const { diagramId, versionId } = await drawn(shape('s1', 'Tủ E2E'));
    await review.publish(SA, diagramId, { versionId });
    const file = await exports.export(MEMBER, diagramId, versionId, 'pdf');
    expect(file.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pdf = await PDFDocument.load(file.body);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getSubject()).toContain('Chính thức');
    expect(file.status).toBe('official');
    expect(file.footer[1]).toMatch(/^Phiên bản #1 · Chính thức · Duyệt \d\d\/\d\d\/\d{4} \d\d:\d\d bởi E2E SA Xuất$/);

    const next = await diagrams.save(MEMBER.email, diagramId, { xml: page(shape('s1', 'Tủ E2E', 30)), svg: SVG, basedOnVersionId: versionId });
    await review.publish(SA, diagramId, { versionId: next.id });
    const old = await exports.export(MEMBER, diagramId, versionId, 'png');
    expect(old.status).toBe('superseded');
    expect(old.footer[1]).toContain('Từng là bản chính thức (đã thay)');
  });

  it('vượt trần điểm ảnh ở cả độ nét thường → 400, KHÔNG có dòng diagram.exported', async () => {
    const huge = SVG.replace('width="400px" height="200px" viewBox="-0.5 -0.5 400 200"', 'width="9000px" height="9000px" viewBox="0 0 9000 9000"');
    const { diagramId, versionId } = await drawn(shape('s1', 'Tủ E2E'), huge);
    await scratch.pool.query(`UPDATE system_config SET value = '4' WHERE key = 'diagram.export_max_megapixels'`);
    try {
      await expect(exports.export(MEMBER, diagramId, versionId, 'png')).rejects.toMatchObject({
        status: 400,
        response: { code: 'DIAGRAM_EXPORT_TOO_LARGE' },
      });
    } finally {
      await scratch.pool.query(`UPDATE system_config SET value = '40' WHERE key = 'diagram.export_max_megapixels'`);
    }
    expect(await auditRows(diagramId, 'diagram.exported')).toEqual([]);
  });

  it('phiên bản của bản vẽ khác → 404, không xuất', async () => {
    const a = await drawn(shape('s1', 'A'));
    const b = await drawn(shape('s1', 'B'));
    await expect(exports.export(MEMBER, a.diagramId, b.versionId, 'png')).rejects.toMatchObject({ status: 404 });
    expect(await auditRows(a.diagramId, 'diagram.exported')).toEqual([]);
  });

  it('so sánh hai phiên bản: thêm/bỏ/đổi theo ô + ảnh xem của bản sau; ghi diagram.viewed chế độ so sánh', async () => {
    const { diagramId, versionId } = await drawn(shape('s1', 'Tủ E2E') + shape('s2', 'Bỏ', 200));
    const next = await diagrams.save(MEMBER.email, diagramId, {
      xml: page(shape('s1', 'Tủ E2E đổi') + shape('s3', 'Mới', 300)),
      svg: SVG,
      basedOnVersionId: versionId,
    });
    const view = await exports.compare(MEMBER.email, diagramId, versionId, next.id);
    expect(view.counts).toEqual({ added: 1, removed: 1, changed: 1 });
    expect(view.result.removed[0]).toMatchObject({ id: 's2', bounds: { x: 200, y: 0, width: 80, height: 40 } });
    expect(view.to).toMatchObject({ id: next.id, seq: 2 });
    expect(view.to.svg).toContain('data-cell-id="s1"');
    const viewed = await auditRows(diagramId, 'diagram.viewed');
    expect(viewed[viewed.length - 1].detail).toMatchObject({ mode: 'compare', versionId: next.id, fromVersionId: versionId });
  });

  it('so sánh với phiên bản của bản vẽ khác → 404, không ghi diagram.viewed', async () => {
    const a = await drawn(shape('s1', 'A'));
    const b = await drawn(shape('s1', 'B'));
    await expect(exports.compare(MEMBER.email, a.diagramId, a.versionId, b.versionId)).rejects.toMatchObject({ status: 404 });
    expect(await auditRows(a.diagramId, 'diagram.viewed')).toEqual([]);
  });

  it('sự kiện phát hành theo thời gian (nguồn của thanh trượt thời gian)', async () => {
    const { diagramId, versionId } = await drawn(shape('s1', 'Tủ E2E'));
    await review.publish(SA, diagramId, { versionId });
    const next = await diagrams.save(MEMBER.email, diagramId, { xml: page(shape('s1', 'Tủ E2E', 40)), svg: SVG, basedOnVersionId: versionId });
    await review.publish(SA, diagramId, { versionId: next.id });
    const pubs = await review.publications(diagramId);
    expect(pubs.events.map((e) => [e.versionId, e.seq])).toEqual([
      [versionId, 1],
      [next.id, 2],
    ]);
    expect(Date.parse(pubs.events[0].at)).toBeLessThanOrEqual(Date.parse(pubs.events[1].at));
  });
});
