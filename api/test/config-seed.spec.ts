import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migration-runner';
import { CONFIG_KEYS } from '../src/modules/config-sys/system-config.keys';
import { createScratchDb, migrationsDir, type ScratchDb } from './db';

/**
 * MỌI KHÓA CẤU HÌNH PHẢI ĐƯỢC SEED — và giá trị seed phải khớp bản dự phòng ở web.
 *
 * ===== VÌ SAO BÀI NÀY TỒN TẠI =====
 *
 * AD-11 bắt tham số nghiệp vụ ra khỏi code, và `CONFIG_KEYS` khai chúng ở một chỗ. Nhưng khai
 * ở TypeScript không tạo ra hàng nào trong DB: phải có một migration `INSERT` tương ứng. Hai
 * danh sách đó chưa từng có gì buộc chúng khớp nhau.
 *
 * Thiếu hàng thì `read()` lùi về `spec.fallback` và mọi thứ vẫn CHẠY ĐÚNG — nên lỗi này vô
 * hình cho tới ngày ai đó mở màn Tham số ra sửa: khóa không có hàng thì câu UPDATE của
 * `setWithin` trúng 0 dòng, người dùng bấm Lưu, không có lỗi nào, và giá trị không đổi. Đúng
 * loại hỏng im lặng mà chỉ một bài kiểm chạy trên DB TRẮNG mới hỏi được.
 *
 * ===== VÀ HAI CON SỐ CỦA WEB =====
 *
 * `web/src/lib/expiry.ts` giữ `DEFAULT_EXPIRY_THRESHOLDS` để vẽ đúng ngay trong lúc câu hỏi
 * ngưỡng chưa về. Đó là bản DỰ PHÒNG hợp lệ, nhưng nó lệch được — và trước 09/09 nó đúng là
 * bản sao độc lập của luật, với hai chú thích tự nhận là "khớp nhau" bằng lời hứa. Đây là cơ
 * chế thay cho lời hứa đó.
 */

const TEST_TIMEOUT = 120_000;

describe('system_config seed', () => {
  let scratch: ScratchDb;
  let seeded: Map<string, unknown>;

  beforeAll(async () => {
    scratch = await createScratchDb('ims_cfg');
    await runMigrations(scratch.pool, migrationsDir(), { log: () => undefined });
    const { rows } = await scratch.pool.query<{ key: string; value: unknown }>(
      'SELECT key, value FROM system_config',
    );
    seeded = new Map(rows.map((r) => [r.key, r.value]));
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await scratch?.drop();
  }, TEST_TIMEOUT);

  it('mọi khóa trong CONFIG_KEYS đều có hàng thật trong DB trắng', () => {
    const missing = Object.entries(CONFIG_KEYS)
      .filter(([, spec]) => !seeded.has(spec.key))
      .map(([name, spec]) => `${name} (${spec.key})`);
    expect(missing).toEqual([]);
  });

  it('giá trị seed khớp `fallback` khai trong CONFIG_KEYS', () => {
    /*
     * Lệch nhau thì hệ thống chạy bằng giá trị DB, còn mọi chú thích và mọi bài kiểm đơn vị
     * lại đọc `fallback` — hai sự thật cho cùng một tham số.
     */
    const drift = Object.entries(CONFIG_KEYS)
      .filter(([, spec]) => seeded.has(spec.key))
      .filter(([, spec]) => String(seeded.get(spec.key)) !== String(spec.fallback))
      .map(([name, spec]) => `${name}: DB=${String(seeded.get(spec.key))} ≠ code=${String(spec.fallback)}`);
    expect(drift).toEqual([]);
  });

  it('bản dự phòng của web khớp ngưỡng đã seed', async () => {
    const source = await readFile(
      join(__dirname, '..', '..', 'web', 'src', 'lib', 'expiry.ts'),
      'utf8',
    );
    const block = source.slice(source.indexOf('DEFAULT_EXPIRY_THRESHOLDS'));
    const read = (field: string): number => {
      const found = new RegExp(`${field}:\\s*(\\d+)`).exec(block);
      if (!found) throw new Error(`Không đọc được ${field} trong web/src/lib/expiry.ts`);
      return Number(found[1]);
    };

    expect(read('criticalDays')).toBe(Number(seeded.get('expiry.critical_days')));
    expect(read('warningDays')).toBe(Number(seeded.get('expiry.warning_days')));
  });

  it('trần giấy tờ dự phòng của web khớp giá trị đã seed (Q-18)', async () => {
    const source = await readFile(
      join(__dirname, '..', '..', 'web', 'src', 'ui', 'attachment-limits.ts'),
      'utf8',
    );
    const block = source.slice(source.indexOf('DEFAULT_ATTACHMENT_LIMITS: AttachmentLimits'));
    const read = (field: string): number => {
      const found = new RegExp(`${field}:\\s*(\\d+)`).exec(block);
      if (!found) throw new Error(`Không đọc được ${field} trong web/src/ui/attachment-limits.ts`);
      return Number(found[1]);
    };

    expect(read('maxSizeMb')).toBe(Number(seeded.get('file.max_size_mb')));
    expect(read('maxFiles')).toBe(Number(seeded.get('file.max_files_per_batch')));
  });
});
