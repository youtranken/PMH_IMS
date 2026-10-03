import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PALETTE } from './palette.generated';
import { paletteModule, PALETTE_TOKENS, tokenValues } from '../../scripts/palette-source';

const REPO = join(__dirname, '../../..');
const TOKENS_CSS = readFileSync(join(REPO, 'web/src/css/tokens.css'), 'utf8');

/**
 * Màu của server (thư, file xuất bản vẽ) lấy từ `web/src/css/tokens.css` — nguồn màu duy nhất
 * (AD-15). Server không đọc CSS lúc chạy (image api không chứa web/), nên bảng màu được SINH ra
 * `palette.generated.ts`; bài này đỏ khi ai đổi `tokens.css` mà quên sinh lại
 * (`npm --prefix api run gen:palette`).
 */
describe('PALETTE — sinh từ tokens.css, không lệch', () => {
  it('tệp sinh ra đúng từng byte với tokens.css hiện tại', () => {
    expect(readFileSync(join(__dirname, 'palette.generated.ts'), 'utf8')).toBe(paletteModule(TOKENS_CSS));
  });

  it('mỗi màu là giá trị bản SÁNG (:root) của đúng token — giấy in và thư luôn nền sáng', () => {
    const light = tokenValues(TOKENS_CSS);
    for (const [name, token] of Object.entries(PALETTE_TOKENS)) {
      expect(PALETTE[name as keyof typeof PALETTE]).toBe(light.get(token));
    }
    expect(PALETTE.ink).toBe('#1f231c');
  });

  it('token thiếu trong :root → sinh hỏng ngay, không lặng lẽ ra undefined', () => {
    expect(() => paletteModule(':root { --ink: #000000; }')).toThrow(/--/);
  });

  it('ops/gate-hex.sh xanh — kể cả phần soi api/src', () => {
    expect(() => execFileSync('bash', [join(REPO, 'ops/gate-hex.sh')], { stdio: 'pipe' })).not.toThrow();
  });
});
