import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { ConfirmProvider } from './confirm-provider';
import { Dialog } from './dialog';
import { Field } from './page-header';
import { PhoneInput, filterPhoneTyping } from './phone-input';

/** Q-18: chỉ chữ số, dấu + ở đầu và dấu cách — ký tự khác không vào được ô. */
describe('filterPhoneTyping', () => {
  it.each([
    ['0912 345 678', '0912 345 678'],
    ['+84 912 345 678', '+84 912 345 678'],
    ['(028) 3822-1234', '028 38221234'],
    ['0912.345.678', '0912345678'],
    ['84+912', '84912'],
    ['++84', '+84'],
    ['  +84', '+84'],
    ['gọi 0909', ' 0909'],
    ['', ''],
  ])('"%s" → "%s"', (input, expected) => {
    expect(filterPhoneTyping(input)).toBe(expected);
  });
});

function Harness({ error }: { error?: string }) {
  const [value, setValue] = useState('');
  return (
    <Field label="Số điện thoại" hint="Chữ số, + ở đầu" htmlFor="phone" error={error}>
      <PhoneInput value={value} onChange={setValue} />
    </Field>
  );
}

describe('PhoneInput', () => {
  it('bàn phím số trên điện thoại; nhãn và gợi ý của Field nối vào ô thật', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Số điện thoại');
    expect(input).toHaveAttribute('inputmode', 'tel');
    expect(input).toHaveAttribute('type', 'tel');
    expect(input).toHaveAttribute('aria-describedby', 'phone-hint');
  });

  it('gõ lẫn chữ và ký tự lạ thì ô chỉ giữ số, dấu + đầu và dấu cách', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('Số điện thoại');
    await userEvent.type(input, '+84 (28) 3822-12a34');
    expect(input).toHaveValue('+84 28 38221234');
  });

  it('lỗi của Field gắn vào ô', () => {
    render(<Harness error="Số điện thoại không hợp lệ" />);
    expect(screen.getByLabelText('Số điện thoại')).toHaveAttribute('aria-invalid', 'true');
  });
});

/**
 * Rời ô thì ô tách nhóm số ("0901234567" → "0901 234 567"). `Dialog guardUnsaved` so chữ ký
 * các ô native, nên nếu nó so chữ thô thì chỉ cần Tab đi ngang qua ô là hộp tưởng đã bị sửa —
 * mở form sửa, không đổi gì, Esc cũng bị hỏi "Bỏ những gì vừa nhập?".
 */
describe('PhoneInput trong hộp guardUnsaved', () => {
  function EditHarness({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
    const [value, setValue] = useState('0901234567');
    const [note, setNote] = useState('');
    return (
      <ConfirmProvider>
        <Dialog open onOpenChange={onOpenChange} guardUnsaved title="Sửa nhà mạng">
          <Field label="Số điện thoại" htmlFor="phone">
            <PhoneInput value={value} onChange={setValue} />
          </Field>
          <input aria-label="Ghi chú" value={note} onChange={(e) => setNote(e.target.value)} />
        </Dialog>
      </ConfirmProvider>
    );
  }

  it('Tab qua ô số chưa sửa rồi Esc: đóng thẳng, không hỏi', async () => {
    const onOpenChange = vi.fn();
    renderWithI18n(<EditHarness onOpenChange={onOpenChange} />);
    const input = screen.getByLabelText('Số điện thoại');
    await userEvent.click(input);
    await userEvent.tab();
    expect(input).toHaveValue('0901 234 567');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Bỏ những gì vừa nhập?')).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('đổi số thật rồi Esc: vẫn hỏi lại', async () => {
    const onOpenChange = vi.fn();
    renderWithI18n(<EditHarness onOpenChange={onOpenChange} />);
    const input = screen.getByLabelText('Số điện thoại');
    await userEvent.clear(input);
    await userEvent.type(input, '0909999999');
    await userEvent.tab();
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText('Bỏ những gì vừa nhập?')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
