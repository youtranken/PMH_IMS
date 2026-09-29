import { runWithRequestContext } from '../../common/request-context';
import { AuditWriterService } from './audit-writer.service';
import type { Database } from '../../database/database.module';

/**
 * Hai thứ bài này giữ, cả hai đều mức Chặn:
 *
 *   · `audit_log.ip` phải được ghi. Cột có trong migration `0004`, nhưng thiếu ở bảng drizzle
 *     thì `toRow()` không map và không ai ghi. Bảng chỉ-thêm: mỗi ngày trôi là thêm một ngày
 *     "từ đâu" vĩnh viễn rỗng (NFR-03).
 *
 *   · audit của việc MỞ KÉT không được đi qua một hàm nuốt lỗi. Với `writtenByService: true`
 *     thì `append()` là writer DUY NHẤT của đường đó; nuốt lỗi thì INSERT hỏng → plaintext
 *     vẫn ra, dấu vết chỉ còn một dòng log container.
 */

type Captured = { table: unknown; values: Record<string, unknown> };

function dbSpy(options: { fail?: boolean } = {}) {
  const rows: Captured[] = [];
  const db = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (options.fail) return Promise.reject(new Error('INSERT hỏng'));
        rows.push({ table, values });
        return Promise.resolve();
      },
    }),
  } as unknown as Database;
  return { db, rows };
}

const ENTRY = {
  actor: 'it01@pmh.com.vn',
  action: 'vault.secret.revealed',
  objectType: 'secret',
  objectId: 'secret-1',
} as const;

describe('AuditWriterService — cột ip (NFR-03, finding #3)', () => {
  it('trong một request → lấy IP của request đó mà nơi gọi không phải truyền gì', async () => {
    const { db, rows } = dbSpy();
    const writer = new AuditWriterService(db);
    await runWithRequestContext({ ip: '192.168.1.77' }, () => writer.append({ ...ENTRY }));
    expect(rows[0].values.ip).toBe('192.168.1.77');
  });

  it('job nền (không có request) → ip NULL, không ném', async () => {
    const { db, rows } = dbSpy();
    const writer = new AuditWriterService(db);
    await writer.append({ ...ENTRY });
    expect(rows[0].values.ip).toBeNull();
  });

  /**
   * Nơi gọi khai `ip` tường minh thì lời khai đó THẮNG ngữ cảnh.
   *
   * Nói thẳng: HIỆN KHÔNG CHỖ GỌI NÀO dùng cửa này. Nó tồn tại vì `toRow()` buộc phải có một
   * luật cho `entry.ip`, và "mặc định lấy từ ngữ cảnh, cho phép khai đè" là hình dạng không
   * phải viết lại khi có nhu cầu thật (ví dụ hình dung được: một dòng ghi trong request nhưng
   * KHÔNG được mang IP của request đó — khai `ip: null`).
   *
   * Hai bài này giữ phần tinh tế và dễ vỡ nhất của luật đó: `undefined` (không khai) khác hẳn
   * `null` (khai là không có). Viết `entry.ip ?? currentRequestIp()` là gộp hai thứ làm một và
   * `ip: null` sẽ âm thầm rơi ngược về ngữ cảnh.
   */
  it('ip khai tường minh thắng ngữ cảnh', async () => {
    const { db, rows } = dbSpy();
    const writer = new AuditWriterService(db);
    await runWithRequestContext({ ip: '192.168.1.77' }, () =>
      writer.append({ ...ENTRY, ip: '10.9.9.9' }),
    );
    expect(rows[0].values.ip).toBe('10.9.9.9');
  });

  it('khai ip: null tường minh → NULL, không rơi ngược về ngữ cảnh', async () => {
    const { db, rows } = dbSpy();
    const writer = new AuditWriterService(db);
    await runWithRequestContext({ ip: '192.168.1.77' }, () =>
      writer.append({ ...ENTRY, ip: null }),
    );
    expect(rows[0].values.ip).toBeNull();
  });

  it('appendWithin cũng điền ip — audit trong transaction không được thiếu "từ đâu"', async () => {
    const { db, rows } = dbSpy();
    const writer = new AuditWriterService(db);
    await runWithRequestContext({ ip: '192.168.1.77' }, () =>
      writer.appendWithin(db, { ...ENTRY }),
    );
    expect(rows[0].values.ip).toBe('192.168.1.77');
  });
});

describe('AuditWriterService — ai được nuốt lỗi (finding #4)', () => {
  it('append() NÉM khi INSERT hỏng — mở két mà mất vết thì phải hỏng cả thao tác', async () => {
    const { db } = dbSpy({ fail: true });
    const writer = new AuditWriterService(db);
    await expect(writer.append({ ...ENTRY })).rejects.toThrow('INSERT hỏng');
  });

  it('appendWithin() NÉM khi INSERT hỏng — để transaction nghiệp vụ rollback theo', async () => {
    const { db } = dbSpy({ fail: true });
    const writer = new AuditWriterService(db);
    await expect(writer.appendWithin(db, { ...ENTRY })).rejects.toThrow('INSERT hỏng');
  });

  /**
   * `appendBestEffort` là NGOẠI LỆ DUY NHẤT, và nó tồn tại cho đúng một nơi: interceptor
   * `@Audited`, chạy SAU khi mutation đã commit. Ở đó ném lỗi biến một thao tác ĐÃ THÀNH CÔNG
   * thành 500, người dùng bấm lại và tạo bản ghi trùng — hỏng dữ liệu để cứu nhật ký.
   *
   * Mọi nơi khác phải dùng `append`/`appendWithin`. Nếu bài này bắt đầu được dùng làm cớ để
   * gọi `appendBestEffort` ở chỗ mới, đọc lại chú thích trong `audit-writer.service.ts`.
   */
  it('appendBestEffort() nuốt lỗi và log — chỉ dành cho interceptor', async () => {
    const { db } = dbSpy({ fail: true });
    const writer = new AuditWriterService(db);
    await expect(writer.appendBestEffort({ ...ENTRY })).resolves.toBeUndefined();
  });
});
