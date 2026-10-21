import { describe, expect, it, vi, afterEach } from 'vitest';
import { StepUpDialog } from '@/ui/step-up-dialog';
import { act, fireEvent, jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * CỬA KÉT PHẢI NÓI "CÒN MẤY LẦN NỮA".
 *
 * ===== VÌ SAO CẦN BÀI RIÊNG =====
 *
 * `errorMessage(err, fallback, nearLimit)` — tham số thứ ba ghép thêm câu cảnh báo "còn N lần
 * nữa là phiên bị thu hồi" khi server trả `attemptsLeft` nhỏ. Nó được đấu vào cửa này.
 *
 * Không có bài này thì gỡ hẳn tham số thứ ba ở `step-up-dialog.tsx` mà cả bộ web vẫn xanh.
 * Một hàng rào mà không đột biến nào làm đỏ được thì chưa phải hàng rào; nó là một lời hứa.
 *
 * ===== VÌ SAO NÓ ĐÁNG CÓ BÀI CANH =====
 *
 * Gõ sai mã step-up đủ số lần thì PHIÊN BỊ THU HỒI — người dùng văng ra màn đăng nhập giữa
 * chừng một việc đang làm dở. Câu "còn 1 lần nữa" là thứ duy nhất đứng giữa họ và cú văng đó.
 * Mất câu ấy thì màn hình vẫn báo "mã sai" rất bình thản, đúng tới lần cuối cùng.
 */

const ATTEMPTS_LEFT_WARNING = 'Còn 1 lần thử; sai hết thì phải đăng nhập lại.';

function mockStepUp(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse(status, body))),
  );
}

