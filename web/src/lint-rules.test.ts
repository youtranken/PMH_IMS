import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Bài kiểm CANH CHÍNH CÁI CỔNG, không kiểm sản phẩm.
 *
 * VÌ SAO NÓ TỒN TẠI. Rà soát 07/09 phát hiện cổng lint cũ của web (oxlint) cấm
 * `confirm`/`alert` bằng `no-restricted-globals` — rule đó chỉ khớp ĐỊNH DANH TRẦN, không khớp
 * `window.confirm(...)`. Tức luật khớp đúng số không chuỗi, trong khi `window.confirm` chính là
 * cách `CLAUDE.md` viết ra khi cấm. Repo vẫn sạch, nên cổng đang bảo vệ một trạng thái sạch mà
 * nó KHÔNG canh được — và không có gì đỏ để ai biết.
 *
 * Đây là lần thứ hai lớp lỗi này xảy ra: hồi 28/08 luật eslint AD-2 bên api cũng khớp 0 chuỗi
 * suốt 9 epic. Lần đó bài học rút ra là "phải có bài test chốt rằng luật BẮT được thứ nó phải
 * bắt" (`api/src/ad2-boundary.spec.ts`). Bài này là bản tương ứng cho phía web.
 *
 * KHÁC MỘT CHỖ QUAN TRỌNG so với `ad2-boundary.spec.ts`: bài kia kiểm biểu thức regex, còn bài
 * này chạy THẲNG `eslint` trên file thật. Kiểm regex thì vẫn còn cửa "regex đúng nhưng không
 * được cắm vào rule nào" — đúng lỗ mà rà soát 07/09 chỉ ra ở phía api.
 *
 * (07/09: web đã chuyển từ oxlint sang ESLint để cả repo dùng MỘT phương ngữ luật — chính bài
 * này là thứ phát hiện oxlint không có `no-restricted-syntax`. Xem `eslint.config.mjs`.)
 */

const WEB_ROOT = join(__dirname, '..');

/**
 * Chạy eslint trên MỘT file trong `src/` (để cấu hình của repo áp vào), trả stdout + mã thoát.
 *
 * `under` quyết định luật nào áp: `eslint.config.mjs` phân luật theo `files:` (`src/features/**`
 * vs `src/ui|lib|shell/**`), nên luật cấm import chéo feature CHỈ áp cho `src/features/**`.
 * Đặt file probe sai chỗ là bài kiểm xanh/đỏ vì lý do chẳng liên quan — tôi đã dính đúng lỗi
 * đó lúc viết bài này.
 */
function lintSnippet(code: string, under = 'src'): { output: string; failed: boolean } {
  // Đặt trong `src/` chứ không phải thư mục tạm hệ thống: cấu hình áp theo đường dẫn tương đối
  // so với gốc `web/`, nên file nằm ngoài `src/` không nhận đúng luật.
  const dir = mkdtempSync(join(WEB_ROOT, under, '__lint-probe__'));
  const file = join(dir, 'probe.tsx');
  try {
    writeFileSync(file, code, 'utf8');
    try {
      /*
       * Gọi THẲNG entry JS của eslint bằng chính Node đang chạy test — không qua `npx`, không
       * qua shell.
       *
       * `npx`/`npx.cmd` không phân giải được trong tiến trình con của vitest trên Windows:
       * `execFileSync` ném ENOENT, `err.stdout` là `undefined`, và bài kiểm thấy "output rỗng
       * + có ném" nên KẾT LUẬN SAI là luật đã bắt được. Tức bài canh cổng tự nó có một chế độ
       * xanh-giả. Dùng `process.execPath` thì không còn phụ thuộc PATH hay shell.
       *
       * `--no-warn-ignored`: giữ đầu ra sạch nếu về sau có ai thêm mẫu ignore trùng chỗ này.
       */
      const eslintBin = join(WEB_ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
      const output = execFileSync(
        process.execPath,
        [eslintBin, '--no-warn-ignored', '--format', 'stylish', file],
        { cwd: WEB_ROOT, encoding: 'utf8', stdio: 'pipe' },
      );
      return { output, failed: false };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; code?: string };
      // KHÔNG được lẫn "eslint báo lỗi lint" với "không chạy nổi eslint": cái sau cũng ném, và
      // nếu coi nó là "luật đã bắt" thì bài canh cổng biến thành bài luôn xanh. Ném tiếp cho to.
      if (err.code === 'ENOENT') {
        throw new Error(`Không chạy được eslint (ENOENT). Đã cài node_modules chưa?`);
      }
      return { output: `${err.stdout ?? ''}${err.stderr ?? ''}`, failed: true };
    }
  } finally {
    // `finally` chứ không phải cuối hàm: bài đỏ giữa chừng mà để lại file rác trong `src/` thì
    // lần chạy `npm run lint` sau đó đỏ vì rác, không phải vì sản phẩm.
    rmSync(dir, { recursive: true, force: true });
  }
}

