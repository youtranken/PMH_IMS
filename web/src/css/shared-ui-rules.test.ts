import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cmpSpec, cssRules, declValue, readCss, specificity, type Rule } from './css-test-kit';

/**
 * Luật CSS dùng chung mà jsdom không kiểm được: thứ tự lớp, độ ưu tiên giữa luật chung và luật
 * của component, độ tương phản của token. Mỗi khối dưới đây canh một lỗi đã thấy trên màn thật.
 */

const FILES = [
  'base.css',
  'shell.css',
  'table.css',
  'overlays.css',
  'auth.css',
  'form-layout.css',
  'detail-tabs.css',
  'relation-map.css',
  'primitives.css',
  'profile.css',
  'datepicker.css',
  'command-palette.css',
  'shared-kit.css',
];

function rule(file: string, selector: string, media: string | null = null): Rule | undefined {
  return cssRules(file).find((r) => r.selector === selector && r.media === media);
}

// --- Token & độ tương phản -------------------------------------------------------------------

function tokenBlock(theme: 'light' | 'dark'): Map<string, string> {
  const css = readCss('tokens.css');
  const start = theme === 'light' ? css.indexOf(':root {') : css.indexOf("html[data-theme='dark'] {");
  const end = css.indexOf('\n}', start);
  const out = new Map<string, string>();
  for (const m of css.slice(start, end).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

function hex(theme: 'light' | 'dark', name: string): string {
  const light = tokenBlock('light');
  const own = theme === 'dark' ? tokenBlock('dark').get(name) : undefined;
  const v = own ?? light.get(name);
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} (${theme}) không phải hex 6 số: ${v}`);
  return v;
}

function luminance(h: string): number {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe('token màu đạt ngưỡng WCAG', () => {
  // Viền của ô nhập / nút viền là "thành phần giao diện" (1.4.11): ≥3:1 với nền nó nằm trên.
  it.each(['light', 'dark'] as const)('--field-border ≥ 3:1 trên surface/canvas/surface-2 (%s)', (theme) => {
    for (const bg of ['--surface', '--canvas', '--surface-2']) {
      expect(contrast(hex(theme, '--field-border'), hex(theme, bg)), bg).toBeGreaterThanOrEqual(3);
    }
  });

  it('--field-border có cặp dark khai tường minh', () => {
    expect(tokenBlock('dark').has('--field-border')).toBe(true);
  });

  // Ký hiệu trong chuỗi bí mật là CHỮ (1.4.3): ≥4.5:1 trên nền hộp hiện giá trị (surface-2).
  it.each(['light', 'dark'] as const)('.ch-symbol ≥ 4.5:1 trên surface-2 (%s)', (theme) => {
    const color = declValue(rule('shared-kit.css', '.ch-symbol')!.body, 'color')!;
    const token = /var\((--[\w-]+)\)/.exec(color)![1];
    expect(tokenBlock('dark').has(token), `${token} phải có cặp dark`).toBe(true);
    expect(contrast(hex(theme, token), hex(theme, '--surface-2'))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('viền ô nhập và nút viền dùng --field-border', () => {
  it.each([
    ['base.css', 'input'],
    ['base.css', 'select'],
    ['base.css', 'textarea'],
    ['base.css', 'button'],
    ['base.css', 'a.linkbtn'],
    ['form-layout.css', '.fsel-trigger'],
    ['datepicker.css', '.dp-trigger'],
    ['shared-kit.css', '.file-picker-label'],
  ])('%s %s', (file, selector) => {
    const r = rule(file, selector);
    expect(r, selector).toBeDefined();
    expect(declValue(r!.body, 'border')).toContain('var(--field-border)');
  });
});

// --- Lớp chồng ----------------------------------------------------------------------------------

describe('toast nổi trên hộp thoại', () => {
  it('.toast-stack dùng --z-toast và bật lại pointer-events (Radix tắt trên body)', () => {
    const body = rule('shared-kit.css', '.toast-stack')!.body;
    expect(declValue(body, 'z-index')).toBe('var(--z-toast)');
    expect(declValue(body, 'pointer-events')).toBe('auto');
  });
});

// --- Độ ưu tiên: luật chung không được đè luật của component ------------------------------------

describe('trạng thái chung của ô nhập/nút thua luật component', () => {
  const hoverRules = cssRules('base.css').filter((r) => /^(input|select|textarea)\b.*:hover/.test(r.selector));
  const activeRules = cssRules('base.css').filter((r) => /^button\b.*:active/.test(r.selector));

  it('có luật hover chung cho ô nhập và luật active chung cho nút', () => {
    expect(hoverRules.length).toBeGreaterThan(0);
    expect(activeRules.length).toBeGreaterThan(0);
  });

  it.each([
    ['shared-kit.css', ".inp[aria-invalid='true']"],
    ['auth.css', '.auth-form .inp'],
  ])('hover viền chung thua %s %s', (file, selector) => {
    const own = specificity(rule(file, selector)!.selector);
    for (const h of hoverRules) expect(cmpSpec(own, specificity(h.selector)), h.selector).toBeGreaterThan(0);
  });

  it.each([
    ['form-layout.css', '.combo-caret'],
    ['form-layout.css', '.combo.open .combo-caret'],
    ['datepicker.css', '.dp-clear'],
  ])('nhún :active chung không đè transform của %s %s', (file, selector) => {
    const own = specificity(rule(file, selector)!.selector);
    for (const a of activeRules) expect(cmpSpec(own, specificity(a.selector)), a.selector).toBeGreaterThan(0);
  });
});

describe('hover của các nút tự vẽ', () => {
  it('chip bung dòng giữ màu của nó khi hover (luật .caret-btn:hover ở primitives.css nạp sau)', () => {
    const own = rule('table.css', '.caret-btn.caret-chip:hover');
    expect(own).toBeDefined();
    expect(declValue(own!.body, 'background')).toBe('var(--primary-soft)');
  });

  it('ô ngày đang chọn / hôm nay vẫn có phản hồi khi hover', () => {
    expect(declValue(rule('datepicker.css', '.dp-cell.sel:hover')!.body, 'border-color')).toBeDefined();
    expect(declValue(rule('datepicker.css', '.dp-cell.today:hover')!.body, 'border-color')).toBeDefined();
  });

  it('link phủ thẻ mobile không vẽ vòng tiêu điểm thứ hai (thẻ đã vẽ)', () => {
    expect(declValue(rule('table.css', '.list-card-link:focus-visible')!.body, 'box-shadow')).toBe('none');
  });

  it('nhãn chọn file hover dùng --primary-ink (--primary chỉ 3,4:1 trên trắng)', () => {
    expect(declValue(rule('shared-kit.css', '.file-picker-label:hover')!.body, 'color')).toBe('var(--primary-ink)');
  });
});

describe('vòng tiêu điểm vẽ một lần', () => {
  it.each([
    '.settings-nav button:focus-visible',
    '.access-col-btn:focus-visible',
    '.access-chip:focus-visible',
    '.access-member:focus-visible',
    '.access-rule-chip:focus-visible',
  ])('%s không thêm outline bên cạnh ring chung của <button>', (selector) => {
    const r = rule('shared-kit.css', selector);
    if (r) expect(declValue(r.body, 'outline') ?? 'none').toMatch(/^(none|0)$/);
  });
});

// --- Bố cục -------------------------------------------------------------------------------------

describe('bố cục khối dùng chung', () => {
  it('.empty-action xếp các nút thành hàng có khe', () => {
    const body = rule('shared-kit.css', '.empty .empty-action')!.body;
    expect(declValue(body, 'display')).toBe('flex');
    expect(declValue(body, 'gap')).toBeDefined();
  });

  it('khoảng trên của nút chính ở trang lỗi chỉ áp cho con trực tiếp (không lệch trong .error-actions)', () => {
    expect(rule('shared-kit.css', '.error-state .primary')).toBeUndefined();
  });

  it('.filter-range không xuống dòng dù nằm trong thanh lọc', () => {
    const generic = cssRules('detail-tabs.css').find((r) => r.selector === ".filter-bar [role='group']")!;
    const own = cssRules('detail-tabs.css').filter(
      (r) => r.selector.includes('.filter-range') && declValue(r.body, 'flex-wrap') === 'nowrap',
    );
    expect(own.length).toBeGreaterThan(0);
    expect(cmpSpec(specificity(own[0].selector), specificity(generic.selector))).toBeGreaterThanOrEqual(0);
  });

  it.each(['tr:last-child', 'tr:nth-child(even)'])('luật dòng bảng `%s` không rò vào bảng con trong khu bung', (part) => {
    const rules = cssRules('table.css').filter((r) => r.selector.startsWith('table.table') && r.selector.includes(part));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r.selector).toMatch(/^table\.table > tbody > tr[^ ]* > td$/);
  });

  it('thanh lọc ≤600px: ô chọn / ô ngày chia đều hai cột thay cho bề ngang tối thiểu lởm chởm', () => {
    for (const selector of ['.filter-bar > .fsel', '.filter-bar > .dp']) {
      const r = rule('detail-tabs.css', selector, '(max-width: 600px)');
      expect(r, selector).toBeDefined();
      expect(declValue(r!.body, 'flex')).toMatch(/calc\(50% - /);
      expect(declValue(r!.body, 'min-width')).toBe('0');
    }
    expect(declValue(rule('detail-tabs.css', '.filter-bar > .grow', '(max-width: 600px)')!.body, 'flex-basis')).toBe('100%');
  });

  it('.session-list chỉ khai ở một file', () => {
    const owners = FILES.filter((f) => cssRules(f).some((r) => /^\.session-list\b/.test(r.selector)));
    expect(owners).toEqual(['shared-kit.css']);
  });
});

describe('không còn CSS/token chết', () => {
  it.each(['time-picker.css', 'time-field.css'])('ui/%s đã xoá', (f) => {
    expect(existsSync(join(__dirname, '..', 'ui', f))).toBe(false);
  });

  it.each(['--z-lightbox', '--scrim-strong'])('token %s không còn', (token) => {
    expect(readCss('tokens.css')).not.toContain(token);
  });
});
