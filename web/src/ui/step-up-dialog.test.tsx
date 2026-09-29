import { describe, expect, it, vi, afterEach } from 'vitest';
import { StepUpDialog } from '@/ui/step-up-dialog';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';

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

async function typeCodeAndSubmit(): Promise<void> {
  await userEvent.type(screen.getByLabelText(/mã/i), '123456');
  await userEvent.click(screen.getByRole('button', { name: /xác nhận|gửi|mở/i }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('StepUpDialog — cảnh báo sắp hết lượt', () => {
  it('server trả `attemptsLeft` nhỏ → ghép thêm câu "còn mấy lần nữa"', async () => {
    mockStepUp(401, { code: 'STEP_UP_INVALID', message: 'Mã không đúng.', attemptsLeft: 1 });
    renderWithI18n(<StepUpDialog csrfToken="csrf-1" onClose={vi.fn()} onDone={vi.fn()} />);

    await typeCodeAndSubmit();

    expect(await screen.findByText(new RegExp(ATTEMPTS_LEFT_WARNING))).toBeInTheDocument();
  });

  it('còn NHIỀU lượt → chỉ câu lỗi trần, không doạ người dùng (vế đối chứng)', async () => {
    // Cảnh báo phải HIẾM mới có nghĩa. Bắn nó ở lần sai đầu tiên thì tới lần thứ ba người ta
    // đã thôi đọc — đúng lúc nó bắt đầu đúng.
    mockStepUp(401, { code: 'STEP_UP_INVALID', message: 'Mã không đúng.', attemptsLeft: 9 });
    renderWithI18n(<StepUpDialog csrfToken="csrf-1" onClose={vi.fn()} onDone={vi.fn()} />);

    await typeCodeAndSubmit();

    expect(await screen.findByText('Mã không đúng.')).toBeInTheDocument();
    expect(screen.queryByText(new RegExp('Còn .* lần thử'))).not.toBeInTheDocument();
  });

  it('server KHÔNG trả `attemptsLeft` → vẫn hiện câu lỗi, không bịa thêm gì', async () => {
    mockStepUp(401, { code: 'STEP_UP_INVALID', message: 'Mã không đúng.' });
    renderWithI18n(<StepUpDialog csrfToken="csrf-1" onClose={vi.fn()} onDone={vi.fn()} />);

    await typeCodeAndSubmit();

    expect(await screen.findByText('Mã không đúng.')).toBeInTheDocument();
  });
});
