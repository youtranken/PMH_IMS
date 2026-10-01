import { describe, expect, it } from 'vitest';
import { cssRules, declValue } from './css-test-kit';

/**
 * Trang cuộn theo CỬA SỔ, và `.topbar` (base.css) dính `top: 0` cao 56px. Mọi khối dính khác
 * trong trang mà cũng `top` < 56px thì khi cuộn sẽ chui vào cùng dải đó: z-index cao hơn topbar
 * thì đè lên topbar (thanh tab của màn Quyền két sắt che mất ô tìm Ctrl+K), thấp hơn thì phần
 * đầu của nó bị topbar nuốt (thẻ định danh cột phải trang chi tiết mất tiêu đề).
 *
 * Ngoại lệ là khối dính trong một KHUNG CUỘN RIÊNG (tiêu đề lưới ma trận trong `.access-grid-wrap`,
 * chân hộp thoại): `top` của chúng tính theo khung đó, không theo cửa sổ.
 */
const FILES = ['base.css', 'detail-tabs.css', 'primitives.css', 'shared-kit.css', 'table.css', 'form-layout.css'];

/** Dính trong khung cuộn riêng, hoặc chính là topbar / sidebar. */
const OWN_SCROLLER = new Set(['.topbar', '.sidebar', 'table.access-grid thead th']);

const stickyTop = FILES.flatMap((file) =>
  cssRules(file)
    .filter((rule) => declValue(rule.body, 'position') === 'sticky' && declValue(rule.body, 'top') !== undefined)
    .map((rule) => ({ file, selector: rule.selector, top: declValue(rule.body, 'top') as string })),
);

describe('khối dính trong trang không chui vào dải topbar', () => {
  it('có ít nhất các khối dính đã biết (bài không rỗng)', () => {
    const selectors = stickyTop.map((rule) => rule.selector);
    expect(selectors).toContain('.tabs');
    expect(selectors).toContain('.detail-rail');
  });

  it.each(stickyTop.filter((rule) => !OWN_SCROLLER.has(rule.selector)))(
    '$file $selector: top tính từ dưới topbar 56px',
    ({ top }) => {
      expect(top).toMatch(/56px/);
    },
  );
});
