import { describe, expect, it, vi } from 'vitest';
import { fireEvent, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { DevicePhotoSlots, type PhotoSlot, type PhotoSide } from './device-photo-slots';

/**
 * Ô ảnh hai mặt (Q-23): mỗi mặt phải TRÔNG như chỗ tải ảnh — hình đang dùng (ảnh hoặc biểu tượng
 * loại phóng to), nhãn mức đang dùng, vùng thả + nút. Ô không tự gửi gì: nơi gọi nhận `File` đã
 * lọc loại và cỡ.
 */

const png = (name = 'anh.png', size = 10) => new File([new Uint8Array(size)], name, { type: 'image/png' });

const slots = (front: PhotoSlot, back: PhotoSlot = { src: null, level: 'icon' }): Record<PhotoSide, PhotoSlot> => ({ front, back });

function setup(props: Partial<Parameters<typeof DevicePhotoSlots>[0]> = {}) {
  const onPick = vi.fn();
  const onRemove = vi.fn();
  renderWithI18n(
    <DevicePhotoSlots
      slots={slots({ src: null, level: 'icon' })}
      typeName="Firewall"
      modelLabel="FG-100F"
      onPick={onPick}
      onRemove={onRemove}
      {...props}
    />,
  );
  return { onPick, onRemove };
}

describe('DevicePhotoSlots — nhãn mức đang dùng', () => {
  it.each([
    [{ src: '/p/front?v=1', level: 'own' }, 'Ảnh riêng của máy này'],
    [{ src: '/p/front?v=2', level: 'model' }, 'Ảnh chung của model FG-100F'],
    [{ src: null, level: 'icon' }, 'Biểu tượng loại Firewall'],
    [{ src: 'blob:x', level: 'draft' }, 'Ảnh riêng — tải lên khi lưu máy'],
  ] as const)('%o → %s', (slot, text) => {
    setup({ slots: slots(slot) });
    expect(within(screen.getByRole('group', { name: 'Mặt trước' })).getByText(text)).toBeInTheDocument();
  });

  it('có ảnh → <img> của ảnh đó; không ảnh → biểu tượng loại phóng to, không <img> ảnh máy', () => {
    setup({ slots: slots({ src: '/api/v1/devices/d1/photo/front?v=f1', level: 'own' }) });
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    expect(within(front).getByRole('img', { name: 'Ảnh Mặt trước của máy' })).toHaveAttribute('src', '/api/v1/devices/d1/photo/front?v=f1');
    const back = screen.getByRole('group', { name: 'Mặt sau' });
    expect(within(back).queryByRole('img', { name: /Ảnh Mặt sau/ })).toBeNull();
    expect(within(back).getByRole('img', { name: 'Biểu tượng loại Firewall' })).toBeInTheDocument();
  });

  it('biểu tượng SVG riêng của loại → hiện bằng <img> trong ô trống', () => {
    setup({ typeIconSrc: 'data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E' });
    const back = screen.getByRole('group', { name: 'Mặt sau' });
    expect(within(back).getByRole('img', { name: 'Biểu tượng loại Firewall' })).toHaveAttribute('src', 'data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E');
  });
});

describe('DevicePhotoSlots — tải ảnh', () => {
  it('chưa có ảnh riêng → nút "Tải ảnh lên"; chọn tệp → onPick(mặt, tệp)', async () => {
    const { onPick } = setup();
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    expect(within(front).getByText('Tải ảnh lên')).toBeInTheDocument();
    const file = png();
    await userEvent.setup().upload(within(front).getByLabelText('Tải ảnh lên — Mặt trước'), file);
    expect(onPick).toHaveBeenCalledWith('front', file);
  });

  it('có ảnh riêng → "Thay ảnh" + "Bỏ ảnh riêng"', async () => {
    const { onRemove } = setup({ slots: slots({ src: '/p?v=1', level: 'own' }) });
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    expect(within(front).getByLabelText('Thay ảnh — Mặt trước')).toBeInTheDocument();
    await userEvent.setup().click(within(front).getByRole('button', { name: 'Bỏ ảnh riêng — Mặt trước' }));
    expect(onRemove).toHaveBeenCalledWith('front');
    // Mặt đang dùng ảnh model / biểu tượng thì không có gì để bỏ.
    expect(within(screen.getByRole('group', { name: 'Mặt sau' })).queryByRole('button', { name: /Bỏ ảnh/ })).toBeNull();
  });

  it('ảnh đã chọn (chưa lưu) → nút "Bỏ ảnh đã chọn"', () => {
    setup({ slots: slots({ src: 'blob:x', level: 'draft' }) });
    expect(screen.getByRole('button', { name: 'Bỏ ảnh đã chọn — Mặt trước' })).toBeInTheDocument();
  });

  it('thả tệp vào ô → onPick', () => {
    const { onPick } = setup();
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    const file = png('tha.png');
    fireEvent.drop(front.querySelector('.file-picker')!, { dataTransfer: { files: [file] } });
    expect(onPick).toHaveBeenCalledWith('front', file);
  });

  it('tệp không phải JPG/PNG hoặc quá cỡ → báo ngay trong ô, không gọi onPick', async () => {
    const { onPick } = setup();
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    const input = () => within(front).getByLabelText('Tải ảnh lên — Mặt trước');
    fireEvent.change(input(), { target: { files: [new File(['x'], 'hoa-don.pdf', { type: 'application/pdf' })] } });
    expect(within(front).getByRole('alert')).toHaveTextContent('"hoa-don.pdf" không phải ảnh JPG/PNG.');
    // Ô chọn dựng lại sau mỗi lượt (chọn lại đúng tệp vẫn bắn onChange) — hỏi lại phần tử.
    fireEvent.change(input(), { target: { files: [png('to.png', 26 * 1024 * 1024)] } });
    expect(within(front).getByRole('alert')).toHaveTextContent('"to.png"');
    expect(onPick).not.toHaveBeenCalled();
  });

  it('đang tải mặt nào → mặt đó báo "Đang tải ảnh lên…" và khoá nút; lỗi của nơi gọi hiện trong ô', () => {
    setup({ busySide: 'front', errors: { back: 'Tệp hỏng' } });
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    expect(within(front).getByRole('status')).toHaveTextContent('Đang tải ảnh lên…');
    expect(within(front).getByLabelText('Tải ảnh lên — Mặt trước')).toBeDisabled();
    expect(within(screen.getByRole('group', { name: 'Mặt sau' })).getByRole('alert')).toHaveTextContent('Tệp hỏng');
  });
});

describe('DevicePhotoSlots — chỉ xem và ảnh chung của model', () => {
  it('readOnly (máy thanh lý) → vẫn thấy hình + nhãn, không có nút nào', () => {
    setup({ readOnly: true, slots: slots({ src: '/p?v=1', level: 'own' }), model: { onUpload: vi.fn(), onCopyOwn: vi.fn() } });
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    expect(within(front).getByText('Ảnh riêng của máy này')).toBeInTheDocument();
    expect(within(front).getByRole('img', { name: 'Ảnh Mặt trước của máy' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText(/Tải ảnh|Thay ảnh/)).toBeNull();
  });

  it('không truyền `model` (Thành viên) → không có việc ảnh chung', () => {
    setup({ slots: slots({ src: '/p?v=1', level: 'own' }) });
    expect(screen.queryByText(/mọi máy cùng model/)).toBeNull();
  });

  it('SA/Admin: mặt có ảnh riêng → "Dùng ảnh này cho mọi máy cùng model" (kèm giải thích); mặt khác → tải ảnh chung', async () => {
    const onCopyOwn = vi.fn();
    const onUpload = vi.fn();
    setup({ slots: slots({ src: '/p?v=1', level: 'own' }), model: { onUpload, onCopyOwn } });
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    expect(within(front).getByText(/MỌI máy model FG-100F chưa có ảnh riêng/)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(front).getByRole('button', { name: 'Dùng ảnh này cho mọi máy cùng model — Mặt trước' }));
    expect(onCopyOwn).toHaveBeenCalledWith('front');
    const back = screen.getByRole('group', { name: 'Mặt sau' });
    const file = png('chung.png');
    await user.upload(within(back).getByLabelText('Tải ảnh chung cho mọi máy cùng model — Mặt sau'), file);
    expect(onUpload).toHaveBeenCalledWith('back', file);
  });
});
