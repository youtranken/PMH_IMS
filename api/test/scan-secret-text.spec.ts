import { runMigrations } from '../src/database/migration-runner';
import { COLUMN_SCANS, formatFindings, scanSecretText } from '../src/ops/scan-secret-text';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Q-19, SEC-21 — quét dữ liệu ĐANG CÓ tìm ô chữ trông như mật khẩu, chỉ báo cáo.
 *
 * Trên Postgres thật vì hai điều hàm thuần không nói được: mọi câu SELECT của bảng quét khớp
 * schema thật (sai tên cột là script hỏng đúng ngày SA cần nó), và báo cáo không mang nội dung ô.
 */

const TEST_TIMEOUT = 120_000;
const SECRET = 'Pmh@Guest2026';

describe('Quét ô chữ trông như mật khẩu (SEC-21)', () => {
  let scratch: ScratchDb;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_scan_secret_text');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const q = (sql: string, params: unknown[] = []) => scratch.pool.query(sql, params);
    const type = await q(`INSERT INTO device_type (name) VALUES ('Switch E2E') RETURNING id`);
    const typeId = type.rows[0].id as string;
    await q(
      `INSERT INTO device (code, name, device_type_id, note) VALUES
        ('SW-E2E-LO', 'Switch', $1, $2),
        ('SW-E2E-OK', 'Switch', $1, 'Model WS-C2960X-48FPD-L, serial FOC2010X1AB'),
        ('SW-E2E-KEY', 'Switch', $1, 'Key VK7JG-NPHTM-C97JM-9MPGT-3V66T')`,
      [typeId, `mk wifi ${SECRET}`],
    );
    await q(`INSERT INTO site (code, name, address) VALUES ('E2E-S', 'Site', $1)`, [
      `Tầng 3, wifi ${SECRET}`,
    ]);
    // Ghi chú két đi theo luật két: "Matkhau2026" (3 nhóm, không ký tự đặc biệt) vẫn bị bắt.
    await q(
      `INSERT INTO secret (owner_type, owner_id, kind, label, value_ct, value_iv, value_tag,
                           dek_wrapped, key_version, note, created_by)
       VALUES ('device', gen_random_uuid(), 'password', 'E2E admin', '\\x00', '\\x00', '\\x00',
               '\\x00', 1, 'mk cũ Matkhau2026', 'a@qa.test')`,
    );
    const device = await q(`SELECT id FROM device WHERE code = 'SW-E2E-OK'`);
    await q(
      `INSERT INTO device_history (device_id, action, actor, changes) VALUES ($1, 'update', 'a@qa.test', $2)`,
      [device.rows[0].id, JSON.stringify({ note: { before: null, after: `mk ${SECRET}` } })],
    );
    // Lý do khoá / vô hiệu tài khoản đi thẳng vào nhật ký, không qua bảng lịch sử nào.
    await q(
      `INSERT INTO audit_log (actor, action, object_type, object_id, detail)
       VALUES ('sa@qa.test', 'account.locked', 'account', 'E2E-ACC-1', $1),
              ('sa@qa.test', 'account.locked', 'account', 'E2E-ACC-2', $2)`,
      [
        JSON.stringify({ reason: `lộ mk ${SECRET}`, meta: { tags: ['ok', 'Xk9#mP2vLq'] } }),
        JSON.stringify({ reason: 'Nghỉ việc từ 01/10/2026' }),
      ],
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('mọi bảng/cột khai quét đều có thật trên schema sau migration', async () => {
    for (const scan of COLUMN_SCANS) {
      for (const column of scan.columns) {
        const r = await scratch.pool.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
          [scan.table, column],
        );
        expect(`${scan.table}.${column}:${r.rowCount}`).toBe(`${scan.table}.${column}:1`);
      }
    }
  });

  it('báo đúng hồ sơ (mã, cột), bỏ qua chữ thường, ghi chú két theo luật két', async () => {
    const found = await scanSecretText(scratch.pool);
    const keys = found.map((f) => `${f.table}|${f.ref}|${f.field}`).sort();
    expect(keys).toEqual([
      'device|SW-E2E-KEY|note',
      'device|SW-E2E-LO|note',
      'secret|E2E admin|note',
      'site|E2E-S|address',
    ]);
  });

  it('--lich-su: thêm cả bảng lịch sử, chỉ ra đường dẫn trong JSON', async () => {
    const found = await scanSecretText(scratch.pool, { history: true });
    expect(found).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'device_history', field: 'changes.note.after' }),
      ]),
    );
  });

  it('--lich-su: quét cả audit_log.detail, báo hành động · mã đối tượng · đường dẫn JSON', async () => {
    const found = await scanSecretText(scratch.pool, { history: true });
    const audit = found
      .filter((f) => f.table === 'audit_log')
      .map((f) => `${f.ref}|${f.field}`)
      .sort();
    expect(audit).toEqual([
      'account.locked account:E2E-ACC-1|detail.meta.tags[1]',
      'account.locked account:E2E-ACC-1|detail.reason',
    ]);
  });

  it('audit_log đọc theo lô: lô 1 dòng vẫn ra đúng chừng ấy phát hiện', async () => {
    const all = await scanSecretText(scratch.pool, { history: true });
    const paged = await scanSecretText(scratch.pool, { history: true, auditBatch: 1 });
    expect(paged).toEqual(all);
  });

  it('không có --lich-su thì không đụng audit_log', async () => {
    const found = await scanSecretText(scratch.pool);
    expect(found.filter((f) => f.table === 'audit_log')).toEqual([]);
  });

  it('báo cáo KHÔNG chứa nội dung ô', async () => {
    const lines = formatFindings(await scanSecretText(scratch.pool, { history: true })).join('\n');
    expect(lines).not.toContain(SECRET);
    expect(lines).not.toContain('VK7JG');
    expect(lines).not.toContain('Matkhau2026');
    expect(lines).not.toContain('Xk9#mP2vLq');
    expect(lines).toContain('SW-E2E-LO');
  });
});
