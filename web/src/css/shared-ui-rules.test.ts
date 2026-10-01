import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cmpSpec, cssRules, declValue, readCss, specificity, type Rule } from '@/test/css-test-kit';

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

  // Chữ thường gặp trên các mặt nền chính, kể cả dòng chẵn của bảng (dòng quá hạn chữ đỏ).
  it.each(['--ink', '--ink-2', '--ink-3', '--muted', '--danger', '--primary-ink', '--info'])(
    'chữ %s ≥ 4.5:1 trên canvas/surface/surface-2/row-alt (dark)',
    (fg) => {
      for (const bg of ['--canvas', '--surface', '--surface-2', '--row-alt', '--muted-soft']) {
        expect(contrast(hex('dark', fg), hex('dark', bg)), `${fg} trên ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it.each([
    ['--primary-soft', '--primary-ink'],
    ['--ok-soft', '--ok'],
    ['--warn-soft', '--warn'],
    ['--warm-soft', '--warm-ink'],
    ['--danger-soft', '--danger'],
    ['--danger-soft', '--danger-strong'],
    ['--info-soft', '--info'],
  ])('huy hiệu: chữ trên %s ≥ 4.5:1 (dark, %s)', (bg, fg) => {
    expect(contrast(hex('dark', fg), hex('dark', bg))).toBeGreaterThanOrEqual(4.5);
  });

  // Mặc định là tối (Q-21) nên nền tối không được đen kịt: canvas tối thiểu sáng như #171e18, và
  // sidebar vẫn tối hơn canvas để tách khối.
  it('nền tối đã sáng lên mà sidebar vẫn tối hơn canvas', () => {
    expect(luminance(hex('dark', '--canvas'))).toBeGreaterThanOrEqual(luminance('#171e18'));
    expect(luminance(hex('dark', '--surface'))).toBeGreaterThan(luminance(hex('dark', '--canvas')));
    expect(luminance(hex('dark', '--sidebar-bg'))).toBeLessThan(luminance(hex('dark', '--canvas')));
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

  /*
   * Toast ở góc dưới phải nằm đúng chỗ nút Lưu của chân hộp thoại: nổi trên hộp mà vẫn ở đáy thì
   * che nút, người dùng bấm Lưu không ăn (E2E nat.spec "thêm router mới ngay trong hộp"). Lên góc
   * trên PHẢI thì lại đè nút ✕ đóng hộp. Có hộp mở thì toast lên mép trên, GIỮA màn: chỗ đó là
   * phần trống của đầu hộp (tiêu đề bên trái, ✕ bên phải). Màn đăng nhập / đổi mật khẩu ở
   * 1366×768 có nút chính sát đáy, nên toast cũng lên trên.
   */
  const TOP_PLACED = [
    "body:has([role='dialog']) .toast-stack",
    "body:has([role='alertdialog']) .toast-stack",
    'body:has(.auth) .toast-stack',
  ];
  it.each(TOP_PLACED)('%s: toast lên mép trên, không đè chân hộp hay nút chính', (sel) => {
    for (const media of [null, '(max-width: 480px)']) {
      const r = rule('shared-kit.css', sel, media);
      expect(r, `thiếu luật ${sel} @media ${media}`).toBeDefined();
      expect(declValue(r!.body, 'bottom')).toBe('auto');
      expect(declValue(r!.body, 'top')).toBeDefined();
    }
  });

  it.each(TOP_PLACED)('%s: màn rộng thì toast ở GIỮA, không ở góc phải (nút ✕)', (sel) => {
    const r = rule('shared-kit.css', sel)!;
    expect(declValue(r.body, 'right')).toBe('auto');
    expect(declValue(r.body, 'left')).toBe('50%');
    expect(declValue(r.body, 'transform')).toBe('translateX(-50%)');
    // Màn hẹp toast trải gần trọn bề ngang: bỏ dịch nửa bề rộng, không thì lệch khỏi màn.
    const narrow = rule('shared-kit.css', sel, '(max-width: 480px)')!;
    expect(declValue(narrow.body, 'transform')).toBe('none');
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

describe('nút "Quay lại" ở bước nhập mã 2 lớp', () => {
  // Bấm nó là đóng phiên dở: rê chuột phải báo trước bằng tông đỏ nhạt. Card đăng nhập tối ở cả
  // hai theme nên dùng bộ --auth-danger-* (không đổi theo theme), không dùng --danger-soft.
  it('hover tô nền/viền/chữ đỏ nhạt bằng token --auth-danger-*', () => {
    const body = rule('auth.css', '.auth-form .btn.auth-secondary:hover:not(:disabled)')!.body;
    expect(declValue(body, 'background')).toBe('var(--auth-danger-bg)');
    expect(declValue(body, 'border-color')).toBe('var(--auth-danger-border)');
    expect(declValue(body, 'color')).toBe('var(--auth-danger-ink)');
  });
});

// --- Chuyển động khi rê chuột (Q-21) -------------------------------------------------------------

describe('chuyển động nhẹ khi rê chuột', () => {
  const REDUCE = '(prefers-reduced-motion: reduce)';

  it('thời lượng là token --dur-fast / --dur trong khoảng 150–200ms', () => {
    const light = tokenBlock('light');
    expect(light.get('--dur-fast')).toBe('150ms');
    expect(light.get('--dur')).toBe('200ms');
  });

  it.each([
    ['base.css', 'button'],
    ['base.css', 'a.linkbtn'],
    ['base.css', '.nav-item'],
    ['shared-kit.css', '.kpi'],
    ['form-layout.css', '.chip'],
    ['primitives.css', '.subnet-card'],
    ['table.css', 'table.table > tbody > tr > td'],
  ])('%s %s đổi trạng thái có transition theo token thời lượng', (file, selector) => {
    const t = declValue(rule(file, selector)!.body, 'transition');
    expect(t, selector).toMatch(/var\(--dur(-fast)?\)/);
  });

  it('ô số trên Bảng điều khiển nhấc 1px + bóng khi rê chuột', () => {
    const body = rule('shared-kit.css', '.kpi:hover')!.body;
    expect(declValue(body, 'transform')).toBe('translateY(-1px)');
    expect(declValue(body, 'box-shadow')).toBeDefined();
  });

  it('"giảm chuyển động": tắt mọi transition/animation và bỏ cả các cú nhấc/trượt khi hover', () => {
    const all = cssRules('detail-tabs.css').find((r) => r.selector === '*' && r.media === REDUCE)!;
    expect(declValue(all.body, 'transition')).toBe('none !important');
    for (const [file, selector] of [
      ['base.css', '.nav-item:hover'],
      ['shared-kit.css', '.kpi:hover'],
    ]) {
      expect(declValue(rule(file, selector, REDUCE)!.body, 'transform'), selector).toBe('none');
    }
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

  // Chữ mô tả chạy một hàng khi còn chỗ (Q-21): không ép xuống dòng bằng trần theo số ký tự.
  // Ngoại lệ có chủ đích: lý do xin mở két là chữ người dùng gõ mà người duyệt phải đọc kỹ.
  // `.page-header .sub` / `.alert` đang được gỡ trần ở nhánh khác nên tạm cho qua.
  it('không ép chữ mô tả xuống dòng bằng max-width theo ch', () => {
    const allowed = new Set(['.approval-reason', '.page-header .sub', '.alert']);
    const capped = FILES.flatMap((f) =>
      cssRules(f)
        .filter((r) => r.media === null && /^\d+(\.\d+)?ch$/.test(declValue(r.body, 'max-width') ?? ''))
        .map((r) => r.selector),
    ).filter((s) => !allowed.has(s));
    expect(capped).toEqual([]);
  });

  // Nút vuông 28px mà giữ đệm ngang 0.85rem của `button` chung thì vùng nội dung âm, hình chép
  // tràn sang phải — lệch tâm ở mọi chỗ dùng.
  it.each(['.copy-btn', '.copy-btn.inline'])('%s không mang đệm của button chung (hình nằm giữa ô)', (selector) => {
    const pad = declValue(rule('detail-tabs.css', '.copy-btn')!.body, 'padding');
    expect(pad).toBe('0');
    const own = rule('detail-tabs.css', selector)!;
    expect(declValue(own.body, 'padding') ?? pad).toBe('0');
  });

  // Nút vuông có viền đứng sát chữ thì viền dính vào ký tự cuối, và canh theo đường chân chữ
  // (mặc định của inline-grid) thì nó trồi lên lệch khỏi dòng.
  it('.copy-btn canh giữa dòng chữ và cách chữ đứng trước nó', () => {
    expect(declValue(rule('detail-tabs.css', '.copy-btn')!.body, 'vertical-align')).toBe('middle');
    const gap = rule('detail-tabs.css', '.mono + .copy-btn:not(.inline)');
    expect(gap, 'thiếu luật cách chữ cho nút có viền').toBeDefined();
    expect(declValue(gap!.body, 'margin-inline-start')).toBeDefined();
  });

  it('.session-list chỉ khai ở một file', () => {
    const owners = FILES.filter((f) => cssRules(f).some((r) => /^\.session-list\b/.test(r.selector)));
    expect(owners).toEqual(['shared-kit.css']);
  });
});

/*
 * Bảng thiết bị ở 1280–1440px có sidebar: chữ `nowrap` trong ô Tên mang bề rộng TOÀN câu vào
 * bề rộng tối thiểu của cột, nên bảng không co lại được và cột Trạng thái / Bảo hành bị cột
 * thao tác dính mép che mất. Ô Tên phải co được tới sàn `col-name`, và ở khổ này Vị trí là dòng
 * phụ dưới Tên thay cho một cột riêng.
 */
describe('bảng thiết bị vừa khung ở 1280–1440px', () => {
  const MID = '(min-width: 961px) and (max-width: 1440px)';

  it('.cell-stack không đóng góp bề rộng tối thiểu (rãnh lưới bắt đầu từ 0)', () => {
    const r = rule('table.css', '.cell-stack');
    expect(r).toBeDefined();
    expect(declValue(r!.body, 'display')).toBe('grid');
    expect(declValue(r!.body, 'grid-template-columns')).toBe('minmax(0, max-content)');
  });

  it('khổ giữa: cột .col-wide ẩn, dòng phụ .only-mid hiện', () => {
    expect(declValue(rule('table.css', 'table.table .col-wide', MID)!.body, 'display')).toBe('none');
    expect(declValue(rule('table.css', '.cell-sub.only-mid')!.body, 'display')).toBe('none');
    expect(declValue(rule('table.css', '.cell-sub.only-mid', MID)!.body, 'display')).toBe('block');
  });

  // Bảng IP nằm trong khung phải ~770px ở 1366: tiêu đề "Người / phòng ban dùng" không ngắt
  // dòng thì một mình nó đòi 190px, và ô đệm 14px × 14 mép ăn thêm gần 200px.
  it('bảng IP: tiêu đề ngắt dòng được, ô đệm hẹp lại ở khổ giữa', () => {
    const head = rule('primitives.css', 'table.table.ip-table thead th', '(min-width: 961px)');
    expect(declValue(head!.body, 'white-space')).toBe('normal');
    for (const sel of ['table.table.ip-table thead th', 'table.table.ip-table tbody td']) {
      expect(declValue(rule('primitives.css', sel, MID)!.body, 'padding-inline'), sel).toBe('var(--space-5)');
    }
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
