import { readdirSync, readFileSync } from 'node:fs';
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

  // DS-05: token đúng mà một luật riêng đặt font-size cứng cho ô nhập là ô đó vẫn làm iOS phóng to.
  it('không luật nào đè cỡ chữ của ô nhập / ô chọn bằng giá trị khác --fs-input', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(__dirname).filter((name) => name.endsWith('.css'))) {
      const source = css(file).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const size = /font-size\s*:\s*([^;]+)/.exec(body)?.[1].trim();
        if (!size || size === 'inherit' || size.includes('--fs-input')) continue;
        const targets = selector.split(',').map((part) => part.trim());
        if (targets.some((part) => /(?:^|[\s>])(?:input|select|textarea|\.inp)(?:[.:[][^\s]*)?$/.test(part))) {
          offenders.push(`${file}: ${selector.trim()} → ${size}`);
        }
      }
    }
    expect(offenders).toEqual([]);
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

/** FM-03 / Q-32: dải chọn một trong FORM xuống hàng khi hẹp, không cuộn ngang mất lựa chọn. */
describe('Dải nút trong form xuống hàng', () => {
  it('.field > .segmented: flex-wrap wrap, không cuộn ngang', () => {
    const body = css('form-layout.css').match(/\.field > \.segmented:not\(\.wrap\),\s*\.segmented\.fill\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(body).toMatch(/flex-wrap:\s*wrap/);
    expect(body).toMatch(/overflow-x:\s*visible/);
  });
});

/** ST-02: ô rỗng của bảng là khung viền đứt NẰM TRONG khung bảng — khung kép. */
describe('Trạng thái rỗng trong khung bảng', () => {
  it('.table-wrap .empty: không viền đứt, không nền riêng', () => {
    const body = css('shared-kit.css').match(/\.table-wrap \.empty\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(body).toMatch(/border:\s*none/);
    expect(body).toMatch(/background:\s*transparent/);
  });
});

/**
 * DS-18: tiêu đề thẻ / khối nhỏ hơn chữ thường (13px dưới thân 14px) đọc như chú thích, mắt
 * không bám được vào khối. Nhãn nhóm in hoa (kicker) là kiểu khác, được phép nhỏ.
 */
describe('Tiêu đề không nhỏ hơn chữ thân', () => {
  it('h1–h6 và .dash-slim-title không dùng cỡ dưới --fs-md, trừ nhãn in hoa', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(__dirname).filter((name) => name.endsWith('.css'))) {
      const source = css(file).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const size = /font-size\s*:\s*([^;]+)/.exec(body)?.[1] ?? '';
        if (!/--fs-(2xs|xs|sm)\b/.test(size) || /text-transform\s*:\s*uppercase/.test(body)) continue;
        const parts = selector.split(',').map((part) => part.trim());
        if (parts.some((part) => /(?:^|[\s>])h[1-6]$/.test(part) || /\.dash-slim-title$/.test(part))) {
          offenders.push(`${file}: ${selector.trim()} → ${size.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * DS-29: độ đậm chỉ 4 bậc qua token (400 / 500 / 600 / 700). Số viết tay trôi dần (800 ở lịch,
 * nhãn 500 cạnh nhãn 600) và đổi thang thì phải sửa trăm chỗ.
 */
describe('Độ đậm chỉ qua token', () => {
  it('ngoài @font-face, font-weight là var(--fw-*) hoặc inherit', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(__dirname).filter((name) => name.endsWith('.css'))) {
      const source = css(file)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/@font-face\s*\{[^}]*\}/g, '');
      for (const [, value] of source.matchAll(/font-weight\s*:\s*([^;}]+)/g)) {
        if (!/^(var\(--fw-[a-z]+\)|inherit)$/.test(value.trim())) offenders.push(`${file}: ${value.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/**
 * DS-04: vòng focus một kiểu nhìn. Nút / link / thẻ: dày 2px màu --focus (outline, hoặc --ring
 * cùng độ dày ở chỗ outline bị cắt). Ô nhập: viền đổi màu + --ring-field 1px, cộng lại cũng 2px.
 * Vòng 1px quanh một nút, hay outline màu --primary (3,4:1) thì mắt không bắt được.
 */
describe('Vòng focus một kiểu nhìn', () => {
  const FIELD = /(?:input|select|textarea|\.inp|-search|\.fsel-trigger|\.dp-trigger)(?::[\w-]+(?:\([^)]*\))?)*$/;
  const focusRules = () =>
    readdirSync(__dirname)
      .filter((name) => name.endsWith('.css'))
      .flatMap((file) =>
        [...css(file).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
          .filter(([, selector]) => /:focus/.test(selector))
          .map(([, selector, body]) => ({ file, selector: selector.trim(), body })),
      );

  it('--ring dày 2px, --ring-field 1px, đều màu --focus', () => {
    expect(tokenValue(rootBlock(), 'ring')).toBe('0 0 0 2px var(--focus)');
    expect(tokenValue(rootBlock(), 'ring-field')).toBe('0 0 0 1px var(--focus)');
    expect(tokenValue(rootBlock(), 'ring-inset')).toBe('inset 0 0 0 2px var(--focus)');
  });

  it('outline của focus chỉ dùng màu --focus', () => {
    const bad = focusRules()
      .filter(({ body }) => /outline\s*:\s*\d/.test(body) && !/outline\s*:[^;]*var\(--focus\)/.test(body))
      .map(({ file, selector }) => `${file}: ${selector}`);
    expect(bad).toEqual([]);
  });

  it('ô nhập dùng --ring-field, nút / thẻ không dùng', () => {
    const bad = focusRules()
      .filter(({ selector, body }) => {
        const field = selector.split(',').every((part) => FIELD.test(part.trim().replace(/:focus(-visible)?$/, '')));
        return field ? /var\(--ring\)/.test(body) : /--ring-field/.test(body);
      })
      .map(({ file, selector }) => `${file}: ${selector}`);
    expect(bad).toEqual([]);
  });
});