/** Đủ 6 số là ô tự gửi — bấm thêm nút là lượt thứ hai (bị chặn), và nút lúc đó đã thành "Đã xác thực". */
async function typeCodeAndSubmit(): Promise<void> {
  await userEvent.type(screen.getByLabelText('Mã xác thực'), '123456');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('StepUpDialog — câu trên ô mã', () => {
  it('không truyền `purpose` → câu TRUNG TÍNH, không nói "xem thông tin bí mật" (Q-20)', () => {
    renderWithI18n(<StepUpDialog csrfToken="t" scope="vault" onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText('Nhập mã 6 số trên điện thoại để xác nhận thao tác này.')).toBeInTheDocument();
    expect(screen.queryByText(/xem thông tin bí mật/)).toBeNull();
  });
});

describe('StepUpDialog — cảnh báo sắp hết lượt', () => {
  it('server trả `attemptsLeft` nhỏ → ghép thêm câu "còn mấy lần nữa"', async () => {
    mockStepUp(401, { code: 'STEP_UP_INVALID', message: 'Mã không đúng.', attemptsLeft: 1 });
    renderWithI18n(<StepUpDialog csrfToken="csrf-1" scope="vault" onClose={vi.fn()} onDone={vi.fn()} />);

    await typeCodeAndSubmit();

    expect(await screen.findByText(new RegExp(ATTEMPTS_LEFT_WARNING))).toBeInTheDocument();
  });

  it('còn NHIỀU lượt → chỉ câu lỗi trần, không doạ người dùng (vế đối chứng)', async () => {
    // Cảnh báo phải HIẾM mới có nghĩa. Bắn nó ở lần sai đầu tiên thì tới lần thứ ba người ta
    // đã thôi đọc — đúng lúc nó bắt đầu đúng.
    mockStepUp(401, { code: 'STEP_UP_INVALID', message: 'Mã không đúng.', attemptsLeft: 9 });
    renderWithI18n(<StepUpDialog csrfToken="csrf-1" scope="vault" onClose={vi.fn()} onDone={vi.fn()} />);

    await typeCodeAndSubmit();

    expect(await screen.findByText('Mã không đúng.')).toBeInTheDocument();
    expect(screen.queryByText(new RegExp('Còn .* lần thử'))).not.toBeInTheDocument();
  });

  it('server KHÔNG trả `attemptsLeft` → vẫn hiện câu lỗi, không bịa thêm gì', async () => {
    mockStepUp(401, { code: 'STEP_UP_INVALID', message: 'Mã không đúng.' });
    renderWithI18n(<StepUpDialog csrfToken="csrf-1" scope="vault" onClose={vi.fn()} onDone={vi.fn()} />);

    await typeCodeAndSubmit();

    expect(await screen.findByText('Mã không đúng.')).toBeInTheDocument();
  });
});

/**
 * AD-17: hộp nhập mã nói rõ đang mở PHẠM VI nào và gửi đúng phạm vi đó. Gửi thiếu `scope` thì
 * server trả 400; gửi nhầm `vault` khi đang mở sơ đồ thì mã sơ đồ thành mã mở két.
 */
describe('StepUpDialog — phạm vi két / sơ đồ', () => {
  function captureFetch() {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, { status: 'stepped-up', graceMinutes: 10 })));
    vi.stubGlobal('fetch', fetchMock);
    return () => {
      const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) =>
        String(url).includes('/api/v1/auth/step-up'),
      );
      return call ? (JSON.parse(String(call[1].body)) as Record<string, unknown>) : null;
    };
  }

  it.each(['vault', 'diagram'] as const)('gửi `scope: %s` kèm mã', async (scope) => {
    const sent = captureFetch();
    const onDone = vi.fn();
    renderWithI18n(<StepUpDialog csrfToken="c" scope={scope} onClose={vi.fn()} onDone={onDone} />);
    await typeCodeAndSubmit();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sent()).toEqual({ token: '123456', scope });
  });

  it('phạm vi sơ đồ không truyền `purpose` → câu nói "xem sơ đồ", không nói két', () => {
    renderWithI18n(<StepUpDialog csrfToken="t" scope="diagram" onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText('Nhập mã 6 số trên điện thoại để xem sơ đồ.')).toBeInTheDocument();
    expect(screen.getByText('Mã này chỉ mở phần xem sơ đồ, không mở két.')).toBeInTheDocument();
  });

  it('phạm vi két nói rõ mã không mở sơ đồ', () => {
    renderWithI18n(<StepUpDialog csrfToken="t" scope="vault" onClose={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByText('Mã này mở két và các thao tác cần mã, không mở phần xem sơ đồ.')).toBeInTheDocument();
  });

  it('ân hạn sơ đồ nói "mở bản vẽ khác", không nói "mở ngăn khác"', () => {
    renderWithI18n(
      <StepUpDialog csrfToken="t" scope="diagram" graceMinutes={7} onClose={vi.fn()} onDone={vi.fn()} />,
    );
    expect(screen.getByText('Xác nhận xong thì 7 phút tới mở bản vẽ khác không phải gõ lại.')).toBeInTheDocument();
    expect(screen.queryByText(/mở ngăn khác/)).toBeNull();
  });
});

/*
 * Mã đúng, hiệu ứng thành công đang chạy: `onDone` là việc vừa bị chặn (ghi két, cài lại 2 lớp).
 * Người dùng không được đóng hộp lúc này, và nếu hộp vẫn bị tháo (màn đổi) thì việc đó không
 * được chạy hộ sau lưng họ.
 */
describe('StepUpDialog — không đi tiếp sau khi hộp đã đóng', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function codeAccepted() {
    vi.stubGlobal('AnimationEvent', class {});
    mockStepUp(200, { graceMinutes: 10 });
    vi.useFakeTimers();
    const onDone = vi.fn();
    const onClose = vi.fn();
    const view = renderWithI18n(<StepUpDialog csrfToken="t" scope="vault" onClose={onClose} onDone={onDone} />);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Số thứ 1 trên 6'), { target: { value: '123456' } });
      await vi.advanceTimersByTimeAsync(50);
    });
    return { onDone, onClose, view };
  }

  it('đang chạy hiệu ứng: Hủy mờ, Esc không đóng', async () => {
    const { onClose } = await codeAccepted();
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hộp bị tháo giữa hiệu ứng → onDone KHÔNG chạy', async () => {
    const { onDone, view } = await codeAccepted();
    view.unmount();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('vế đối chứng: để hiệu ứng chạy hết → onDone chạy đúng một lần', async () => {
    const { onDone } = await codeAccepted();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(onDone).toHaveBeenCalledExactlyOnceWith(10);
  });
});
