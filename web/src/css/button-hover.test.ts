import { describe, expect, it } from 'vitest';
import { cmpSpec as cmp, cssRules, specificity } from './css-test-kit';

/**
 * Nền hover CHUNG của nút (`surface-2`, gần trắng ở theme sáng) không được thắng luật của chính
 * component. Nếu nó thắng, nút nền trong suốt trên mặt tối — tiêu đề nhóm sidebar, link trên card
 * đăng nhập, nút × của toast — hover ra ô sáng với chữ sáng, đọc không được.
 *
 * jsdom không tính cascade, nên tính độ ưu tiên của selector thật trong CSS rồi so.
 */

/** Mọi selector (đã tách dấu phẩy) có khai `background` ở mức gốc của file. */
function backgroundSelectors(file: string): string[] {
  return cssRules(file)
    .filter((r) => r.media === null && /(^|;|\s)background(-color)?\s*:/.test(r.body))
    .map((r) => r.selector);
}

const globalHover = backgroundSelectors('base.css').filter((s) => /^button\b/.test(s) && s.includes(':hover') && !/[.[]/.test(s.replace(/:\w+\([^)]*\)/g, '')));

describe('base.css — nền hover chung của <button>', () => {
  it('chỉ có một luật hover chung, độ ưu tiên (0,0,1): thua mọi luật có class', () => {
    expect(globalHover).toHaveLength(1);
    expect(specificity(globalHover[0])).toEqual([0, 0, 1]);
  });

  it('bộ tính độ ưu tiên đúng với vài mẫu đã biết', () => {
    expect(specificity('button:hover:not(:disabled)')).toEqual([0, 2, 1]);
    expect(specificity('button:where(:hover:not(:disabled))')).toEqual([0, 0, 1]);
    expect(specificity('.nav-group-toggle')).toEqual([0, 1, 0]);
  });

  it.each([
    ['shell.css', '.nav-group-toggle'],
    ['auth.css', '.auth-link'],
    ['shared-kit.css', '.toast-close'],
  ])('%s %s: nền trong suốt của component thắng hover chung', (file, selector) => {
    const own = backgroundSelectors(file).find((s) => s === selector);
    expect(own, `${selector} phải tự khai background`).toBeDefined();
    expect(cmp(specificity(own!), specificity(globalHover[0]))).toBeGreaterThan(0);
  });
});
