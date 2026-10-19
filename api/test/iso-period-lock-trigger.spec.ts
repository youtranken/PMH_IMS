import { runMigrations } from '../src/database/migration-runner';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * Kỳ phiếu ISO đã sang Chờ duyệt / Đã chốt thì ô của kỳ đó là bằng chứng: DB phải từ chối ghi,
 * không chỉ service. Service kiểm qua `assertOpenWithin`, nhưng một lỗi code về sau (đường ghi mới
 * quên gọi nó) sẽ sửa được hồ sơ đã ký mà không ai chặn. Ghi thẳng bằng SQL để chứng minh đúng
 * hàng rào ở tầng DB.
 */

const TEST_TIMEOUT = 120_000;

describe('DB chặn ghi vào ô của kỳ ISO đã khoá', () => {
  let scratch: ScratchDb;
  let lineId: string;
  let divisionId: string;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_iso_lock_trigger');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const job = await scratch.pool.query<{ id: string }>(
      `INSERT INTO iso_backup_job (no, name, tracked_from, created_by) VALUES (1, 'E2E Lock', '2026-01-01', 't') RETURNING id`,
    );
    const line = await scratch.pool.query<{ id: string }>(
      `INSERT INTO iso_backup_line (job_id, sort_order) VALUES ($1, 1) RETURNING id`,
      [job.rows[0].id],
    );
    lineId = line.rows[0].id;
    divisionId = (await scratch.pool.query<{ id: string }>(`SELECT id FROM iso_division LIMIT 1`)).rows[0].id;
    // Ô có sẵn trong kỳ 10/2026 TRƯỚC khi khoá; sau đó cả hai phiếu của tháng đó sang trạng thái khoá.
    await scratch.pool.query(`INSERT INTO iso_backup_tick (line_id, day, result, updated_by) VALUES ($1, '2026-10-05', 'ok', 't')`, [lineId]);
    await scratch.pool.query(`INSERT INTO iso_av_clear_day (day, marked_by) VALUES ('2026-10-05', 't')`);
    await scratch.pool.query(
      `INSERT INTO iso_av_issue (reported_on, division_id, computer_name, description, created_by) VALUES ('2026-10-06', $1, 'E2E-PC', 'virus', 't')`,
      [divisionId],
    );
    await scratch.pool.query(
      `INSERT INTO iso_period (form_type, year, month, state) VALUES ('0203', 2026, 10, 'locked'), ('0208', 2026, 10, 'pending')`,
    );
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  const refused = /đã khoá/;

  it.each([
    ['thêm ô 0203', `INSERT INTO iso_backup_tick (line_id, day, result, updated_by) VALUES ($1, '2026-10-06', 'fail', 't')`],
    ['sửa ô 0203', `UPDATE iso_backup_tick SET result = 'fail' WHERE line_id = $1 AND day = '2026-10-05'`],
    ['xoá ô 0203', `DELETE FROM iso_backup_tick WHERE line_id = $1 AND day = '2026-10-05'`],
    ['dời ô 0203 từ kỳ mở vào kỳ khoá', `UPDATE iso_backup_tick SET day = '2026-10-20' WHERE line_id = $1 AND day = '2026-11-02'`],
  ])('0203 · %s bị từ chối', async (_label, statement) => {
    await scratch.pool.query(`INSERT INTO iso_backup_tick (line_id, day, result, updated_by) VALUES ($1, '2026-11-02', 'ok', 't') ON CONFLICT DO NOTHING`, [lineId]);
    await expect(scratch.pool.query(statement, [lineId])).rejects.toThrow(refused);
  }, TEST_TIMEOUT);

  it.each([
    ['bỏ "không có issue"', `DELETE FROM iso_av_clear_day WHERE day = '2026-10-05'`],
    ['thêm dòng issue', `INSERT INTO iso_av_issue (reported_on, division_id, computer_name, description, created_by) VALUES ('2026-10-09', '${'$'}1', 'E2E-PC2', 'x', 't')`],
    ['sửa dòng issue', `UPDATE iso_av_issue SET description = 'đổi' WHERE reported_on = '2026-10-06'`],
    ['xoá dòng issue', `DELETE FROM iso_av_issue WHERE reported_on = '2026-10-06'`],
  ])('0208 (Chờ duyệt) · %s bị từ chối', async (_label, statement) => {
    const sqlText = statement.replace("'$1'", `'${divisionId}'`);
    await expect(scratch.pool.query(sqlText)).rejects.toThrow(refused);
  }, TEST_TIMEOUT);

  it('đường thường: kỳ còn Đang ghi thì ghi, sửa, xoá bình thường', async () => {
    await scratch.pool.query(`INSERT INTO iso_backup_tick (line_id, day, result, updated_by) VALUES ($1, '2026-11-03', 'ok', 't')`, [lineId]);
    await scratch.pool.query(`UPDATE iso_backup_tick SET result = 'fail' WHERE line_id = $1 AND day = '2026-11-03'`, [lineId]);
    await scratch.pool.query(`DELETE FROM iso_backup_tick WHERE line_id = $1 AND day = '2026-11-03'`, [lineId]);
    await scratch.pool.query(`INSERT INTO iso_av_clear_day (day, marked_by) VALUES ('2026-11-03', 't')`);
  }, TEST_TIMEOUT);

  it('mở lại kỳ (về Đang ghi) thì ghi lại được', async () => {
    await scratch.pool.query(`UPDATE iso_period SET state = 'open' WHERE form_type = '0203' AND year = 2026 AND month = 10`);
    await scratch.pool.query(`UPDATE iso_backup_tick SET result = 'fail' WHERE line_id = $1 AND day = '2026-10-05'`, [lineId]);
    await scratch.pool.query(`UPDATE iso_period SET state = 'locked' WHERE form_type = '0203' AND year = 2026 AND month = 10`);
  }, TEST_TIMEOUT);
});
