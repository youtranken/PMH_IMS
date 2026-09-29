import { lint, withProbe } from '../../test/lint-probe';

/**
 * Bài kiểm cho CHÍNH CÁI CỔNG, không phải cho code.
 *
 * ===== VÌ SAO VÁ TỪNG CHỖ LÀ CHƯA ĐỦ =====
 *
 * `common/log-redact.ts` có để một `DrizzleQueryError` không in nguyên `params:` — hash
 * Argon2, ciphertext TOTP, email, họ tên — ra `docker logs`. Có hàm rồi mà vẫn từng chỉ ĐÚNG
 * MỘT chỗ gọi nó, còn 13 chỗ khác viết `(error as Error).message`.
 *
 * Đó không phải vì ai lười. Nó là hình dạng mặc định của việc ghi log, nên chỗ thứ 14 sẽ lại
 * viết đúng như vậy — và không có gì đỏ. Vá 13 chỗ chỉ mua được thời gian; hàng rào phải nằm
 * ở cổng.
 *
 * Và chính cái cổng cũng phải có bài kiểm: repo này đã hai lần dựng một luật lint khớp ĐÚNG
 * SỐ KHÔNG chuỗi mà không ai biết (xem `api/test/lint-probe.ts`). Một luật chết trông y hệt
 * một luật không có gì để bắt.
 *
 * Bằng chứng luật này KHÔNG chết: lúc vừa gắn vào, nó bắt ngay một chỗ thứ 14 mà lượt đọc tay
 * đã bỏ sót (`global-exception.filter.ts`, hoá ra là ngoại lệ chính đáng và đã được ghi rõ tại
 * chỗ).
 */

const LOGS_RAW_MESSAGE = `import { Logger } from '@nestjs/common';
const logger = new Logger('probe');
export function probe(error: unknown): void {
  logger.error(\`hỏng: \${(error as Error).message}\`);
}
`;

describe('cổng NFR-04: không ghi `.message` của lỗi ra log', () => {
  it('ghi thẳng `.message` trong dòng log → eslint CHẶN', () => {
    withProbe('src/modules/devices/probe-raw-message.ts', LOGS_RAW_MESSAGE, () => {
      const out = lint('src/modules/devices/probe-raw-message.ts');
      expect(out).toContain('no-restricted-syntax');
      expect(out).toContain('NFR-04');
    });
  });

  /**
   * VẾ ĐỐI CHỨNG. Không có nó thì một luật "cấm mọi `.message`" cũng xanh bài trên — và nó sẽ
   * chặn cả đường ĐÚNG, tức là luật sẽ bị tắt trong tuần.
   */
  it('đi qua `redactMessage` thì KHÔNG bị chặn', () => {
    const source = `import { Logger } from '@nestjs/common';
import { redactMessage } from '../../common/log-redact';
const logger = new Logger('probe');
export function probe(error: unknown): void {
  logger.error(\`hỏng: \${redactMessage(error)}\`);
}
`;
    withProbe('src/modules/devices/probe-redacted.ts', source, () => {
      expect(lint('src/modules/devices/probe-redacted.ts')).toBe('');
    });
  });

  /**
   * `.message` NGOÀI dòng log không bị đụng tới: đọc `error.message` để so chuỗi hay để ném
   * tiếp là việc bình thường và rất nhiều chỗ đang làm. Luật chỉ canh chỗ chữ ĐI RA log.
   */
  it('đọc `.message` ngoài dòng log vẫn được — luật không cấm nhầm', () => {
    const source = `export function probe(error: unknown): boolean {
  const e = error as Error;
  return e.message.includes('duplicate key');
}
`;
    withProbe('src/modules/devices/probe-message-read.ts', source, () => {
      expect(lint('src/modules/devices/probe-message-read.ts')).toBe('');
    });
  });

  /** Cả `warn` lẫn `debug` đều là đường ra log — không được chỉ canh mỗi `error`. */
  it('luật canh cả `warn`, không chỉ `error`', () => {
    const source = LOGS_RAW_MESSAGE.replace('logger.error', 'logger.warn');
    withProbe('src/modules/devices/probe-raw-warn.ts', source, () => {
      expect(lint('src/modules/devices/probe-raw-warn.ts')).toContain('NFR-04');
    });
  });
});
