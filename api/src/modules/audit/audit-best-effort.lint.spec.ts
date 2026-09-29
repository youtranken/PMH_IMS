import { lint, withProbe } from '../../../test/lint-probe';

/**
 * Bài kiểm cho CHÍNH CÁI CỔNG, không phải cho code.
 *
 * Luật `appendBestEffort` gác một hàm nuốt lỗi ghi audit khỏi tay mọi nơi. Nếu selector của
 * nó gõ sai một ký tự thì hàng rào biến mất, code vẫn
 * xanh, và lần sau ai đó gọi `appendBestEffort` trong service là NFR-03 thủng lại — im lặng.
 *
 * Cơ chế chạy eslint thật (và hai cái bẫy của nó) nằm ở `api/test/lint-probe.ts` — dùng chung
 * với bài kiểm cổng AD-2, để hai bên không trôi lệch nhau.
 */

const CALLS_BEST_EFFORT = `import { AuditWriterService } from '../audit/audit-writer.service';
export async function probe(audit: AuditWriterService): Promise<void> {
  await audit.appendBestEffort({ actor: 'x', action: 'y' });
}
`;

describe('cổng NFR-03: appendBestEffort chỉ dành cho interceptor', () => {
  it('service nghiệp vụ gọi appendBestEffort → eslint CHẶN', () => {
    withProbe('src/modules/devices/probe-best-effort.ts', CALLS_BEST_EFFORT, () => {
      const out = lint('src/modules/devices/probe-best-effort.ts');
      expect(out).toContain('no-restricted-syntax');
      expect(out).toContain('appendBestEffort');
    });
  });

  /**
   * Vế đối chứng — nếu thiếu nó thì một luật "cấm tất" cũng cho bài trên xanh, và cổng sẽ
   * chặn cả nơi được phép. Ngoại lệ phải HẸP: đúng interceptor, không phải cả thư mục audit.
   */
  it('appendWithin thì KHÔNG bị chặn — cổng không được cấm nhầm đường đúng', () => {
    const source = `import { AuditWriterService } from '../audit/audit-writer.service';
import type { Database } from '../../database/database.module';
export async function probe(audit: AuditWriterService, tx: Database): Promise<void> {
  await audit.appendWithin(tx, { actor: 'x', action: 'y' });
}
`;
    withProbe('src/modules/devices/probe-append-within.ts', source, () => {
      expect(lint('src/modules/devices/probe-append-within.ts')).toBe('');
    });
  });

  it('interceptor được miễn — nó là nơi dùng thật', () => {
    expect(lint('src/modules/audit/audit.interceptor.ts')).toBe('');
  });

  /**
   * Ngoại lệ chỉ mở cho ĐÚNG file interceptor, không mở cho cả `src/modules/audit/`: một
   * ngoại lệ quá rộng biến hàng rào thành cửa mở.
   */
  it('file khác trong chính thư mục audit KHÔNG được miễn', () => {
    withProbe('src/modules/audit/probe-best-effort.ts', CALLS_BEST_EFFORT.replace('../audit/', './'), () => {
      expect(lint('src/modules/audit/probe-best-effort.ts')).toContain('appendBestEffort');
    });
  });
});
