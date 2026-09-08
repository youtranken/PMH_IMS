import { runWithRequestContext } from '../../common/request-context';
import { AuditWriterService } from './audit-writer.service';
import type { Database } from '../../database/database.module';

/**
 * Hai thứ bài này giữ, cả hai đều là finding mức Chặn của rà soát 07/09:
 *
 *   #3 — `audit_log.ip` NULL trên 100% số dòng. Cột có trong migration `0004` từ đầu, nhưng
 *        không có trong bảng drizzle, nên `toRow()` không map và không ai ghi. Bảng chỉ-thêm:
 *        mỗi ngày trôi là thêm một ngày "từ đâu" vĩnh viễn rỗng (NFR-03).
 *
 *   #4 — audit của việc MỞ KÉT đi qua một hàm nuốt lỗi. `append()` cũ bọc try/catch chỉ log
 *        rồi đi tiếp, và với `writtenByService: true` thì nó là writer DUY NHẤT của đường đó.
 *        INSERT hỏng → plaintext vẫn ra, dấu vết chỉ còn một dòng log container.
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
   * Nơi gọi khai `ip` tường minh thì lời khai đó THẮNG ngữ cảnh. Cần cho các dòng nói về một
   * IP khác với IP của request đang chạy (ví dụ SA đá một phiên: dòng audit nói về phiên bị
   * đá, còn IP của SA là IP hiện tại — hai thứ khác nhau, phải phân biệt được).
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
