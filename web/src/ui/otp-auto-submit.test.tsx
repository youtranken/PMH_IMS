import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { OtpInput, otpJustCompleted } from '@/ui/otp-input';
import { StepUpDialog } from '@/ui/step-up-dialog';
import { fireEvent, jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * Ô mã 6 số TỰ GỬI khi đủ 6 số (VLT-FLOW) — người duyệt trên điện thoại chép mã từ ứng dụng
 * xác thực rồi dán, không phải tìm nút nữa.
 *
 * Cái giá phải canh: GỬI HAI LẦN. Mã TOTP chỉ dùng được một lần (chống replay), nên lượt thứ hai
 * của cùng mã bị server coi là mã sai — người dùng đang đúng lại thấy "mã không đúng", và tệ hơn
 * là bị trừ một lượt trước khi phiên bị thu hồi.
 */

describe('otpJustCompleted — chỉ đúng lượt gõ làm ô ĐỦ 6 số', () => {
  it.each([
    ['', '1', false],
    ['12345', '123456', true],
    ['', '123456', true],
    ['123456', '123456', false],
    ['123456', '12345', false],
    ['12345', '12345', false],
  ])('%j → %j: %s', (prev, next, expected) => {
    expect(otpJustCompleted(prev, next)).toBe(expected);
  });
});

function Harness({ onComplete }: { onComplete: (code: string) => void }) {
  const [value, setValue] = useState('');
  return <OtpInput value={value} onChange={setValue} label="Mã xác thực" onComplete={onComplete} />;
}

describe('OtpInput onComplete', () => {
  it('gõ đủ 6 số → gọi đúng MỘT lần với mã đó; gõ thêm không gọi lại', async () => {
    const onComplete = vi.fn();
    renderWithI18n(<Harness onComplete={onComplete} />);
    const input = screen.getByLabelText('Mã xác thực');
    await userEvent.type(input, '1234567');
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('dán cả mã (kèm khoảng trắng) → một lần, mã đã lọc số', () => {
    const onComplete = vi.fn();
    renderWithI18n(<Harness onComplete={onComplete} />);
    fireEvent.change(screen.getByLabelText('Mã xác thực'), { target: { value: '123 456' } });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('chưa đủ 6 số → không gọi', async () => {
    const onComplete = vi.fn();
    renderWithI18n(<Harness onComplete={onComplete} />);
    await userEvent.type(screen.getByLabelText('Mã xác thực'), '12345');
    expect(onComplete).not.toHaveBeenCalled();
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('StepUpDialog tự gửi — không bao giờ hai lượt cho một mã', () => {
  it('đủ 6 số là gửi; bấm Xác nhận / Enter trong lúc đang gửi không sinh lượt thứ hai', async () => {
    let release: (value: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    renderWithI18n(<StepUpDialog csrfToken="csrf-1" onClose={vi.fn()} onDone={onDone} />);

    const input = screen.getByLabelText('Mã xác thực');
    await userEvent.type(input, '123456');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Lượt đầu còn đang bay: Enter và nút đều không được gửi thêm.
    fireEvent.submit(input.closest('form')!);
    fireEvent.submit(input.closest('form')!);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(jsonResponse(200, { graceMinutes: 10 }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mã sai → ô xoá trắng, gõ mã mới đủ 6 số thì gửi lượt MỚI (khoá đã nhả)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { code: 'TOTP_INVALID', message: 'Mã không đúng.' }))
      .mockResolvedValueOnce(jsonResponse(200, { graceMinutes: 10 }));
    vi.stubGlobal('fetch', fetchMock);
    const onDone = vi.fn();
    renderWithI18n(<StepUpDialog csrfToken="csrf-1" onClose={vi.fn()} onDone={onDone} />);

    const input = screen.getByLabelText('Mã xác thực');
    await userEvent.type(input, '111111');
    expect(await screen.findByText('Mã không đúng.')).toBeInTheDocument();
    expect(input).toHaveValue('');

    await userEvent.type(input, '222222');
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(10));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies).toEqual([{ token: '111111' }, { token: '222222' }]);
  });
});
