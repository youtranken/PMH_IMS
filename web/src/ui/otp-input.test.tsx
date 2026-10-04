import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import {
  OTP_MIN_SPIN_MS,
  OTP_SUCCESS_FALLBACK_MS,
  OtpInput,
  useOtpSuccess,
  type OtpStatus,
} from '@/ui/otp-input';
import { act, fireEvent, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';

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

describe('OtpInput — lớp trạng thái cho chuyển động', () => {
  it('có lỗi → hàng ô mang is-error (lắc + đỏ); hết lỗi → bỏ, để lượt sai sau lắc lại', () => {
    const { rerender } = renderWithI18n(<Harness error="Mã không đúng" />);
    expect(group()).toHaveClass('is-error');
    rerender(<Harness />);
    expect(group()).not.toHaveClass('is-error');
  });

  it('ô đã có số mang is-filled, ô trống thì không', () => {
    renderWithI18n(<Harness initial="12" />);
    const all = boxes();
    expect(all[0]).toHaveClass('is-filled');
    expect(all[1]).toHaveClass('is-filled');
    expect(all[2]).not.toHaveClass('is-filled');
  });

  it('đủ 6 số và đang gửi (readOnly) → is-busy; chưa đủ số thì không', () => {
    const { unmount } = renderWithI18n(<Harness initial="123456" readOnly />);
    expect(group()).toHaveClass('is-busy');
    unmount();
    renderWithI18n(<Harness initial="123" readOnly />);
    expect(group()).not.toHaveClass('is-busy');
  });
});

/**
 * Trạng thái quanh lượt gửi: đang kiểm (6 ô xoay), thành công (gộp thành 1 ô có dấu tích, nơi gọi
 * chỉ đi tiếp sau khi hiệu ứng xong), sai (về 6 ô, lắc + đỏ).
 */
function SuccessHarness({ proceed, error, status }: { proceed: () => void; error?: string; status?: OtpStatus }) {
  const otp = useOtpSuccess();
  return (
    <>
      <OtpInput
        value="123456"
        onChange={() => undefined}
        label="Mã xác thực"
        error={error}
        status={otp.status ?? status}
        onSuccessShown={otp.onShown}
      />
      <button type="button" onClick={() => void otp.show().then(proceed)}>
        ok
      </button>
    </>
  );
}

const checkMark = () => document.querySelector('.otp-check-mark') as Element;

describe('OtpInput — đang kiểm / thành công / sai', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('status verifying → is-busy + aria-busy', () => {
    renderWithI18n(<SuccessHarness proceed={() => undefined} status="verifying" />);
    expect(group()).toHaveClass('is-busy');
    expect(group()).toHaveAttribute('aria-busy', 'true');
  });

  it('có lỗi thì thôi xoay: is-error, không is-busy', () => {
    renderWithI18n(<SuccessHarness proceed={() => undefined} status="verifying" error="Sai mã" />);
    expect(group()).toHaveClass('is-error');
    expect(group()).not.toHaveClass('is-busy');
    expect(group()).not.toHaveAttribute('aria-busy');
  });

  it('thành công → xoay trọn một vòng, rồi gộp 1 ô + báo "Đã xác thực"; đi tiếp chỉ SAU khi vẽ xong dấu tích', async () => {
    vi.stubGlobal('AnimationEvent', class {});
    vi.useFakeTimers();
    const proceed = vi.fn();
    renderWithI18n(<SuccessHarness proceed={proceed} />);
    fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    // Server đã nhận mã nhưng ô vẫn xoay đủ một vòng rồi mới gộp — kẻo không ai kịp thấy.
    expect(group()).toHaveClass('is-busy');
    expect(group()).not.toHaveClass('is-success');
    await act(async () => {
      vi.advanceTimersByTime(OTP_MIN_SPIN_MS);
    });
    vi.useRealTimers();
    expect(group()).toHaveClass('is-success');
    expect(screen.getByRole('status')).toHaveTextContent('Đã xác thực');
    await act(async () => {});
    expect(proceed).not.toHaveBeenCalled();
    await act(async () => {
      // `AnimationEvent` đang là bản giả nên dựng sự kiện gốc.
      checkMark().dispatchEvent(new Event('animationend', { bubbles: true }));
    });
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('không nhận được animationend → vẫn đi tiếp nhờ hẹn giờ dự phòng (không kẹt đăng nhập)', async () => {
    vi.stubGlobal('AnimationEvent', class {});
    vi.useFakeTimers();
    const proceed = vi.fn();
    renderWithI18n(<SuccessHarness proceed={proceed} />);
    fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    await act(async () => {
      vi.advanceTimersByTime(OTP_MIN_SPIN_MS + 500);
    });
    expect(proceed).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(OTP_SUCCESS_FALLBACK_MS);
    });
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('không có animation CSS (AnimationEvent) → đi tiếp ngay', async () => {
    const proceed = vi.fn();
    renderWithI18n(<SuccessHarness proceed={proceed} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    });
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('"giảm chuyển động" → hiện dấu tích và đi tiếp ngay, không chờ hiệu ứng', async () => {
    vi.stubGlobal('AnimationEvent', class {});
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    const proceed = vi.fn();
    renderWithI18n(<SuccessHarness proceed={proceed} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ok' }));
    });
    expect(group()).toHaveClass('is-success');
    expect(proceed).toHaveBeenCalledTimes(1);
  });
});
