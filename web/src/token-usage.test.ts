import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * TOKEN ĐÚNG TÊN MÀ SAI KIỂU — CSS VỨT CẢ DÒNG, IM LẶNG.
 *
 * ===== LỖ BÀI NÀY CANH =====
 *
 * `outline: 2px solid var(--ring)` trông đúng: tên token đúng, thuộc
 * tính hợp lệ, cổng `gate-hex.sh` không có gì để nói vì chẳng có màu viết thẳng nào. Nhưng
 * `tokens.css:49` khai `--ring: 0 0 0 3px rgba(14, 159, 110, 0.22)` — một giá trị
 * **box-shadow**, không phải màu. Thay vào thì dòng thành
 * `outline: 2px solid 0 0 0 3px rgba(...)`, không parse được, và trình duyệt **vứt cả khai
 * báo** mà không báo gì.
 *
 * Hậu quả cụ thể: `FilePicker` giấu `<input>` thật bằng `clip: rect(0 0 0 0)`, nên cái label
 * là thứ duy nhất nhìn thấy được. Viết sai thì vòng tiêu điểm của nó không vẽ ra — Tab tới ô
 * chọn file là không có tín hiệu nào (WCAG 2.4.7), ở mọi hộp Import và mọi khu đính kèm.
 *
 * ===== VÌ SAO KHÔNG CỔNG NÀO BẮT ĐƯỢC =====
 *
 * `gate-hex.sh` hỏi "có màu viết thẳng ngoài tokens.css không". Đây là câu hỏi khác hẳn:
 * "token này có dùng đúng KIỂU của nó không". Không ai hỏi câu ấy, nên một khai báo chết nằm
 * đó rất lâu mà repo vẫn sạch theo mọi thước đang có.
 *
 * ===== CÁCH HỎI =====
 *
 * Phân loại token bằng chính GIÁ TRỊ trong `tokens.css` (lần theo cả `var()` trỏ sang token
 * khác), rồi soi những thuộc tính CHỈ nhận `<color>`.
 *
 * `background` CỐ Ý không nằm trong danh sách: nó nhận cả `<image>`, và `--grad` / `--auth-bg`
 * là gradient dùng đúng chỗ ở bảy nơi. Một cổng bắt oan bảy chỗ đúng để bắt một chỗ sai là
 * một cổng sẽ bị tắt.
 */

const CSS_DIR = join(__dirname, 'css');
const TOKENS_FILE = join(CSS_DIR, 'tokens.css');

/** Thuộc tính CHỈ nhận `<color>` (kể cả hai shorthand có đúng một ô màu). */
const COLOR_ONLY_PROPS = [
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'caret-color',
  'text-decoration-color',
  'fill',
  'stroke',
  'border',
  'outline',
];

const COLOR_VALUE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|transparent|currentColor|inherit)$/;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** `--tên → giá trị` từ `tokens.css`, cả khối sáng lẫn khối tối. */
function tokenValues(): Map<string, string> {
  const out = new Map<string, string>();
  const source = stripComments(readFileSync(TOKENS_FILE, 'utf8'));
  for (const match of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    // Khối tối khai LẠI cùng token; bản đầu là đủ — hai bản phải cùng kiểu, và nếu lệch kiểu
    // thì đó là một lỗi khác, to hơn, và `tokens.css` tự nó phải trả lời.
    if (!out.has(match[1])) out.set(match[1], match[2].trim());
  }
  return out;
}

/** `true` = màu · `false` = không phải màu · `null` = không biết (token lạ). */
function isColorToken(
  name: string,
  values: Map<string, string>,
  seen: Set<string> = new Set(),
): boolean | null {
  const value = values.get(name);
  if (value === undefined || seen.has(name)) return null;
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  // Token trỏ sang token khác thì hỏi tiếp — `--line: var(--border)` là cách viết thật.
  if (alias) return isColorToken(alias[1], values, new Set(seen).add(name));
  return COLOR_VALUE.test(value);
}

function allCssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return allCssFiles(full);
    return full.endsWith('.css') && entry !== 'tokens.css' ? [full] : [];
  });
}

