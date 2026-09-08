import { execFileSync } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Chạy eslint THẬT trên một file mồi — hạ tầng dùng chung cho những bài kiểm CHÍNH CÁI CỔNG.
 *
 * ===== VÌ SAO CÓ LOẠI BÀI KIỂM NÀY =====
 *
 * Repo này đã hai lần dựng một hàng rào lint khớp ĐÚNG SỐ KHÔNG chuỗi mà không ai biết: luật
 * AD-2 viết bằng glob sai cú pháp (chết âm thầm 9 epic, `docs/CODE-REVIEW-2026-08-28.md` M1),
 * và luật cấm `window.confirm` của oxlint (probe cho exit 0, rà soát 07/09 #8). Cả hai đều
 * "có trong config" và đều vô hiệu. Một luật lint chết trông y hệt một luật không có gì để bắt.
 *
 * ===== HAI CÁI BẪY ĐÃ DÍNH, ĐỪNG DÍNH LẠI =====
 *
 * 1. `process.execPath` + đường dẫn bin, KHÔNG dùng `npx`: trong tiến trình con của jest `npx`
 *    có thể ENOENT, và khi đó `err.stdout` là `undefined` → output rỗng → bài kiểm kết luận
 *    "không có lỗi nào" và cho kết quả GIẢ. Đã dính một lần ở `web/src/lint-rules.test.ts`.
 * 2. File mồi phải nằm trong `src/` thật, đúng thư mục module cần kiểm — `files:` của config
 *    khớp theo đường dẫn, đặt sai chỗ là kiểm nhầm khối luật.
 *
 * Đặt ở `api/test/` (đã loại khỏi `tsconfig.build.json`) chứ không chép vào từng file spec:
 * hai bản sao của cùng một cơ chế sẽ trôi lệch, và bản trôi lệch là bản cho kết quả giả.
 */

const API_ROOT = join(__dirname, '..');
const ESLINT_BIN = join(API_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');

/** Trả về output của eslint (rỗng = sạch). NÉM khi không chạy được — không coi là "sạch". */
export function lint(relPath: string): string {
  try {
    execFileSync(
      process.execPath,
      [ESLINT_BIN, '--no-warn-ignored', '--format', 'stylish', relPath],
      { cwd: API_ROOT, encoding: 'utf8', stdio: 'pipe' },
    );
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

/**
 * Cấu hình eslint ĐÃ RESOLVE cho một đường dẫn (`eslint --print-config`).
 *
 * Dùng khi cần kiểm một NGOẠI LỆ khai theo đường dẫn file thật: file mồi đặt cạnh nó không
 * trả lời được câu hỏi, vì ngoại lệ chỉ áp cho đúng đường dẫn đó. Cách còn lại là tạm ghi đè
 * chính file nguồn — không đáng, một lần Ctrl-C giữa chừng là mất file thật.
 */
export function printConfig(relPath: string): {
  rules: Record<string, unknown[]>;
} {
  const out = execFileSync(process.execPath, [ESLINT_BIN, '--print-config', relPath], {
    cwd: API_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return JSON.parse(out) as { rules: Record<string, unknown[]> };
}

/** Ghi file mồi, chạy `run()`, rồi xóa — kể cả khi assertion ném. */
export function withProbe(relPath: string, source: string, run: () => void): void {
  const abs = join(API_ROOT, relPath);
  writeFileSync(abs, source, 'utf8');
  try {
    run();
  } finally {
    unlinkSync(abs);
  }
}
