import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { RenewDialog } from '@/ui/renew-dialog';
import { fireEvent, jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';

afterEach(() => vi.unstubAllGlobals());

const ROW = { kind: 'license', id: 'sw1', code: 'LIC-E2E-01', label: 'Office', end: '2099-12-31' };

function renderDialog(toastAction?: { label: string; onClick: () => void }) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(201, {}))));
  renderWithI18n(
    <ToastProvider>
      <RenewDialog
        row={ROW}
        kindLabel="License"
        csrfToken="t"
        toastAction={toastAction}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    </ToastProvider>,
  );
}

async function renew() {
  await userEvent.click(screen.getByRole('button', { name: '+1 năm' }));
  await userEvent.click(screen.getByRole('button', { name: 'Gia hạn' }));
}

/*
 * Gia hạn xong chỉ có MỘT toast "Đã gia hạn … tới …" — nút đi kèm do nơi gọi chọn: "Mở hồ sơ"
 * (trang chủ, soát lại ngày vừa ghi — EX-016) hay "Xem trong Đã gia hạn" (màn Sắp hết hạn, nơi
 * dòng vừa gia hạn rời danh sách — EX-008). Hai toast chồng nhau cho một việc là nói hai lần.
 */
describe('RenewDialog — một toast, nút do nơi gọi chọn', () => {
  it('toastAction: toast nêu ngày mới và có đúng nút nơi gọi truyền', async () => {
    const onClick = vi.fn();
    renderDialog({ label: 'Xem trong Đã gia hạn', onClick });
    await renew();
    expect(await screen.findByText('Đã gia hạn LIC-E2E-01 tới 31/12/2100.')).toBeInTheDocument();
    // Hộp vẫn mở (onClose/onDone giả) nên nền mang pointer-events:none — bấm thẳng vào nút.
    fireEvent.click(screen.getByRole('button', { name: 'Xem trong Đã gia hạn' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('không truyền toastAction thì toast không có nút', async () => {
    renderDialog();
    await renew();
    await screen.findByText('Đã gia hạn LIC-E2E-01 tới 31/12/2100.');
    expect(screen.queryByRole('button', { name: 'Mở hồ sơ' })).not.toBeInTheDocument();
  });
});
