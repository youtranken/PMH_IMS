import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { OtpInput } from '@/ui/otp-input';
import { fireEvent, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';

/**
 * Ô mã 2 lớp là 6 ô riêng, mỗi ô một số (Q-21). Người dùng chép từng số từ ứng dụng xác thực,
 * nên con trỏ phải tự đi tới ô kế, xoá lùi được, và dán/tự điền cả mã vào bất kỳ ô nào.
 */

function Harness({
  initial = '',
  onComplete,
  error,
  readOnly,
}: {
  initial?: string;
  onComplete?: (code: string) => void;
  error?: string;
  readOnly?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <OtpInput
        value={value}
        onChange={setValue}
        label="Mã xác thực"
        onComplete={onComplete}
        error={error}
        readOnly={readOnly}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const group = () => screen.getByRole('group', { name: 'Mã xác thực' });
const boxes = () => within(group()).getAllByRole('textbox') as HTMLInputElement[];
const shown = () => screen.getByTestId('value').textContent;

describe('OtpInput — 6 ô riêng', () => {
  it('một nhóm mang tên nhãn, 6 ô "Số thứ N trên 6"; ô đầu nhận tự điền mã một lần', () => {
    renderWithI18n(<Harness />);
    const all = boxes();
    expect(all).toHaveLength(6);
    all.forEach((box, i) => expect(box).toHaveAccessibleName(`Số thứ ${i + 1} trên 6`));
    expect(all[0]).toHaveAttribute('autocomplete', 'one-time-code');
    all.forEach((box) => expect(box).toHaveAttribute('inputmode', 'numeric'));
    expect(all[1]).toHaveAttribute('autocomplete', 'off');
    expect(all[0]).toHaveFocus();
  });

  it('gõ một số → sang ô kế; bỏ qua chữ không phải số', async () => {
    renderWithI18n(<Harness />);
    await userEvent.type(boxes()[0], '1a2');
    expect(shown()).toBe('12');
    expect(boxes()[0]).toHaveValue('1');
    expect(boxes()[1]).toHaveValue('2');
    expect(boxes()[2]).toHaveFocus();
  });

  it('Backspace ở ô trống → lùi về ô trước và xoá nó', async () => {
    renderWithI18n(<Harness />);
    await userEvent.type(boxes()[0], '123');
    expect(boxes()[3]).toHaveFocus();
    await userEvent.keyboard('{Backspace}');
    expect(shown()).toBe('12');
    expect(boxes()[2]).toHaveFocus();
    await userEvent.keyboard('{Backspace}{Backspace}');
    expect(shown()).toBe('');
    expect(boxes()[0]).toHaveFocus();
  });

  it('Backspace ở ô đang có số → xoá chính ô đó, con trỏ đứng yên', async () => {
    renderWithI18n(<Harness initial="123456" />);
    boxes()[5].focus();
    await userEvent.keyboard('{Backspace}');
    expect(shown()).toBe('12345');
    expect(boxes()[5]).toHaveFocus();
  });

  it('←/→, Home/End di chuyển giữa các ô; gõ đè ô giữa thay đúng số đó', async () => {
    renderWithI18n(<Harness initial="123456" />);
    boxes()[2].focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(boxes()[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(boxes()[3]).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(boxes()[0]).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(boxes()[5]).toHaveFocus();
    boxes()[2].focus();
    await userEvent.keyboard('9');
    expect(shown()).toBe('129456');
    expect(boxes()[3]).toHaveFocus();
  });

  it('→ không vượt quá ô trống đầu tiên (mã không có lỗ hổng)', async () => {
    renderWithI18n(<Harness initial="12" />);
    boxes()[1].focus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{End}');
    expect(boxes()[2]).toHaveFocus();
  });

  it('dán "123 456" vào ô bất kỳ → đủ 6 ô, gọi onComplete một lần', async () => {
    const onComplete = vi.fn();
    renderWithI18n(<Harness onComplete={onComplete} />);
    boxes()[3].focus();
    await userEvent.paste('123 456');
    expect(shown()).toBe('123456');
    expect(boxes().map((b) => b.value)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
    expect(boxes()[5]).toHaveFocus();
  });

  it('tự điền (iOS/Android, trình quản lý mật khẩu) đổ cả mã vào ô đầu → chia đủ 6 ô', () => {
    const onComplete = vi.fn();
    renderWithI18n(<Harness onComplete={onComplete} />);
    fireEvent.change(boxes()[0], { target: { value: '654321' } });
    expect(shown()).toBe('654321');
    expect(onComplete).toHaveBeenCalledWith('654321');
  });

  it('bấm vào ô trống phía sau → con trỏ về ô trống đầu tiên', async () => {
    renderWithI18n(<Harness initial="1" />);
    await userEvent.click(boxes()[4]);
    expect(boxes()[1]).toHaveFocus();
  });

  it('lỗi: nhóm trỏ tới câu lỗi, mọi ô aria-invalid', () => {
    renderWithI18n(<Harness error="Còn thiếu 2 số." />);
    const err = screen.getByRole('alert');
    expect(group()).toHaveAttribute('aria-describedby', err.id);
    expect(group()).toHaveAccessibleDescription('Còn thiếu 2 số.');
    boxes().forEach((b) => expect(b).toHaveAttribute('aria-invalid', 'true'));
  });

  it('readOnly: gõ và dán không đổi mã', async () => {
    renderWithI18n(<Harness initial="12" readOnly />);
    boxes()[2].focus();
    await userEvent.keyboard('3{Backspace}');
    await userEvent.paste('999999');
    expect(shown()).toBe('12');
  });
});
