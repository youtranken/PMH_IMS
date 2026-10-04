import { describe, expect, it } from 'vitest';
import { cssRules, declValue, readCss } from '@/test/css-test-kit';

/**
 * Vi chuyển động dùng chung (Q-21, 04/10/2026): mọi khung hình chỉ được đổi `transform`,
 * `opacity` (và `background-position` cho vệt sáng khung chờ) — thứ trình duyệt dựng trên GPU,
 * không bắt cả trang tính lại bố cục. Và mọi chỗ bật animation phải có luật tắt theo
 * `data-motion` (máy báo giảm chuyển động / "Tắt" trong Hồ sơ).
 */

const ALLOWED = new Set(['transform', 'opacity', 'background-position']);

/** Các keyframe các hiệu ứng này dùng — mới thêm, và những cái dùng lại của ô mã 2 lớp / khung chờ. */
const KEYFRAMES: Array<[string, string]> = [
  ['shared-kit.css', 'submit-done'],
  ['shared-kit.css', 'burst-out'],
  ['shared-kit.css', 'dialog-in'],
  ['shared-kit.css', 'dialog-out'],
  ['shared-kit.css', 'dialog-hold'],
  ['shared-kit.css', 'dialog-fade-out'],
  ['shared-kit.css', 'fp-bounce'],
  ['shared-kit.css', 'fp-pulse'],
  ['shared-kit.css', 'fp-drop'],
  ['shared-kit.css', 'otp-check-pop'],
  ['shared-kit.css', 'otp-seal-in'],
  ['shared-kit.css', 'otp-ripple'],
  ['detail-tabs.css', 'skeletonShimmer'],
];

function keyframesBody(file: string, name: string): string | undefined {
  const css = readCss(file);
  const start = css.indexOf(`@keyframes ${name} {`);
  if (start < 0) return undefined;
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i);
  }
  return undefined;
}

function animatedProps(body: string): string[] {
  const props = new Set<string>();
  for (const block of body.matchAll(/\{([^{}]*)\}/g)) {
    for (const m of block[1].matchAll(/([\w-]+)\s*:/g)) props.add(m[1]);
  }
  return [...props];
}

const REDUCE = '(prefers-reduced-motion: reduce)';
const SYSTEM = "html:not([data-motion='on'])";
const OFF = "html[data-motion='off']";

describe('khung hình chỉ đổi transform / opacity / background-position', () => {
  it.each(KEYFRAMES)('%s @keyframes %s', (file, name) => {
    const body = keyframesBody(file, name);
    expect(body, name).toBeDefined();
    const props = animatedProps(body!);
    expect(props.length, name).toBeGreaterThan(0);
    for (const prop of props) expect(ALLOWED.has(prop), `${name}: ${prop}`).toBe(true);
  });
});

describe('mọi chỗ bật hiệu ứng mới đều tắt được theo data-motion', () => {
  const NEW = KEYFRAMES.filter(([file]) => file === 'shared-kit.css').map(([, name]) => name);
  const rules = cssRules('shared-kit.css');
  const users = rules.filter(
    (r) =>
      r.media === null &&
      !r.selector.includes('data-motion') &&
      // Ô mã 2 lớp có luật tắt riêng (shared-ui-rules.test.ts canh) — ở đây chỉ canh nơi dùng mới.
      !r.selector.includes('.otp-') &&
      NEW.some((name) => new RegExp(`\\b${name}\\b`).test(declValue(r.body, 'animation') ?? '')),
  );

  it('có đúng các nơi dùng mong đợi', () => {
    expect(users.map((r) => r.selector).sort()).toEqual(
      [
        '.dialog-viewport > [data-state=\'closed\']',
        '.dialog-viewport > [data-state=\'open\']',
        '.dialog-viewport[data-state=\'closed\']',
        '.file-picker.dragging .file-picker-icon',
        '.file-picker.dragging::before',
        '.file-picker.dropped::after',
        '.modal-backdrop[data-state=\'closed\']',
        '.submit-check',
        '.submit-check .glyph',
        '.success-burst',
        '.success-burst-mark',
        '.success-burst-seal',
        '.success-burst-seal::after',
      ].sort(),
    );
  });

  it.each(users.map((r) => r.selector))('%s: tắt khi máy báo giảm chuyển động và khi chọn "Tắt"', (selector) => {
    const system = rules.find((r) => r.media === REDUCE && r.selector === `${SYSTEM} ${selector}`);
    const off = rules.find((r) => r.media === null && r.selector === `${OFF} ${selector}`);
    expect(system, selector).toBeDefined();
    expect(off, selector).toBeDefined();
    expect(declValue(system!.body, 'animation')).toBe('none !important');
    expect(declValue(off!.body, 'animation')).toBe('none !important');
  });

  it('vạch tab chỉ trượt bằng transform, và đứng yên khi tắt chuyển động', () => {
    const ink = rules.find((r) => r.media === null && r.selector === '.tab-ink')!;
    expect(declValue(ink.body, 'transition')).toMatch(/^transform /);
    expect(declValue(ink.body, 'background')).toBe('var(--primary)');
    expect(declValue(rules.find((r) => r.selector === `${OFF} .tab-ink`)!.body, 'transition')).toBe('none');
    expect(declValue(rules.find((r) => r.media === REDUCE && r.selector === `${SYSTEM} .tab-ink`)!.body, 'transition')).toBe('none');
  });

  it('hộp thoại không GIỮ transform sau khi mở (popover fixed bên trong không bị cắt)', () => {
    const open = rules.find((r) => r.media === null && r.selector === ".dialog-viewport > [data-state='open']")!;
    const animation = declValue(open.body, 'animation')!;
    expect(animation).toMatch(/\bbackwards\b/);
    expect(animation).not.toMatch(/\b(both|forwards)\b/);
  });
});
