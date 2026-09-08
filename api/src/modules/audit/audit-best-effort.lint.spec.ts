import { execFileSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Bài kiểm cho CHÍNH CÁI CỔNG, không phải cho code.
 *
 * ===== VÌ SAO PHẢI CÓ =====
 *
 * Repo này đã hai lần dựng một hàng rào lint khớp ĐÚNG SỐ KHÔNG chuỗi mà không ai biết: luật
 * AD-2 viết bằng glob sai cú pháp (chết âm thầm 9 epic, `docs/CODE-REVIEW-2026-08-28.md` M1),
 * và luật cấm `window.confirm` của oxlint (probe cho exit 0, rà soát 07/09 #8). Cả hai đều
 * "có trong config" và đều vô hiệu.
 *
 * Luật `appendBestEffort` gác đúng thứ đã hỏng ở finding #4: một hàm nuốt lỗi ghi audit mà
 * mọi nơi với tới được. Nếu selector của nó gõ sai một ký tự thì hàng rào biến mất, code vẫn
 * xanh, và lần sau ai đó gọi `appendBestEffort` trong service là NFR-03 thủng lại — im lặng.
 *
 * ===== CÁCH KIỂM =====
 *
 * Chạy eslint THẬT trên một file mồi đặt trong `src/` (phải nằm trong `src/` thì mới trúng
 * `files: ['src/**\/*.ts']` của config). Không mock, không đọc config bằng mắt.
 *
 * `process.execPath` + đường dẫn bin, KHÔNG dùng `npx`: trong tiến trình con của jest `npx`
 * có thể ENOENT, và khi đó `err.stdout` là `undefined` → output rỗng → bài kiểm kết luận
 * "không có lỗi nào" và cho kết quả GIẢ. Bẫy này đã dính một lần ở `web/src/lint-rules.test.ts`.
 */

const API_ROOT = join(__dirname, '..', '..', '..');
const ESLINT_BIN = join(API_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');

function lint(relPath: string): string {
  try {
    execFileSync(process.execPath, [ESLINT_BIN, '--no-warn-ignored', '--format', 'stylish', relPath], {
      cwd: API_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return '';
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: string };
    if (err.code === 'ENOENT') {
      throw new Error(
        `Không chạy được eslint (ENOENT) tại ${ESLINT_BIN}. Đã cài node_modules chưa? ` +
          `KHÔNG được coi đây là "không có lỗi".`,
      );
    }
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (out.trim() === '') {
      throw new Error('eslint hỏng nhưng không in gì — không kết luận được, xem là ĐỎ.');
    }
    return out;
  }
}

function withProbe(relPath: string, source: string, run: () => void): void {
  const abs = join(API_ROOT, relPath);
  writeFileSync(abs, source, 'utf8');
  try {
    run();
  } finally {
    unlinkSync(abs);
  }
}

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
   * Ngoại lệ chỉ mở cho ĐÚNG file interceptor, không mở cho cả `src/modules/audit/`. Rà soát
   * 07/09 (#9) đã chỉ ra một ngoại lệ quá rộng ở `.dependency-cruiser.cjs` biến hàng rào
   * thành cửa mở; đừng lặp lại kiểu đó ở đây.
   */
  it('file khác trong chính thư mục audit KHÔNG được miễn', () => {
    withProbe('src/modules/audit/probe-best-effort.ts', CALLS_BEST_EFFORT.replace('../audit/', './'), () => {
      expect(lint('src/modules/audit/probe-best-effort.ts')).toContain('appendBestEffort');
    });
  });
});
