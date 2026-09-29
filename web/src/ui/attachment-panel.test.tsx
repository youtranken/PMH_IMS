import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';

const uploadFile = vi.fn();
vi.mock('@/lib/upload', () => ({ uploadFile: (...args: unknown[]) => uploadFile(...args) }));

/*
 * Chọn là TẢI NGAY, nhiều file một lượt: bước "Chọn file → Tải lên" riêng hay bị quên, người
 * dùng chọn xong rời tab và file chưa bao giờ lên. Không còn nút "Tải lên".
 */
describe('AttachmentPanel — chọn là tải', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('chọn hai file: gửi cả hai lên ngay, không có nút "Tải lên"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, []))),
    );
    uploadFile.mockResolvedValue({});
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <AttachmentPanel ownerType="device" ownerId="d1" csrfToken="x" />
        </ConfirmProvider>
      </ToastProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Tải lên' })).not.toBeInTheDocument();
    const a = new File(['%PDF'], 'hoa-don.pdf');
    const b = new File(['%PDF'], 'bien-ban.pdf');
    await userEvent.upload(screen.getByLabelText('Chọn file để đính kèm'), [a, b]);
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
    expect(uploadFile.mock.calls.map((call) => (call[1] as File).name)).toEqual([
      'hoa-don.pdf',
      'bien-ban.pdf',
    ]);
    expect(await screen.findByText('Đã đính kèm 2 giấy tờ.')).toBeInTheDocument();
  });

  it('mỗi giấy tờ nói ai tải lên (họ tên API trả)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, [
            {
              id: 'f1',
              originalName: 'hoa-don.pdf',
              mimeType: 'application/pdf',
              kind: 'document',
              sizeBytes: 10,
              createdAt: '2026-09-27T16:16:00.000Z',
              uploadedByName: 'Nguyễn Văn An',
            },
          ]),
        ),
      ),
    );
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <AttachmentPanel ownerType="device" ownerId="d1" csrfToken="x" />
        </ConfirmProvider>
      </ToastProvider>,
    );
    expect(await screen.findByText('bởi Nguyễn Văn An')).toBeInTheDocument();
  });
});

/*
 * DEV-081: đang tải nhiều file mà lỡ chọn nhầm một file (bảng lương thay cho hóa đơn) thì phải
 * hủy được ĐÚNG file đó — không phải chờ cả lô xong rồi đi xóa.
 */
describe('AttachmentPanel — hủy từng file đang tải', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hủy file đang chờ: nó không bao giờ được gửi; hủy file đang tải: yêu cầu bị ngắt', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, []))),
    );
    uploadFile.mockReset();
    // File đầu treo tới khi bị hủy (signal) — đúng cảnh "đang tải".
    uploadFile.mockImplementation(
      (_path: string, _file: File, _csrf: string, _fields: unknown, _name: unknown, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <AttachmentPanel ownerType="device" ownerId="d1" csrfToken="x" />
        </ConfirmProvider>
      </ToastProvider>,
    );
    const a = new File(['%PDF'], 'hoa-don.pdf');
    const b = new File(['%PDF'], 'bang-luong.xlsx');
    await userEvent.upload(screen.getByLabelText('Chọn file để đính kèm'), [a, b]);
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('button', { name: 'Hủy tải "bang-luong.xlsx"' }));
    await userEvent.click(screen.getByRole('button', { name: 'Hủy tải "hoa-don.pdf"' }));

    const signal = uploadFile.mock.calls[0][5] as AbortSignal;
    expect(signal.aborted).toBe(true);
    // Lô kết thúc, file bị hủy KHÔNG được gửi, và hủy không phải lỗi.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Hủy tải/ })).not.toBeInTheDocument(),
    );
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Không tải lên được/)).not.toBeInTheDocument();
  });
});
