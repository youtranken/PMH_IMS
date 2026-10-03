import { runMigrations } from '../src/database/migration-runner';
import { AuditWriterService } from '../src/modules/audit/audit-writer.service';
import { SystemConfigService } from '../src/modules/config-sys/system-config.service';
import { DiagramSpikeService } from '../src/modules/diagrams/diagram-spike.service';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Bản thử sơ đồ draw.io: lưu/mở lại một bản vẽ theo tên, qua cổng kiểm XML (AD-17).
 *
 * Phải chạy trên Postgres thật: lời hứa ở đây là "dòng nhật ký sống chết CÙNG lượt lưu" (AD-5)
 * và trần của cổng đọc từ `system_config` trong DB — mock thì bài xanh mà không chứng minh gì.
 */

const TEST_TIMEOUT = 120_000;
const XML = '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>';

describe('Sơ đồ (bản thử draw.io) · lưu và mở lại', () => {
  let scratch: ScratchDb;
  let service: DiagramSpikeService;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_diagram_spike');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    service = new DiagramSpikeService(scratch.db, new AuditWriterService(scratch.db), new SystemConfigService(scratch.db));
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  });

  it('tên chưa có bản vẽ → trả xml null, không 404 (màn mở ra là khung trống)', async () => {
    await expect(service.get('E2E-chua-co')).resolves.toEqual({
      name: 'E2E-chua-co',
      xml: null,
      updatedBy: null,
      updatedAt: null,
    });
  });

  it('lưu lần đầu rồi lưu đè: một hàng theo tên, bản sau thắng, mỗi lượt một dòng nhật ký', async () => {
    await service.save('sa@e2e.local', 'E2E-luu', XML);
    const second = XML.replace('Trang 1', 'Trang 2');
    const saved = await service.save('admin@e2e.local', 'E2E-luu', second);

    expect(saved.xml).toBe(second);
    expect(saved.updatedBy).toBe('admin@e2e.local');
    const { rows } = await scratch.pool.query(`SELECT count(*)::int AS n FROM diagram_spike WHERE name = 'E2E-luu'`);
    expect(rows[0].n).toBe(1);

    const audit = await scratch.pool.query<{ action: string; actor: string; detail: { bytes: number; name: string } }>(
      `SELECT action, actor, detail FROM audit_log WHERE object_type = 'diagram_spike' ORDER BY created_at`,
    );
    expect(audit.rows.map((r) => [r.action, r.actor])).toEqual([
      ['diagram_spike.saved', 'sa@e2e.local'],
      ['diagram_spike.saved', 'admin@e2e.local'],
    ]);
    // Nhật ký ghi KÍCH THƯỚC, không chép XML: bảng nhật ký không xoá được, bản vẽ thì có thể chứa
    // ghi chú nhạy cảm.
    expect(audit.rows[1].detail).toEqual({ name: 'E2E-luu', bytes: Buffer.byteLength(second) });
  });

  it('XML không phải tệp draw.io → 400, không ghi gì', async () => {
    await expect(service.save('sa@e2e.local', 'E2E-sai', '<html><script>alert(1)</script></html>')).rejects.toMatchObject({
      response: { code: 'DIAGRAM_XML_INVALID' },
    });
    const { rows } = await scratch.pool.query(`SELECT count(*)::int AS n FROM diagram_spike WHERE name = 'E2E-sai'`);
    expect(rows[0].n).toBe(0);
  });

  it('nhãn <img onerror> → 400 kèm lý do tiếng Việt, không ghi bản vẽ lẫn nhật ký', async () => {
    const evil = XML.replace(
      '<mxCell id="0"/>',
      '<mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="x" value="&lt;img src=x onerror=alert(1)&gt;" style="html=1;" vertex="1" parent="1"/>',
    );
    await expect(service.save('sa@e2e.local', 'E2E-doc', evil)).rejects.toMatchObject({
      response: { code: 'DIAGRAM_XML_INVALID', message: expect.stringMatching(/Nhãn.*<img>/) },
    });
    const saved = await scratch.pool.query(`SELECT count(*)::int AS n FROM diagram_spike WHERE name = 'E2E-doc'`);
    const audit = await scratch.pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE object_type = 'diagram_spike' AND detail->>'name' = 'E2E-doc'`,
    );
    expect([saved.rows[0].n, audit.rows[0].n]).toEqual([0, 0]);
  });

  it('trần dung lượng đọc từ diagram.xml_max_kb trong DB', async () => {
    const big = XML.replace('Trang 1', 'x'.repeat(300 * 1024));
    await expect(service.save('sa@e2e.local', 'E2E-to', big)).resolves.toMatchObject({ name: 'E2E-to' });
    await scratch.pool.query(`UPDATE system_config SET value = '256' WHERE key = 'diagram.xml_max_kb'`);
    // Cache của SystemConfigService sống 30 giây: dựng service mới để đọc giá trị vừa đổi.
    const fresh = new DiagramSpikeService(scratch.db, new AuditWriterService(scratch.db), new SystemConfigService(scratch.db));
    await expect(fresh.save('sa@e2e.local', 'E2E-to', big)).rejects.toMatchObject({
      response: { code: 'DIAGRAM_XML_INVALID', message: expect.stringMatching(/256 KB/) },
    });
  });
});
