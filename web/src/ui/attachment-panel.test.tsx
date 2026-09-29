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
