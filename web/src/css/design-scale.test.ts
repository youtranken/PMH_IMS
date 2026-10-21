import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Quy chuẩn nền của Đợt 2 (DS-01/02/03/04/05/22): đo trên 40 màn thấy chữ 10–11px ở khắp nơi,
 * nút 27 chiều cao, ô nhập 40px cạnh nút 36px, vòng focus mờ 22% (nút chính không có vòng). Bài
 * này khóa các token gốc để thang không trôi lại.
 */
const css = (name: string) => readFileSync(join(__dirname, name), 'utf8');
const tokens = css('tokens.css');
const base = css('base.css');
const ROOT_PX = 14;

function rootBlock(): string {
  const at = tokens.indexOf(':root {');
  return tokens.slice(at, tokens.indexOf('\n}', at));
}
function darkBlock(): string {
  const at = tokens.indexOf("html[data-theme='dark'] {");
  return tokens.slice(at, tokens.indexOf('\n}', at));
}
function px(value: string): number {
  const v = value.trim();
  if (v.endsWith('rem')) return parseFloat(v) * ROOT_PX;
  if (v.endsWith('px')) return parseFloat(v);
  return NaN;
}
function tokenValue(block: string, name: string): string {
  const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`thiếu --${name}`);
  return m[1];
}
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('Thang chữ: sàn 12px', () => {
  it.each(['fs-2xs', 'fs-xs', 'fs-sm', 'fs-md', 'fs-mono'])('--%s ≥ 12px', (name) => {
    expect(px(tokenValue(rootBlock(), name))).toBeGreaterThanOrEqual(12);
  });
});

describe('Chiều cao control: cùng hàng cùng cao', () => {
  it('có --h-ctl-sm 28px, --h-ctl 36px', () => {
    expect(px(tokenValue(rootBlock(), 'h-ctl-sm'))).toBe(28);
    expect(px(tokenValue(rootBlock(), 'h-ctl'))).toBe(36);
  });

  it('màn cảm ứng / hẹp: control cao ≥ 44px, chữ ô nhập 16px (iOS không tự phóng)', () => {
    const touch = tokens.match(/@media[^{]*pointer:\s*coarse[^{]*\{\s*:root\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(px(tokenValue(touch, 'h-ctl'))).toBeGreaterThanOrEqual(44);
    expect(px(tokenValue(touch, 'fs-input'))).toBeGreaterThanOrEqual(16);
  });

  it('ô nhập, ô chọn và nút dùng chung --h-ctl', () => {
    expect(base).toMatch(/min-height:\s*var\(--h-ctl\)/);
    expect(base).toMatch(/button\.sm\s*\{[^}]*min-height:\s*var\(--h-ctl-sm\)/);
  });
});

describe('Vòng focus thấy được', () => {
  it.each([
    ['sáng', rootBlock],
    ['tối', darkBlock],
  ])('giao diện %s: --focus màu đặc, tương phản ≥ 3:1 với nền', (_, block) => {
    const focus = tokenValue(block(), 'focus');
    expect(focus).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(contrast(focus, tokenValue(block(), 'surface'))).toBeGreaterThanOrEqual(3);
  });

  it('nút vẽ focus bằng outline (box-shadow của nút chính không đè được)', () => {
    expect(base).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\)/);
  });
});

describe('Bo góc 4 / 6 / 8 / 12', () => {
  it.each([
    ['r-sm', 4],
    ['r', 6],
    ['r-lg', 8],
    ['r-xl', 12],
  ])('--%s = %ipx', (name, value) => {
    expect(px(tokenValue(rootBlock(), name))).toBe(value);
  });
});

/**
 * DS-06/PW-C15: nút icon (⋮ 27px ×200 dòng, đóng hộp 28px, xóa ngày 18px, (i) 21px) quá nhỏ cho
 * ngón tay. Tất cả lấy cỡ từ --h-ctl-sm, token này tự lên 40px ở màn cảm ứng / hẹp.
 */
describe('Nút icon theo --h-ctl-sm', () => {
  const all = ['table.css', 'form-layout.css', 'primitives.css', 'detail-tabs.css'].map(css).join('\n');
  it.each(['.row-actions .kebab', '.sheet-close', '.caret-btn', '.copy-btn', 'button.btn-x', '.info-tip-btn'])('%s', (sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const body = all.match(new RegExp(`(^|\\n)${esc}\\s*\\{([^}]*)\\}`))?.[2] ?? '';
    expect(body).toMatch(/(min-)?height:\s*var\(--h-ctl-sm\)/);
  });
  it('màn cảm ứng / hẹp: --h-ctl-sm ≥ 40px', () => {
    const touch = tokens.match(/@media[^{]*pointer:\s*coarse[^{]*\{\s*:root\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(px(tokenValue(touch, 'h-ctl-sm'))).toBeGreaterThanOrEqual(40);
  });
});

/** FM-02: dòng tóm tắt lỗi / khung báo lỗi chen vào lưới form chiếm MỘT ô, đẩy lệch các ô sau. */
describe('Khung báo trong lưới form chiếm trọn hàng', () => {
  it('.form-grid > .alert / .form-summary: grid-column 1 / -1', () => {
    const form = css('form-layout.css');
    expect(form).toMatch(/\.form-grid > \.alert[^{]*\{[^}]*grid-column:\s*1 \/ -1/);
  });
});
