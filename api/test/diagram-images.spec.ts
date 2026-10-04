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
import { DiagramExportService } from '../src/modules/diagrams/diagram-export.service';
import { sanitizeDiagramSvg } from '../src/modules/diagrams/diagram-gate';
import { dehydrateDiagramXml } from '../src/modules/diagrams/diagram-hydrate';
import { DiagramPruneService } from '../src/modules/diagrams/diagram-prune.service';
import { DiagramsService } from '../src/modules/diagrams/diagrams.service';
import type { IpamApiService } from '../src/modules/ipam/ipam.api';
import { UsersApiService } from '../src/modules/users/users.api';
import { UsersService } from '../src/modules/users/users.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';
import { noPhotos } from './device-photos-stub';

/**
 * Ảnh bản vẽ lưu MỘT lần (Q-23, 0057) trên Postgres thật: lưu rồi mở lại ra đúng từng byte, lưu
 * nhiều lần cùng ảnh chỉ một hàng ảnh, và Bỏ bản nháp / Xoá hẳn dọn ảnh không còn ai dùng — nhưng
 * không đụng ảnh phiên bản khác còn dùng.
 */

const TEST_TIMEOUT = 180_000;
const SA = { email: 'e2e-image-sa@qa.test', role: 'sa' as const, fullName: 'E2E SA Ảnh' };

const noRetirement = {
  holdingsWithin: () => Promise.resolve([]),
  releaseAllWithin: () => Promise.resolve(),
} as unknown as DeviceRetirementRegistry;

/** "Ảnh" PNG giả đủ lớn để được tách; mỗi `seed` một nội dung. */
function photo(seed: number): string {
  return Buffer.alloc(3000, seed).toString('base64');
}

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function imageCell(id: string, b64: string, x = 0): string {
  return `<mxCell id="${id}" value="" style="shape=image;aspect=fixed;image=data:image/png,${b64};" vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="80" height="80" as="geometry"/></mxCell>`;
}

function svgWith(...b64s: string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg">${b64s.map((b, i) => `<g data-cell-id="i${i}"><image href="data:image/png;base64,${b}" width="80" height="80"/></g>`).join('')}</svg>`;
}

