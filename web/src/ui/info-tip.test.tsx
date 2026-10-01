import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { Dialog } from '@/ui/dialog';
import { InfoTip } from '@/ui/info-tip';
import { FormSection, Field, PageHeader } from '@/ui/page-header';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

const TIP = 'Mã do hệ thống cấp, không sửa được.';

describe('InfoTip — nút (i) giải thích ngắn', () => {
  it('là một <button> thật, tên riêng theo chủ đề, aria-expanded + aria-controls trỏ đúng bong bóng', async () => {
    const user = userEvent.setup();
    renderWithI18n(<InfoTip subject="Mã thiết bị">{TIP}</InfoTip>);

    const button = screen.getByRole('button', { name: 'Giải thích: Mã thiết bị' });
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const controls = button.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(screen.queryByText(TIP)).not.toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const bubble = screen.getByText(TIP);
    expect(bubble.closest(`[id="${controls}"]`)).not.toBeNull();
  });

  it('bàn phím: Enter mở, Enter lần nữa đóng, Space mở, Escape đóng và giữ tiêu điểm ở nút', async () => {
    const user = userEvent.setup();
    renderWithI18n(<InfoTip subject="Mã thiết bị">{TIP}</InfoTip>);
    const button = screen.getByRole('button', { name: 'Giải thích: Mã thiết bị' });

    button.focus();
    // Tiêu điểm bàn phím chưa mở — chỉ Enter/Space (hay rê chuột) mới mở.
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard(' ');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(TIP)).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('chuột: rê vào là hiện, rời ra là ẩn; đã bấm ghim thì rời ra vẫn còn', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderWithI18n(<InfoTip subject="Mã thiết bị">{TIP}</InfoTip>);
      const button = screen.getByRole('button', { name: 'Giải thích: Mã thiết bị' });

      fireEvent.pointerEnter(button, { pointerType: 'mouse' });
      expect(button).toHaveAttribute('aria-expanded', 'true');
      fireEvent.pointerLeave(button, { pointerType: 'mouse' });
      await vi.advanceTimersByTimeAsync(500);
      expect(button).toHaveAttribute('aria-expanded', 'false');

      fireEvent.pointerEnter(button, { pointerType: 'mouse' });
      fireEvent.click(button);
      fireEvent.pointerLeave(button, { pointerType: 'mouse' });
      await vi.advanceTimersByTimeAsync(500);
      expect(button).toHaveAttribute('aria-expanded', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('chạm (touch) không mở theo "rê" — chỉ cú chạm mới mở, để khỏi mở rồi đóng ngay', () => {
    renderWithI18n(<InfoTip subject="Mã thiết bị">{TIP}</InfoTip>);
    const button = screen.getByRole('button', { name: 'Giải thích: Mã thiết bị' });
    fireEvent.pointerEnter(button, { pointerType: 'touch' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('bấm ra ngoài hoặc rời tiêu điểm thì đóng', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <div>
        <InfoTip subject="Mã thiết bị">{TIP}</InfoTip>
        <button type="button">Khác</button>
      </div>,
    );
    const button = screen.getByRole('button', { name: 'Giải thích: Mã thiết bị' });

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(document.body);
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Khác' })).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  /**
   * Trong hộp thoại: bong bóng phải nằm trong điểm neo popover của `Dialog` — đó là cách
   * `Dialog` biết "đang có popover mở" để Escape chỉ đóng bong bóng chứ không đóng cả hộp.
   */
  it('trong Dialog: Escape đóng bong bóng, KHÔNG đóng hộp', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    renderWithI18n(
      <Dialog open onOpenChange={onOpenChange} title="Sửa thiết bị">
        <InfoTip subject="Mã thiết bị">{TIP}</InfoTip>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    const button = screen.getByRole('button', { name: 'Giải thích: Mã thiết bị' });

    await user.click(button);
    expect(dialog).toContainElement(screen.getByText(TIP));

    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('FormSection titleTip · Field tip', () => {
  it('PageHeader titleTip: nút (i) cạnh <h1>, NGOÀI thẻ h1 — tên tiêu đề không lẫn chữ của nút', async () => {
    renderWithI18n(<PageHeader title="Tài khoản dịch vụ" titleTip="Khai email dùng chung." />);
    const heading = screen.getByRole('heading', { level: 1, name: 'Tài khoản dịch vụ' });
    const tipButton = screen.getByRole('button', { name: 'Giải thích: Tài khoản dịch vụ' });
    expect(heading.contains(tipButton)).toBe(false);
    await userEvent.click(tipButton);
    expect(screen.getByText('Khai email dùng chung.')).toBeInTheDocument();
  });

  it('PageHeader không có titleTip thì không có nút (i)', () => {
    renderWithI18n(<PageHeader title="Thiết bị" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('FormSection vẽ InfoTip sau tiêu đề; tên của tiêu đề không bị lẫn chữ của nút', () => {
    renderWithI18n(
      <FormSection title="Bảo hành" titleTip="Tính từ ngày mua nếu trống.">
        <span />
      </FormSection>,
    );
    expect(screen.getByRole('heading', { name: 'Bảo hành' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Giải thích: Bảo hành' })).toBeInTheDocument();
  });

  it('Field vẽ InfoTip sau nhãn, NGOÀI thẻ <label>: tên trợ năng của ô vẫn đúng nhãn', () => {
    renderWithI18n(
      <Field label="Serial" tip="In trên tem máy.">
        <input />
      </Field>,
    );
    expect(screen.getByLabelText('Serial', { exact: true })).toHaveProperty('tagName', 'INPUT');
    const tipButton = screen.getByRole('button', { name: 'Giải thích: Serial' });
    expect(tipButton.closest('label')).toBeNull();
  });

  it('không truyền tip thì không có nút (i)', () => {
    renderWithI18n(
      <Field label="Serial">
        <input />
      </Field>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
