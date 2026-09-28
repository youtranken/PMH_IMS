import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { ImportDialog } from '@/ui/import-dialog';
import { ToastProvider } from '@/ui/toast';

const uploadFile = vi.fn();
vi.mock('@/lib/upload', () => ({ uploadFile: (...args: unknown[]) => uploadFile(...args) }));

/*
 * Chọn file xong là TỰ đối chiếu: bước bấm "Đối chiếu" riêng hay bị quên, rồi người dùng đứng
 * nhìn nút "Xác nhận ghi" xám mà không hiểu vì sao.
 */
describe('ImportDialog — chọn file là tự đối chiếu', () => {
  it('gửi file lên previewUrl ngay khi chọn, và hiện dải tổng kết', async () => {
    uploadFile.mockResolvedValue({
      rows: [],
      summary: { create: 2, update: 0, unchanged: 0, skip: 0, error: 0 },
    });
    renderWithI18n(
      <ToastProvider>
      <ImportDialog
        title="Nhập"
        hint="gợi ý"
        previewUrl="/preview"
        commitUrl="/commit"
        csrfToken="x"
        mapRow={() => ({ group: '', rowNumber: 1, action: 'create', label: '' })}
        onClose={() => {}}
        onImported={() => {}}
        template={<button type="button">Tải file mẫu</button>}
      />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: 'Tải file mẫu' })).toBeInTheDocument();
    const file = new File(['PK'], 'tb.xlsx');
    await userEvent.upload(screen.getByLabelText('Chọn file .xlsx'), file);
    expect(uploadFile).toHaveBeenCalledWith('/preview', file, 'x');
    expect(await screen.findByText('Thêm mới: 2')).toBeInTheDocument();
  });
});