describe('Sơ đồ mạng · ảnh lưu một lần (Q-23)', () => {
  let scratch: ScratchDb;
  let diagrams: DiagramsService;
  let prune: DiagramPruneService;
  let exporter: DiagramExportService;
  let n = 0;

  async function count(sql: string, params: unknown[] = []): Promise<number> {
    const { rows } = await scratch.pool.query<{ n: number }>(sql, params);
    return rows[0].n;
  }

  async function newDiagram() {
    n += 1;
    return diagrams.create(SA.email, { name: `E2E Ảnh ${n}`, nodeType: 'floor' });
  }

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagram_images');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const db = scratch.db;
    const audit = new AuditWriterService(db);
    const config = new SystemConfigService(db);
    const catalog = new CatalogApiService(new CatalogService(db, audit));
    const devicesService = new DevicesService(db, catalog, audit, noRetirement, new DeviceSearchRegistry());
    const devices = new DevicesApiService(devicesService, new DevicePortsService(db, devicesService), noPhotos);
    const ipam = { heldAddressesOf: (ids: string[]) => Promise.resolve(new Map(ids.map((id) => [id, []]))) } as unknown as IpamApiService;
    const users = new UsersApiService(new UsersService(db));
    diagrams = new DiagramsService(db, audit, config, catalog, devices, ipam, users);
    prune = new DiagramPruneService(db, audit, new ApprovalsApiService(new ApprovalsService(db, audit, new ApprovalKindRegistry())));
    exporter = new DiagramExportService(db, audit, config, users, catalog);
    await scratch.pool.query(`INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, 'x')`, [SA.email, SA.fullName, SA.role]);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('lưu → kho chỉ giữ tham chiếu; mở lại (xem + sửa) ra đúng từng byte XML/SVG đã lưu', async () => {
    const d = await newDiagram();
    const xml = page(imageCell('a', photo(1)));
    const svg = svgWith(photo(1));
    const saved = await diagrams.save(SA.email, d.id, { xml, svg, basedOnVersionId: null });

    const { rows } = await scratch.pool.query<{ xml: string; svg: string }>(`SELECT xml, svg FROM diagram_version WHERE id = $1`, [saved.id]);
    expect(rows[0].xml).not.toContain('data:image');
    expect(rows[0].svg).not.toContain('data:image');
    expect(rows[0].xml).toMatch(/image=ims-img:n:[0-9a-f]{64};/);

    const expectedXml = dehydrateDiagramXml(xml);
    const expectedSvg = sanitizeDiagramSvg(svg, { svgMaxKb: 10_000 }).value;
    for (const mode of ['view', 'edit'] as const) {
      const content = await diagrams.content(SA.email, d.id, { mode });
      if (mode === 'view') expect(content.version?.xml).toBe(expectedXml);
      else expect(content.version?.xml).toContain(`image=data:image/png,${photo(1)};`);
      expect(content.version?.svg).toBe(expectedSvg);
    }
    // XML và SVG mang cùng một ảnh (hai dạng `data:`) → một hàng ảnh.
    expect(await count(`SELECT count(*)::int AS n FROM diagram_version_image WHERE version_id = $1`, [saved.id])).toBe(1);
  });

  it('lưu hai lần cùng ảnh → một hàng ảnh, hai hàng nối; so sánh trả SVG đã ghép', async () => {
    const d = await newDiagram();
    const before = await count(`SELECT count(*)::int AS n FROM diagram_image`);
    const v1 = await diagrams.save(SA.email, d.id, { xml: page(imageCell('a', photo(2))), svg: svgWith(photo(2)), basedOnVersionId: null });
    const v2 = await diagrams.save(SA.email, d.id, { xml: page(imageCell('a', photo(2), 10)), svg: svgWith(photo(2)), basedOnVersionId: v1.id });
    expect(await count(`SELECT count(*)::int AS n FROM diagram_image`)).toBe(before + 1);
    expect(await count(`SELECT count(*)::int AS n FROM diagram_version_image WHERE version_id = ANY ($1::uuid[])`, [[v1.id, v2.id]])).toBe(2);
    const view = await exporter.compare(SA.email, d.id, v1.id, v2.id);
    expect(view.to.svg).toContain(`data:image/png;base64,${photo(2)}`);
  });

  it('bản sao / khôi phục dùng lại ảnh có sẵn, không chép ảnh', async () => {
    const d = await newDiagram();
    const v1 = await diagrams.save(SA.email, d.id, { xml: page(imageCell('a', photo(3))), svg: svgWith(photo(3)), basedOnVersionId: null });
    await diagrams.save(SA.email, d.id, { xml: page(''), svg: svgWith(), basedOnVersionId: v1.id });
    const images = await count(`SELECT count(*)::int AS n FROM diagram_image`);
    const restored = await diagrams.restore(SA.email, d.id, v1.id);
    expect(await count(`SELECT count(*)::int AS n FROM diagram_image`)).toBe(images);
    expect(await count(`SELECT count(*)::int AS n FROM diagram_version_image WHERE version_id = $1`, [restored.id])).toBe(1);
    const child = await diagrams.createCopiedChild(SA.email, d.id, { name: `E2E Ảnh con ${n}`, nodeType: 'room' });
    const content = await diagrams.content(SA.email, child.id, { mode: 'view' });
    expect(content.version?.svg).toContain(photo(3));
  });

  it('phiên bản cũ còn ảnh nhúng thẳng (trước 0057) vẫn mở được nguyên vẹn', async () => {
    const d = await newDiagram();
    const xml = page(imageCell('a', photo(4)));
    await scratch.pool.query(
      `INSERT INTO diagram_version (diagram_id, seq, xml, svg, cell_index, summary, summary_detail, saved_by)
       VALUES ($1, 1, $2, $3, '{"cells":[]}', 'cũ', '{}', $4)`,
      [d.id, xml, svgWith(photo(4)), SA.email],
    );
    const content = await diagrams.content(SA.email, d.id, { mode: 'view' });
    expect(content.version?.xml).toBe(xml);
    expect(content.version?.svg).toBe(svgWith(photo(4)));
  });

  it('XML gửi lên chứa sẵn chuỗi "ims-img:" → 400, không lưu', async () => {
    const d = await newDiagram();
    const forged = page(`<mxCell id="t" value="ims-img:b:${'a'.repeat(64)}" style="text;" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell>`);
    await expect(diagrams.save(SA.email, d.id, { xml: forged, svg: svgWith(), basedOnVersionId: null })).rejects.toMatchObject({ status: 400 });
  });

  it('Bỏ bản nháp dọn ảnh chỉ bản nháp dùng, giữ ảnh bản giữ lại còn dùng', async () => {
    const d = await newDiagram();
    const v1 = await diagrams.save(SA.email, d.id, { xml: page(imageCell('a', photo(5))), svg: svgWith(photo(5)), basedOnVersionId: null });
    await diagrams.save(SA.email, d.id, { xml: page(imageCell('a', photo(5)) + imageCell('b', photo(6), 100)), svg: svgWith(photo(5), photo(6)), basedOnVersionId: v1.id });
    const shaCount = async (seed: number) =>
      count(`SELECT count(*)::int AS n FROM diagram_image WHERE data = decode($1, 'base64')`, [photo(seed)]);
    expect([await shaCount(5), await shaCount(6)]).toEqual([1, 1]);
    await prune.discardDrafts(SA, d.id);
    expect([await shaCount(5), await shaCount(6)]).toEqual([1, 0]);
  });

  it('Xoá hẳn dọn mọi ảnh của bản vẽ không ai khác dùng', async () => {
    const d = await newDiagram();
    await diagrams.save(SA.email, d.id, { xml: page(imageCell('a', photo(7))), svg: svgWith(photo(7)), basedOnVersionId: null });
    await prune.purge(SA, d.id, d.name);
    expect(await count(`SELECT count(*)::int AS n FROM diagram_image WHERE data = decode($1, 'base64')`, [photo(7)])).toBe(0);
  });
});
