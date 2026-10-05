import { afterEach, describe, expect, it } from 'vitest';
import { cssRules, declValue, readCss } from '@/test/css-test-kit';
import { readCablePalette } from '@/ui/drawio-frame';

/**
 * V-05: giấy bản vẽ luôn SÁNG ở cả hai theme (`--diagram-paper`), nên nét dây trên giấy — trong trình
 * vẽ, trình xem và chú giải nổi trên trình xem — phải dùng CÙNG bộ màu của giấy. Trước đây chú giải
 * lấy token tối (Cat6 xanh nhạt) trong khi nét trên giấy trắng là màu đậm: chú giải không khớp thứ
 * nó chú thích.
 */

const SLOTS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', 'warn', 'danger'];

function tokenBlock(theme: 'light' | 'dark'): Map<string, string> {
  const css = readCss('tokens.css');
  const start = theme === 'light' ? css.indexOf(':root {') : css.indexOf("html[data-theme='dark'] {");
  const end = css.indexOf('\n}', start);
  const out = new Map<string, string>();
  for (const m of css.slice(start, end).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

describe('màu dây trên giấy bản vẽ (V-05)', () => {
  afterEach(() => document.documentElement.removeAttribute('style'));

  it('mỗi ô màu có token giấy `--paper-cable-*`; bản tối GIỮ giá trị sáng (giấy luôn sáng)', () => {
    const light = tokenBlock('light');
    const dark = tokenBlock('dark');
    for (const slot of SLOTS) {
      const name = `--paper-cable-${slot}`;
      expect(light.get(name), name).toMatch(/^#[0-9a-f]{6}$/i);
      expect(dark.get(name), name).toBe(light.get(name));
      // Bộ màu giấy = bộ màu dây của theme SÁNG (thứ draw.io vẽ lúc lưu).
      expect(light.get(name), name).toBe(light.get(`--diagram-cable-${slot}`));
    }
    expect(dark.get('--paper-ink')).toBe(light.get('--paper-ink'));
  });

  it('trình xem và chú giải nổi đọc màu dây của giấy, chú giải nổi nằm trên nền giấy', () => {
    for (const selector of ['.diagram-viewer-canvas', '.cable-legend']) {
      const rule = cssRules('primitives.css').find((r) => r.selector.split(',').map((s) => s.trim()).includes(selector) && r.media === null && declValue(r.body, '--diagram-cable-1'));
      expect(rule, selector).toBeDefined();
      for (const slot of SLOTS) expect(declValue(rule!.body, `--diagram-cable-${slot}`), `${selector} ${slot}`).toBe(`var(--paper-cable-${slot})`);
    }
    const legend = cssRules('primitives.css').find((r) => r.selector === '.cable-legend' && r.media === null && declValue(r.body, 'background'));
    expect(declValue(legend!.body, 'background')).toBe('var(--diagram-paper)');
    expect(declValue(legend!.body, 'color')).toBe('var(--paper-ink)');
  });

  it('trình vẽ tô nét dây bằng màu giấy, không bằng màu của theme đang dùng', () => {
    document.documentElement.style.setProperty('--diagram-cable-1', '#34d399');
    document.documentElement.style.setProperty('--paper-cable-1', '#0e9f6e');
    expect(readCablePalette()['cable-1']).toBe('0E9F6E');
  });
});
