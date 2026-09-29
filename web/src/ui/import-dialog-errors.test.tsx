import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { ImportDialog } from '@/ui/import-dialog';
import { ToastProvider } from '@/ui/toast';

const uploadFile = vi.fn();
const uploadForDownload = vi.fn();
vi.mock('@/lib/upload', () => ({
  uploadFile: (...args: unknown[]) => uploadFile(...args),
  uploadForDownload: (...args: unknown[]) => uploadForDownload(...args),
}));

function renderDialog(errorsUrl?: string) {
  renderWithI18n(
    <ToastProvider>
      <ImportDialog
        title="Nhập"
        hint="gợi ý"
        previewUrl="/preview"
        commitUrl="/commit"
        errorsUrl={errorsUrl}
        errorsFileName="dong-loi-danh-muc.xlsx"
        csrfToken="x"
        mapRow={() => ({ group: 'Site', rowNumber: 3, action: 'error', label: 'S1', message: 'Thiếu tên.' })}
        onClose={() => {}}
        onImported={() => {}}
      />
    </ToastProvider>,
  );
}

/*
 * File 300 dòng còn 12 dòng lỗi: người sửa cần tờ liệt kê đúng 12 dòng đó (sheet · dòng · mục ·
 * lý do) để mở file gốc ra sửa — nút "Tải danh sách dòng lỗi" gửi lại CHÍNH file đang chọn (ADM-005).
 */
describe('ImportDialog — tải danh sách dòng lỗi', () => {
  it('còn dòng lỗi + có errorsUrl: nút tải gửi đúng file đang chọn lên errorsUrl', async () => {
    uploadFile.mockResolvedValue({
      rows: [{}],
      summary: { create: 0, update: 0, unchanged: 0, skip: 0, error: 1 },
    });
    uploadForDownload.mockResolvedValue(undefined);
    renderDialog('/errors');
    const file = new File(['PK'], 'danh-muc.xlsx');
    await userEvent.upload(screen.getByLabelText('Chọn file .xlsx'), file);
    await userEvent.click(await screen.findByRole('button', { name: 'Tải danh sách 1 dòng lỗi (.xlsx)' }));
    expect(uploadForDownload).toHaveBeenCalledWith('/errors', file, 'x', 'dong-loi-danh-muc.xlsx');
  });

  it('không truyền errorsUrl thì không có nút', async () => {
    uploadFile.mockResolvedValue({
      rows: [{}],
      summary: { create: 0, update: 0, unchanged: 0, skip: 0, error: 1 },
    });
    renderDialog();
    await userEvent.upload(screen.getByLabelText('Chọn file .xlsx'), new File(['PK'], 'a.xlsx'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Còn dòng lỗi/);
    expect(screen.queryByRole('button', { name: /dòng lỗi \(\.xlsx\)/ })).not.toBeInTheDocument();
  });
});
