import { describe, expect, it, vi } from 'vitest';
import { fireEvent, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import type { CropSource } from '@/lib/image-crop';
import { DevicePhotoSlots, type PhotoSlot, type PhotoSide } from './device-photo-slots';

/*
 * jsdom không có canvas: nạp ảnh / vẽ ảnh cắt / đo ảnh đang hiện được giả lập. Tệp ra mang tên
 * "cat-<tên gốc>" để thấy nơi gọi nhận đúng tệp ĐÃ CẮT chứ không phải tệp gốc.
 */
const crop = vi.hoisted(() => ({ fit: null as 'margins' | 'aspect' | null, units: [] as (number | null)[] }));
vi.mock('@/lib/image-crop', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/image-crop')>();
  return {
    ...real,
    loadCropSource: vi.fn(async (): Promise<CropSource> => ({ url: 'blob:x', image: {} as HTMLImageElement, size: { width: 1000, height: 100 }, content: { x: 0, y: 0, width: 1000, height: 100 } })),
    renderCrop: vi.fn(async (_s: CropSource, _b: unknown, original: { name: string; type: string }) => new File([new Uint8Array(3)], `cat-${original.name}`, { type: original.type })),
    measurePhotoFit: vi.fn((_img: HTMLImageElement, units: number | null) => {
      crop.units.push(units);
      return crop.fit;
    }),
  };
});

/** Chọn xong tệp thì hộp cắt mở — bấm "Dùng ảnh đã cắt" rồi chờ tệp đã cắt về nơi gọi. */
async function acceptCrop() {
  await userEvent.click(await screen.findByRole('button', { name: 'Dùng ảnh đã cắt' }));
}

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
    expect(onPick).not.toHaveBeenCalled();
    await acceptCrop();
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('front', expect.objectContaining({ name: 'cat-anh.png' })));
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

  it('thả tệp vào ô → hộp cắt → onPick', async () => {
    const { onPick } = setup();
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    const file = png('tha.png');
    fireEvent.drop(front.querySelector('.file-picker')!, { dataTransfer: { files: [file] } });
    await acceptCrop();
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('front', expect.objectContaining({ name: 'cat-tha.png' })));
  });

  it('máy có Số U → hộp cắt khoá theo mặt tủ n U; Hủy hộp cắt → không gọi onPick', async () => {
    const { onPick } = setup({ rackUnits: 2 });
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    await userEvent.setup().upload(within(front).getByLabelText('Tải ảnh lên — Mặt trước'), png());
    expect(await screen.findByText(/khoá theo mặt tủ 2U/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(onPick).not.toHaveBeenCalled();
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
    await acceptCrop();
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith('back', expect.objectContaining({ name: 'cat-chung.png' })));
  });
});

describe('DevicePhotoSlots — ảnh cũ chưa cắt chuẩn', () => {
  it('ảnh lệch tỉ lệ n U → "Ảnh chưa đúng tỉ lệ 1U" + Cắt lại trên tệp gốc → onPick tệp đã cắt', async () => {
    crop.fit = 'aspect';
    const loadOriginal = vi.fn(async () => png('goc.png'));
    const { onPick } = setup({ rackUnits: 1, loadOriginal, slots: slots({ src: '/p?v=1', level: 'own' }) });
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    fireEvent.load(within(front).getByRole('img', { name: 'Ảnh Mặt trước của máy' }));
    expect(within(front).getByText('Ảnh chưa đúng tỉ lệ 1U.')).toBeInTheDocument();
    expect(crop.units).toContain(1);
    await userEvent.click(within(front).getByRole('button', { name: 'Cắt lại ảnh — Mặt trước' }));
    expect(loadOriginal).toHaveBeenCalledWith('front');
    await acceptCrop();
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('front', expect.objectContaining({ name: 'cat-goc.png' })));
    crop.fit = null;
  });

  it('ảnh chung của model, SA/Admin → Cắt lại ghi lại ảnh chung', async () => {
    crop.fit = 'margins';
    const onUpload = vi.fn();
    setup({ loadOriginal: vi.fn(async () => png('model.png')), model: { onUpload, onCopyOwn: vi.fn() }, slots: slots({ src: '/p?v=2', level: 'model' }) });
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    fireEvent.load(within(front).getByRole('img', { name: 'Ảnh Mặt trước của máy' }));
    expect(within(front).getByText('Ảnh chưa cắt chuẩn — còn viền thừa.')).toBeInTheDocument();
    await userEvent.click(within(front).getByRole('button', { name: 'Cắt lại ảnh — Mặt trước' }));
    await acceptCrop();
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith('front', expect.objectContaining({ name: 'cat-model.png' })));
    crop.fit = null;
  });

  it('ảnh ổn → không báo', () => {
    setup({ rackUnits: 1, loadOriginal: vi.fn(), slots: slots({ src: '/p?v=1', level: 'own' }) });
    const front = screen.getByRole('group', { name: 'Mặt trước' });
    fireEvent.load(within(front).getByRole('img', { name: 'Ảnh Mặt trước của máy' }));
    expect(within(front).queryByRole('button', { name: /Cắt lại/ })).toBeNull();
  });
});
