import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field } from './page-header';
import { MoneyInput } from './money-input';

function Harness({ error }: { error?: string }) {
  const [value, setValue] = useState('');
  return (
    <Field label="Chi phí" hint="Tiền đồng" htmlFor="cost" error={error}>
      <MoneyInput value={value} onChange={setValue} />
    </Field>
  );
}

describe('MoneyInput (SW-052)', () => {
  it('nhãn của Field nối vào ô thật, hậu tố ₫ hiện nhưng không vào tên trợ năng', () => {
    render(<Harness />);
    const input = screen.getByLabelText('Chi phí');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('aria-describedby', 'cost-hint');
    expect(screen.getByText('₫')).toHaveAttribute('aria-hidden', 'true');
  });

  it('rời ô thì viết lại có dấu chấm hàng nghìn; "5,6tr" thành 5.600.000', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('Chi phí');
    await userEvent.type(input, '5,6tr');
    await userEvent.tab();
    expect(input).toHaveValue('5.600.000');
  });

  it('chữ không hiểu được thì giữ nguyên để người dùng sửa; lỗi của Field gắn vào ô', async () => {
    render(<Harness error="Chi phí không hợp lệ" />);
    const input = screen.getByLabelText('Chi phí');
    await userEvent.type(input, 'năm triệu');
    await userEvent.tab();
    expect(input).toHaveValue('năm triệu');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });
});
