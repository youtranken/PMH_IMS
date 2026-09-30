import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
