import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { Field } from '@/ui/page-header';
import { NumberStepper, stepValue } from '@/ui/number-stepper';

describe('stepValue', () => {
  it.each([
    // [ô đang có, bước, min, max, kết quả]
    ['', 1, 1, undefined, '1'],
    ['', 1, 4, undefined, '4'],
    ['', -1, 1, undefined, ''],
    ['3', 1, 1, undefined, '4'],
    ['3', -1, 1, undefined, '2'],
    ['1', -1, 1, undefined, '1'],
    ['4', -1, 4, undefined, '4'],
    ['2', 1, 4, undefined, '4'],
    ['2', -1, 4, undefined, '2'],
    ['60', 1, 1, 60, '60'],
    ['99', -1, 1, 60, '60'],
    ['abc', 1, 1, undefined, '1'],
    ['abc', -1, 1, undefined, 'abc'],
    [' 7 ', 1, 1, undefined, '8'],
  ] as const)('%j %i (min %i, max %s) → %j', (raw, delta, min, max, expected) => {
    expect(stepValue(raw, delta, min, max)).toBe(expected);
  });
});

function Harness({ initial = '', min = 1, max }: { initial?: string; min?: number; max?: number }) {
  const [value, setValue] = useState(initial);
  return (
    <Field label="Số ghế" htmlFor="seat">
      <NumberStepper value={value} onChange={setValue} min={min} max={max} label="số ghế" />
    </Field>
  );
}

describe('NumberStepper', () => {
  it('nút + / − có nhãn trợ năng, đổi giá trị từng bước', async () => {
    renderWithI18n(<Harness initial="3" />);
    const input = screen.getByLabelText('Số ghế');
    await userEvent.click(screen.getByRole('button', { name: 'Tăng số ghế' }));
    expect(input).toHaveValue('4');
    await userEvent.click(screen.getByRole('button', { name: 'Giảm số ghế' }));
    await userEvent.click(screen.getByRole('button', { name: 'Giảm số ghế' }));
    expect(input).toHaveValue('2');
  });

  it('nút − tắt ở số nhỏ nhất (vd số ghế đang dùng)', async () => {
    renderWithI18n(<Harness initial="4" min={4} />);
    expect(screen.getByRole('button', { name: 'Giảm số ghế' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tăng số ghế' })).toBeEnabled();
  });

  it('ô trống (không giới hạn): − tắt, + ra số nhỏ nhất', async () => {
    renderWithI18n(<Harness min={2} />);
    expect(screen.getByRole('button', { name: 'Giảm số ghế' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Tăng số ghế' }));
    expect(screen.getByLabelText('Số ghế')).toHaveValue('2');
  });

  it('nút + tắt ở số lớn nhất', () => {
    renderWithI18n(<Harness initial="60" max={60} />);
    expect(screen.getByRole('button', { name: 'Tăng số ghế' })).toBeDisabled();
  });

  it('mũi tên ↑/↓ trong ô cũng tăng/giảm, gõ tay vẫn giữ nguyên chữ', async () => {
    renderWithI18n(<Harness initial="5" />);
    const input = screen.getByLabelText('Số ghế');
    await userEvent.click(input);
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(input).toHaveValue('7');
    await userEvent.keyboard('{ArrowDown}');
    expect(input).toHaveValue('6');
    await userEvent.clear(input);
    await userEvent.type(input, '10 ghế');
    expect(input).toHaveValue('10 ghế');
  });

  it('Field nối nhãn vào ô thật (id + aria-describedby chuyển xuống <input>)', () => {
    renderWithI18n(
      <Field label="Số U" hint="1–60" error="Sai">
        <NumberStepper value="2" onChange={() => {}} min={1} label="số U" />
      </Field>,
    );
    const input = screen.getByLabelText('Số U');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toMatch(/hint/);
  });
});
