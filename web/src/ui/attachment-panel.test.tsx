import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
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
 * Quyền Xoá đọc từ `useMe()` chứ không từ ảnh chụp cache: panel dựng trước khi `me` về (mở
 * thẳng URL, cache vừa bị xoá) thì ảnh chụp là `undefined` mãi, và Admin không thấy nút Xoá.
 */
describe('AttachmentPanel — quyền xoá theo phiên hiện tại', () => {
  afterEach(() => vi.unstubAllGlobals());

  const withMe = (role: string) =>
    vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes('/auth/me')
          ? jsonResponse(200, { id: 'u1', email: 'a@pmh.com.vn', role })
          : jsonResponse(200, [
              {
                id: 'f1',
                originalName: 'hoa-don.pdf',
                mimeType: 'application/pdf',
                kind: 'document',
                sizeBytes: 10,
                createdAt: '2026-09-27T16:16:00.000Z',
              },
            ]),
      ),
    );

  const renderPanel = () =>
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <AttachmentPanel ownerType="device" ownerId="d1" csrfToken="x" />
        </ConfirmProvider>
      </ToastProvider>,
    );

  it('Admin: `me` chưa có trong cache lúc dựng, về sau thì nút thao tác vẫn hiện', async () => {
    vi.stubGlobal('fetch', withMe('admin'));
    renderPanel();
    expect(
      await screen.findByRole('button', { name: 'Thao tác với hoa-don.pdf' }),
    ).toBeInTheDocument();
  });

  it('Member: không có nút thao tác xoá', async () => {
    vi.stubGlobal('fetch', withMe('member'));
    renderPanel();
    expect(await screen.findByText('hoa-don.pdf')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Thao tác với hoa-don.pdf' }),
    ).not.toBeInTheDocument();
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

    // Cùng dấu ✕ đỏ như nút bỏ file ở form thêm mới (Q-20): không chữ "Hủy", tên ở aria-label.
    const cancelB = screen.getByRole('button', { name: 'Hủy tải "bang-luong.xlsx"' });
    expect(cancelB).toHaveTextContent('');
    expect(cancelB.querySelector('svg')).not.toBeNull();
    await userEvent.click(cancelB);
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

/*
 * Q-18: trần cỡ file và số file mỗi lượt đọc từ `/auth/me` và kiểm TRƯỚC khi gửi — file quá cỡ
 * không phải đi hết qua mạng rồi mới bị từ chối, và lượt chọn quá số file bị cắt kèm lời báo.
 */
describe('AttachmentPanel — trần cỡ file và số file mỗi lượt (Q-18)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const MB = 1024 * 1024;
  const sized = (name: string, bytes: number) => {
    const f = new File(['%PDF'], name);
    Object.defineProperty(f, 'size', { value: bytes });
    return f;
  };

  const renderWithLimits = (fileMaxSizeMb: number, fileMaxFilesPerBatch: number) => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          String(url).includes('/auth/me')
            ? jsonResponse(200, {
                id: 'u1',
                email: 'a@pmh.com.vn',
                role: 'admin',
                config: { fileMaxSizeMb, fileMaxFilesPerBatch },
              })
            : jsonResponse(200, []),
        ),
      ),
    );
    uploadFile.mockReset();
    uploadFile.mockResolvedValue({});
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <AttachmentPanel ownerType="device" ownerId="d1" csrfToken="x" />
        </ConfirmProvider>
      </ToastProvider>,
    );
  };

  it('câu gợi ý cạnh ô chọn nói trần lấy từ cấu hình', async () => {
    renderWithLimits(25, 6);
    expect(
      await screen.findByText('Tối đa 25 MB/file, 6 file mỗi lần — PDF, Word, Excel, PowerPoint, ảnh.'),
    ).toBeInTheDocument();
  });

  it('file quá cỡ KHÔNG được gửi, có lời báo nêu tên; file vừa cỡ vẫn lên', async () => {
    renderWithLimits(10, 6);
    await screen.findByText(/Tối đa 10 MB\/file/);
    await userEvent.upload(screen.getByLabelText('Chọn file để đính kèm'), [
      sized('scan-to.pdf', 11 * MB),
      sized('hoa-don.pdf', 1 * MB),
    ]);
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    expect((uploadFile.mock.calls[0][1] as File).name).toBe('hoa-don.pdf');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Không đính kèm "scan-to.pdf": vượt 10 MB mỗi file.',
    );
  });

  it('chọn quá số file mỗi lượt: chỉ gửi đủ trần, phần dư bị bỏ kèm lời báo', async () => {
    renderWithLimits(25, 2);
    await screen.findByText(/2 file mỗi lần/);
    await userEvent.upload(screen.getByLabelText('Chọn file để đính kèm'), [
      sized('1.pdf', 10),
      sized('2.pdf', 10),
      sized('3.pdf', 10),
    ]);
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Mỗi lần chỉ nhận 2 file — đã bỏ ra: "3.pdf".',
    );
  });
});

/*
 * Luật "chỉ tải về, không mở trong trình duyệt" là chú giải, không phải câu thường trực: nó nằm
 * trong nút (i) cạnh dòng giới hạn để khu đính kèm gọn mà vẫn tra được (Q-20).
 */
describe('AttachmentPanel — luật tải về nằm trong nút (i)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('câu chống mã độc không hiện sẵn, bấm (i) cạnh dòng giới hạn mới hiện', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, []))),
    );
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <AttachmentPanel ownerType="device" ownerId="d1" csrfToken="x" />
        </ConfirmProvider>
      </ToastProvider>,
    );
    const sentence = 'File chỉ tải về máy, không mở trong trình duyệt (chống mã độc).';
    expect(screen.queryByText(sentence)).not.toBeInTheDocument();
    const limitLine = screen.getByText(/^Tối đa \d+ MB\/file/).closest('p') as HTMLElement;
    const tip = within(limitLine).getByRole('button', {
      name: 'Giải thích: Cách mở file đính kèm',
    });
    await userEvent.click(tip);
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });
});

/*
 * Gợi ý khi chưa có giấy tờ phải nói đúng loại hồ sơ, như ô thả file: tài khoản dịch vụ không có
 * "hóa đơn", và ở đó còn phải nhắc KHÔNG đính mật khẩu.
 */
describe('AttachmentPanel — gợi ý khi trống theo loại hồ sơ', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['service_account', /cấu hình VPN/],
    ['nat_rule', /cấu hình router/],
    ['device', /hóa đơn/i],
  ] as const)('%s', async (ownerType, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(200, []))),
    );
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <AttachmentPanel ownerType={ownerType} ownerId="o1" csrfToken="x" />
        </ConfirmProvider>
      </ToastProvider>,
    );
    const empty = (await screen.findByText('Chưa có giấy tờ nào.')).parentElement!;
    expect(empty).toHaveTextContent(expected);
    if (ownerType !== 'device') expect(empty).not.toHaveTextContent(/hóa đơn/i);
  });
});
