import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { Popover } from './popover';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p>Ngoài hộp</p>
      <Popover label="Thiết bị kho" title="Chèn thiết bị" open={open} onOpenChange={setOpen}>
        <input aria-label="Tìm" />
      </Popover>
    </div>
  );
}

describe('Popover — hộp nổi gọn neo vào nút', () => {
  it('bấm nút mở hộp (không modal), tiêu điểm vào ô đầu; Esc đóng và trả tiêu điểm về nút', async () => {
    renderWithI18n(<Harness />);
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: 'Thiết bị kho' });
    await user.click(button);
    expect(screen.getByRole('dialog', { name: 'Chèn thiết bị' })).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Tìm' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('bấm ra ngoài hoặc tiêu điểm rời cửa sổ (bấm vào iframe trình vẽ) thì đóng', async () => {
    renderWithI18n(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Thiết bị kho' }));
    await user.click(screen.getByText('Ngoài hộp'));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Thiết bị kho' }));
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('bấm trong hộp không đóng hộp', async () => {
    renderWithI18n(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Thiết bị kho' }));
    await user.click(screen.getByRole('textbox', { name: 'Tìm' }));
    expect(screen.getByRole('dialog', { name: 'Chèn thiết bị' })).toBeInTheDocument();
  });
});
