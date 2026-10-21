import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { FoldSection } from '@/ui/fold-section';

/** Khối gập của form dài (Q-27): mặc định gập, mở khi đã có giá trị hoặc khi có lỗi bên trong. */
describe('FoldSection', () => {
  it('mặc định gập: ô bên trong không tới được; bấm tiêu đề thì mở', async () => {
    renderWithI18n(
      <FoldSection title="Mua sắm và bảo hành" summary="nhà cung cấp, ngày mua" count="0/5">
        <label>Ngày mua<input /></label>
      </FoldSection>,
    );
    const head = screen.getByRole('button', { name: /^Mua sắm và bảo hành/ });
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Ngày mua' })).toBeNull();
    // Ô vẫn ở trong DOM (ẩn): hộp thoại đo "đang gõ dở" bằng các ô trong thân hộp.
    expect(document.querySelector('input')).not.toBeNull();
    await userEvent.setup().click(head);
    expect(head).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Ngày mua' })).toBeVisible();
  });

  it('tên nút mang cả tóm tắt và số đếm', () => {
    renderWithI18n(<FoldSection title="Ghi chú" count="trống"><p>x</p></FoldSection>);
    expect(screen.getByRole('button', { name: 'Ghi chú trống' })).toBeInTheDocument();
  });

  it('defaultOpen: mở sẵn', () => {
    renderWithI18n(<FoldSection title="Người dùng" defaultOpen><label>Người dùng<input /></label></FoldSection>);
    expect(screen.getByRole('textbox', { name: 'Người dùng' })).toBeVisible();
  });

  it('forceOpen (có lỗi bên trong): mở và không gập lại được', async () => {
    renderWithI18n(<FoldSection title="Ghi chú" forceOpen><label>Ghi chú<textarea /></label></FoldSection>);
    const head = screen.getByRole('button', { name: /^Ghi chú/ });
    expect(head).toHaveAttribute('aria-expanded', 'true');
    await userEvent.setup().click(head);
    expect(screen.getByRole('textbox', { name: 'Ghi chú' })).toBeVisible();
  });
});