/** Mọi cặp `(thuộc tính cần màu, token không phải màu)` trong một đoạn CSS. */
export function colorSlotMisuse(css: string, values: Map<string, string>): string[] {
  const pattern = new RegExp(
    `(?<![-a-z])(${COLOR_ONLY_PROPS.join('|')})\\s*:\\s*([^;{}]+);`,
    'gi',
  );
  const out: string[] = [];
  for (const declaration of stripComments(css).matchAll(pattern)) {
    const property = declaration[1].toLowerCase();
    for (const token of declaration[2].matchAll(/var\((--[a-z0-9-]+)/g)) {
      if (isColorToken(token[1], values) === false) {
        out.push(`${property}: … ${token[1]}`);
      }
    }
  }
  return out;
}

describe('Token dùng đúng KIỂU của nó, không chỉ đúng tên', () => {
  const values = tokenValues();

  /**
   * Một cổng khớp đúng số không chuỗi trông y hệt một cổng không có gì để bắt — repo này đã
   * dựng nhầm loại cổng đó ba lần. Nên chứng minh nó có mắt trước khi tin nó nói "sạch".
   */
  describe('bản thân phép quét — vế đối chứng', () => {
    it('đọc được `tokens.css`, và phân loại đúng hai nhóm', () => {
      expect(values.size).toBeGreaterThan(50);
      expect(isColorToken('--ring', values)).toBe(false);
      expect(isColorToken('--shadow-sm', values)).toBe(false);
      expect(isColorToken('--primary', values)).toBe(true);
      expect(isColorToken('--ink', values)).toBe(true);
    });

    it.each([
      ['outline: 2px solid var(--ring);', 'đúng dòng đã chết ở shared-kit.css'],
      ['border: 1px solid var(--shadow);', 'shorthand border'],
      ['color: var(--ring);', 'thuộc tính màu thuần'],
      ['BORDER-COLOR: var(--shadow-lg);', 'chữ hoa'],
    ])('bắt được %p (%s)', (css) => {
      expect(colorSlotMisuse(css, values)).toHaveLength(1);
    });

    it.each([
      ['box-shadow: var(--ring);', 'đúng chỗ của --ring'],
      ['outline: 2px solid var(--primary);', 'token màu ở ô màu'],
      ['background: var(--grad);', '`background` nhận cả gradient — không soi'],
      ['/* outline: 2px solid var(--ring); */', 'chú thích'],
      ['border-radius: var(--r);', 'không phải ô màu'],
    ])('KHÔNG bắt oan %p (%s)', (css) => {
      expect(colorSlotMisuse(css, values)).toEqual([]);
    });
  });

  it('không file CSS nào đặt token phi-màu vào ô cần màu', () => {
    const offences: string[] = [];
    for (const file of allCssFiles(CSS_DIR)) {
      for (const hit of colorSlotMisuse(readFileSync(file, 'utf8'), values)) {
        offences.push(`${file.slice(CSS_DIR.length + 1)} — ${hit}`);
      }
    }
    expect(offences).toEqual([]);
  });
});

/** Token khai trong một khối `selector { … }` đầu tiên khớp `opener` của `tokens.css`. */
function tokensInBlock(opener: string): Map<string, string> {
  const source = stripComments(readFileSync(TOKENS_FILE, 'utf8'));
  const start = source.indexOf(opener);
  if (start < 0) return new Map();
  const end = source.indexOf('\n}', start);
  const out = new Map<string, string>();
  for (const m of source.slice(start, end).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

/** Giá trị có chứa màu viết thẳng: hex, hàm màu, hoặc hex mã hoá URL trong SVG nhúng. */
const CARRIES_COLOUR = /#[0-9a-f]{3,8}\b|%23[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/i;

/**
 * Token mang màu mà thiếu cặp `html[data-theme='dark']` thì ở theme tối nó giữ nguyên màu
 * sáng — chính lỗi của icon SVG xám và bóng đổ đen nhạt biến mất trên nền tối.
 */
describe('Mọi token mang màu có cặp dark', () => {
  const light = tokensInBlock(':root {');
  const dark = tokensInBlock("html[data-theme='dark'] {");

  it('đọc được cả hai khối', () => {
    expect(light.size).toBeGreaterThan(50);
    expect(dark.size).toBeGreaterThan(20);
  });

  it('không token mang màu nào chỉ có bản sáng', () => {
    const missing = [...light]
      .filter(([, value]) => CARRIES_COLOUR.test(value))
      .map(([name]) => name)
      .filter((name) => !dark.has(name));
    expect(missing).toEqual([]);
  });
});
