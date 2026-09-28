import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { StatusDialog } from './status-dialog';

describe('Hộp đổi trạng thái thiết bị', () => {
  it('mở lại hồ sơ đã thanh lý: mặc định về "Đang dùng" (Q-15), vẫn chọn được trạng thái khác', async () => {
    const onConfirm = vi.fn();
    renderWithI18n(
      <StatusDialog
        code="SW-01"
        current="retired"
        reopen
        busy={false}
        error={null}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('button', { name: 'Trạng thái mới' })).toHaveTextContent('Đang dùng');
    await userEvent.click(screen.getByRole('button', { name: 'Đưa lại vào dùng' }));
    expect(onConfirm).toHaveBeenCalledWith('in_use');
  });

  it('không mời "Đã thanh lý" (có hộp riêng); chọn đúng trạng thái đang có thì không cho xác nhận', async () => {
    const onConfirm = vi.fn();
    renderWithI18n(
      <StatusDialog
        code="PR-01"
        current="in_use"
        reopen={false}
        busy={false}
        error={null}
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Trạng thái mới' }));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Đang dùng (hiện tại)',
      'Dự phòng',
      'Hỏng',
    ]);
    await userEvent.click(screen.getByRole('option', { name: 'Đang dùng (hiện tại)' }));
    expect(screen.getByRole('button', { name: 'Đổi trạng thái' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Trạng thái mới' }));
    await userEvent.click(screen.getByRole('option', { name: 'Hỏng' }));
    await userEvent.click(screen.getByRole('button', { name: 'Đổi trạng thái' }));
    expect(onConfirm).toHaveBeenCalledWith('broken');
  });
});
