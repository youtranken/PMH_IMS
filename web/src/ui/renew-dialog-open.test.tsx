import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { RenewDialog } from '@/ui/renew-dialog';
import { fireEvent, jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';

afterEach(() => vi.unstubAllGlobals());

const ROW = { kind: 'license', id: 'sw1', code: 'LIC-E2E-01', label: 'Office', end: '2099-12-31' };

function renderDialog(onOpenRecord?: () => void) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(201, {}))));
  renderWithI18n(
    <ToastProvider>
      <RenewDialog
        row={ROW}
        kindLabel="License"
        csrfToken="t"
        onOpenRecord={onOpenRecord}
        onClose={vi.fn()}
        onDone={vi.fn()}
      />
    </ToastProvider>,
  );
}

/*
 * Chọn nhầm năm (2072 thay vì 2027) thì phải soát lại được ngay: toast "Đã gia hạn … tới …"
 * kèm nút "Mở hồ sơ" (EX-016). Không có Hoàn tác — lùi hạn là việc sửa hồ sơ có ghi vết.
 */
describe('RenewDialog — toast kèm "Mở hồ sơ"', () => {
  it('có onOpenRecord: toast nêu ngày mới và có nút Mở hồ sơ', async () => {
    const onOpenRecord = vi.fn();
    renderDialog(onOpenRecord);
    await userEvent.click(screen.getByRole('button', { name: '+1 năm' }));
    await userEvent.click(screen.getByRole('button', { name: 'Gia hạn' }));
    expect(await screen.findByText('Đã gia hạn LIC-E2E-01 tới 31/12/2100.')).toBeInTheDocument();
    // Hộp vẫn mở (onClose/onDone giả) nên nền mang pointer-events:none — bấm thẳng vào nút.
    fireEvent.click(screen.getByRole('button', { name: 'Mở hồ sơ' }));
    expect(onOpenRecord).toHaveBeenCalledOnce();
  });

  it('không truyền onOpenRecord thì toast không có nút', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: '+1 năm' }));
    await userEvent.click(screen.getByRole('button', { name: 'Gia hạn' }));
    await screen.findByText('Đã gia hạn LIC-E2E-01 tới 31/12/2100.');
    expect(screen.queryByRole('button', { name: 'Mở hồ sơ' })).not.toBeInTheDocument();
  });
});