/*
 * Mỗi bài spawn một tiến trình ESLint đầy đủ (~4-6 giây), nên timeout mặc định 5 giây của
 * vitest không đủ. Đây là cái giá của việc chạy CỔNG THẬT thay vì kiểm biểu thức regex —
 * và đó chính là điều làm bài này có giá trị, nên trả giá bằng timeout chứ không đổi cách kiểm.
 */
describe('web/eslint.config.mjs — cổng AD-15 phải THẬT SỰ bắt được', { timeout: 60_000 }, () => {
  it.each([
    ['window.confirm', `export const f = () => window.confirm('xoá?');`],
    ['window.alert', `export const f = () => window.alert('xong');`],
    ['window.prompt', `export const f = () => window.prompt('tên?');`],
    ['confirm trần', `export const f = () => confirm('xoá?');`],
    ['alert trần', `export const f = () => alert('xong');`],
    ['globalThis.confirm', `export const f = () => globalThis.confirm('xoá?');`],
  ])('BẮT được %s', (_ten, code) => {
    const { output, failed } = lintSnippet(code);
    expect(failed, `eslint phải báo lỗi. Đầu ra:\n${output}`).toBe(true);
    expect(output).toMatch(/AD-15/);
  });

  it('KHÔNG bắt nhầm code hợp lệ — hộp hỏi lại dùng chung của repo', () => {
    // Nếu bài này đỏ thì luật đang chặn cả đường đi ĐÚNG, và người ta sẽ tắt luật đi.
    const { output, failed } = lintSnippet(
      `import { useConfirm } from '@/ui/confirm-provider';\n` +
        `export function F() {\n` +
        `  const askConfirm = useConfirm();\n` +
        `  return () => void askConfirm({ title: 'Xoá?', body: 'Không hoàn tác được.' });\n` +
        `}\n`,
    );
    expect(failed, `eslint không được báo lỗi. Đầu ra:\n${output}`).toBe(false);
  });

  it('import chéo feature vẫn bị chặn (luật cũ còn sống)', () => {
    const { output, failed } = lintSnippet(
      `import { X } from '@/features/admin/user-form';\nexport const y = X;\n`,
      'src/features',
    );
    expect(failed, `Đầu ra:\n${output}`).toBe(true);
    expect(output).toMatch(/AD-15/);
  });

  it('tầng nền không được import ngược vào features (luật cũ còn sống)', () => {
    const { output, failed } = lintSnippet(
      `import { X } from '@/features/admin/user-form';\nexport const y = X;\n`,
      'src/ui',
    );
    expect(failed, `Đầu ra:\n${output}`).toBe(true);
    expect(output).toMatch(/AD-15/);
  });
  /*
   * ===== AD-16 — CANH CHÍNH CÁI CỔNG =====
   *
   * Luật chặn định danh tiếng Việt có dấu cắm ngày 20/09/2026. Không có bài này thì nó có
   * thể chết y như `no-restricted-globals` đã chết: selector viết đúng, cắm sai chỗ, khớp 0
   * chuỗi, và repo vẫn sạch nên không gì đỏ để ai biết.
   *
   * Hai vế, và vế PHỦ ĐỊNH quan trọng ngang vế khẳng định: một luật bắt nhầm cả đường đi
   * ĐÚNG (chuỗi i18n, chú thích) sẽ bị người ta tắt đi trong vòng một tuần.
   */
  it.each([
    ['biến có dấu', `export const bỏQuen = 1;`],
    ['hàm có dấu', `export function xóaHết() {}`],
    ['tham số có dấu', `export const f = (giá: number) => giá;`],
    ['thuộc tính có dấu', `export const o = { hỏng: 1 };`],
  ])('AD-16 BẮT được %s', (_ten, code) => {
    const { output, failed } = lintSnippet(code);
    expect(failed, `eslint phải báo lỗi. Đầu ra:
${output}`).toBe(true);
    expect(output).toMatch(/AD-16/);
  });

  it('AD-16 KHÔNG bắt nhầm chuỗi tiếng Việt, chú thích, hay khóa đã đặt trong nháy', () => {
    const { output, failed } = lintSnippet(
      `// Hộp thoại xác nhận — chú thích tiếng Việt là ĐÚNG luật.
` +
        `export const label = 'Xoá thiết bị?';
` +
        `export const key = 'devices.deleteTitle';
` +
        `export const map = { 'hỏng': 'broken' };
`,
    );
    expect(failed, `eslint không được báo lỗi. Đầu ra:
${output}`).toBe(false);
  });
});
