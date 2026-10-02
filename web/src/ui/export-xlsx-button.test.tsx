import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { ToastProvider } from '@/ui/toast';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';

const download = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@/lib/download-file', () => ({ downloadFile: download }));

afterEach(() => download.mockClear());

describe('ExportXlsxButton', () => {
  it('không có allUrl: MỘT nút, bấm là tải đúng bảng đang xem', async () => {
    renderWithI18n(
      <ToastProvider>
        <ExportXlsxButton url="/api/x.xlsx" fileName="x.xlsx" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));
    expect(download).toHaveBeenCalledWith('/api/x.xlsx', 'x.xlsx');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  /* Q-20: màn IP xuất được "dải đang xem" hoặc "tất cả" — hai lựa chọn trong một menu nhỏ. */
  it('có allUrl: nút mở menu hai mục; chọn "Xuất tất cả" tải file tất cả', async () => {
    renderWithI18n(
      <ToastProvider>
        <ExportXlsxButton
          url="/api/one.xlsx"
          fileName="one.xlsx"
          currentLabel="Xuất dải đang xem"
          allUrl="/api/all.xlsx"
          allFileName="all.xlsx"
        />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Xuất dải đang xem', 'Xuất tất cả']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Xuất tất cả' }));
    expect(download).toHaveBeenCalledWith('/api/all.xlsx', 'all.xlsx');

    await userEvent.click(screen.getByRole('button', { name: 'Xuất Excel' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Xuất dải đang xem' }));
    expect(download).toHaveBeenLastCalledWith('/api/one.xlsx', 'one.xlsx');
  });
});
