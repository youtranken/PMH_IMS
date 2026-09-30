import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import {
  AttachmentDraftSection,
  useAttachmentDraft,
  type AttachmentDraft,
} from '@/ui/attachment-draft';

/**
 * Khối giấy tờ chọn TRƯỚC khi hồ sơ tồn tại (dùng chung ở form thêm thiết bị / phần mềm /
 * đường truyền). Ba thứ phải đúng: danh sách không nhân đôi, bỏ ra được, và file chỉ bay lên
 * server SAU khi có `ownerId` — lưu hồ sơ hỏng thì không được để lại file mồ côi.
 */
function Harness({ onResult }: { onResult?: (errors: string[]) => void }) {
  const draft: AttachmentDraft = useAttachmentDraft();
  const [done, setDone] = useState(false);

  return (
    <>
      <AttachmentDraftSection draft={draft} />
      <button
        type="button"
        onClick={() => {
          void draft.upload('software', 'sw-1', 'csrf-abc').then((errors) => {
            onResult?.(errors);
            setDone(true);
          });
        }}
      >
        Lưu giả lập
      </button>
      {done ? <p>Đã đẩy xong</p> : null}
    </>
  );
}

function pdf(name: string): File {
  return new File(['%PDF-1.4'], name, { type: 'application/pdf' });
}

/** `uploadFile` gọi thẳng `fetch` — chặn ở đó là chặn đúng ranh giới mạng, không mock nội bộ. */
function stubFetch(fail: string[] = []) {
  const calls: { path: string; body: FormData }[] = [];
  const fetchMock = vi.fn((path: string, init: RequestInit) => {
    // Trần cỡ/số file đọc từ phiên (Q-18) — trả phiên có cấu hình mặc định, không tính là lượt gửi file.
    if (path.includes('/auth/me')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ role: 'admin', config: { fileMaxSizeMb: 25, fileMaxFilesPerBatch: 6 } }),
      });
    }
    const body = init.body as FormData;
    calls.push({ path, body });
    const name = (body.get('file') as File).name;
    return Promise.resolve(
      fail.includes(name)
        ? {
            ok: false,
            status: 400,
            json: () =>
              Promise.resolve({ code: 'FILE_TOO_LARGE', message: 'File vượt trần 25 MB.' }),
          }
        : { ok: true, status: 201, json: () => Promise.resolve({ id: 'file-1' }) },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

describe('AttachmentDraft — giấy tờ chọn trước lúc lưu hồ sơ', () => {
  it('giữ nhiều file, không nhân đôi file đã chọn, bỏ ra được', async () => {
    const user = userEvent.setup();
    renderWithI18n(<Harness />);

    const picker = screen.getByLabelText('Chọn file để đính kèm');
    await user.upload(picker, pdf('hoa-don.pdf'));
    await user.upload(screen.getByLabelText('Chọn file để đính kèm'), pdf('bien-ban.pdf'));

    expect(screen.getByText('hoa-don.pdf')).toBeInTheDocument();
    expect(screen.getByText('bien-ban.pdf')).toBeInTheDocument();

    // Chọn lại đúng file đang có: server sẽ nhận hai bản trùng tên mà không ai gỡ ra được.
    await user.upload(screen.getByLabelText('Chọn file để đính kèm'), pdf('hoa-don.pdf'));
    expect(screen.getAllByText('hoa-don.pdf')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Bỏ "hoa-don.pdf"/ }));
    expect(screen.queryByText('hoa-don.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('bien-ban.pdf')).toBeInTheDocument();
  });

  it('chỉ gọi API lúc upload, và gửi kèm đúng ownerType/ownerId', async () => {
    const user = userEvent.setup();
    const calls = stubFetch();
    renderWithI18n(<Harness />);

    await user.upload(screen.getByLabelText('Chọn file để đính kèm'), pdf('hop-dong.pdf'));
    // Chọn file KHÔNG được đụng tới mạng: hồ sơ còn chưa có id để treo file vào.
    expect(calls).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Lưu giả lập' }));
    expect(await screen.findByText('Đã đẩy xong')).toBeInTheDocument();

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe('/api/v1/files');
    expect(calls[0].body.get('ownerType')).toBe('software');
    expect(calls[0].body.get('ownerId')).toBe('sw-1');
    expect((calls[0].body.get('file') as File).name).toBe('hop-dong.pdf');
    // Đẩy xong thì danh sách sạch — không thì lưu tiếp hồ sơ khác lại kèm y hệt bộ file cũ.
    expect(screen.queryByText('hop-dong.pdf')).not.toBeInTheDocument();
  });

  it('một file hỏng không kéo theo file còn lại, và trả về câu lỗi của server', async () => {
    const user = userEvent.setup();
    const calls = stubFetch(['qua-nang.pdf']);
    const errors: string[][] = [];
    renderWithI18n(<Harness onResult={(list) => errors.push(list)} />);

    await user.upload(screen.getByLabelText('Chọn file để đính kèm'), pdf('qua-nang.pdf'));
    await user.upload(screen.getByLabelText('Chọn file để đính kèm'), pdf('vua-du.pdf'));
    await user.click(screen.getByRole('button', { name: 'Lưu giả lập' }));
    expect(await screen.findByText('Đã đẩy xong')).toBeInTheDocument();

    expect(calls).toHaveLength(2);
    expect(errors[0]).toHaveLength(1);
    // Câu lỗi phải NÓI TÊN file và nhắc chỗ đính kèm lại — hồ sơ đã lưu rồi, không thể quay lui.
    expect(errors[0][0]).toContain('qua-nang.pdf');
    expect(errors[0][0]).toContain('File vượt trần 25 MB.');
    expect(errors[0][0]).toContain('tab Giấy tờ');
  });

  /*
   * Q-18: file quá cỡ phải bị bắt NGAY lúc chọn. Để tới lúc Lưu thì hồ sơ đã ghi xuống DB rồi
   * mới báo file hỏng — người dùng phải mở lại hồ sơ để đính kèm lần nữa.
   */
  it('file quá cỡ bị từ chối ngay lúc chọn, không vào danh sách, không bao giờ gửi', async () => {
    const user = userEvent.setup();
    const calls = stubFetch();
    renderWithI18n(<Harness />);

    const big = pdf('scan-to.pdf');
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 });
    await user.upload(screen.getByLabelText('Chọn file để đính kèm'), big);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Không đính kèm "scan-to.pdf": vượt 25 MB mỗi file.',
    );
    expect(screen.queryByRole('button', { name: /Bỏ "scan-to.pdf"/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Lưu giả lập' }));
    expect(await screen.findByText('Đã đẩy xong')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('giữ tối đa đủ số file mỗi lượt; file thứ 7 bị bỏ kèm lời báo', async () => {
    const user = userEvent.setup();
    stubFetch();
    renderWithI18n(<Harness />);

    await user.upload(
      screen.getByLabelText('Chọn file để đính kèm'),
      ['1', '2', '3', '4', '5', '6', '7'].map((n) => pdf(`${n}.pdf`)),
    );
    expect(screen.getByText('6.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bỏ "7.pdf"/ })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Mỗi lần chỉ nhận 6 file — đã bỏ ra: "7.pdf".',
    );
  });
});
