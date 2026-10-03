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

function AnchoredHarness() {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <div>
      <span ref={setAnchor}>
        <button type="button" onClick={() => setOpen(true)}>
          Thao tác khác
        </button>
      </span>
      <Popover label="Chèn tủ" title="Chọn tủ" open={open} onOpenChange={setOpen} anchor={anchor}>
        <input aria-label="Tìm tủ" />
      </Popover>
    </div>
  );
}

describe('Popover prop anchor — mở từ một mục menu, neo vào chỗ khác', () => {
  it('không vẽ nút riêng; mở thì tiêu điểm vào ô đầu; Esc đóng và trả tiêu điểm về nút trong điểm neo', async () => {
    renderWithI18n(<AnchoredHarness />);
    const user = userEvent.setup();
    expect(screen.queryByRole('button', { name: 'Chèn tủ' })).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Thao tác khác' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Chọn tủ' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Tìm tủ' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
