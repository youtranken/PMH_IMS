import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import type { CropBox, CropSource } from '@/lib/image-crop';
import { ImageCropDialog } from './image-crop-dialog';

/**
 * Hộp cắt ảnh thiết bị (Q-23 06/10, A): tự bỏ viền, khoá khung theo mặt tủ n U, ra tệp mới cho nơi
 * gọi tải lên. jsdom không có canvas → nạp ảnh và vẽ ảnh ra tệp được giả lập; phép tính khung là
 * hàm thật của `lib/image-crop`.
 */

const { rendered } = vi.hoisted(() => ({ rendered: [] as { box: CropBox; name: string; type: string }[] }));

vi.mock('@/lib/image-crop', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/image-crop')>();
  return {
    ...real,
    loadCropSource: vi.fn(
      async (): Promise<CropSource> => ({
        url: 'blob:anh',
        image: {} as HTMLImageElement,
        size: { width: 1200, height: 400 },
        // Ảnh 1200×400 có máy nằm giữa, viền trắng trên dưới và hai bên.
        content: { x: 100, y: 150, width: 1000, height: 100 },
      }),
    ),
    renderCrop: vi.fn(async (_source: CropSource, box: CropBox, original: { name: string; type: string }) => {
      rendered.push({ box, ...original });
      return new File([new Uint8Array(4)], original.name, { type: original.type });
    }),
  };
});


const png = () => new File([new Uint8Array(10)], 'sw-01.png', { type: 'image/png' });

beforeEach(() => {
  rendered.length = 0;
});

describe('ImageCropDialog', () => {
  it('máy 1U: khung khoá tỉ lệ mặt tủ 1U, bấm Dùng ảnh → tệp đã cắt về nơi gọi', async () => {
    const onDone = vi.fn();
    renderWithI18n(<ImageCropDialog file={png()} units={1} onCancel={vi.fn()} onDone={onDone} />);
    expect(await screen.findByText(/khóa theo mặt tủ 1U/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dùng ảnh đã cắt' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    const [box] = rendered.map((r) => r.box);
    expect(box.width / box.height).toBeCloseTo(10.857, 1);
    // Không mất nội dung: khung phủ trọn khối máy.
    expect(box.x).toBeLessThanOrEqual(100);
    expect(box.x + box.width).toBeGreaterThanOrEqual(1100);
    expect((onDone.mock.calls[0][0] as File).name).toBe('sw-01.png');
  });

  it('không có Số U → cắt tự do, khung ban đầu = khối nội dung (đã bỏ viền)', async () => {
    renderWithI18n(<ImageCropDialog file={png()} units={null} onCancel={vi.fn()} onDone={vi.fn()} />);
    expect(await screen.findByText(/cắt tự do/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dùng ảnh đã cắt' }));
    await waitFor(() => expect(rendered).toHaveLength(1));
    expect(rendered[0].box).toEqual({ x: 100, y: 150, width: 1000, height: 100 });
  });

  it('phím mũi tên dời khung cắt', async () => {
    renderWithI18n(<ImageCropDialog file={png()} units={null} onCancel={vi.fn()} onDone={vi.fn()} />);
    const frame = await screen.findByRole('group', { name: /khung cắt/i });
    fireEvent.keyDown(frame, { key: 'ArrowLeft' });
    await userEvent.click(screen.getByRole('button', { name: 'Dùng ảnh đã cắt' }));
    await waitFor(() => expect(rendered).toHaveLength(1));
    expect(rendered[0].box.x).toBeLessThan(100);
  });

  it('"Cả ảnh" bỏ phần tự cắt', async () => {
    renderWithI18n(<ImageCropDialog file={png()} units={null} onCancel={vi.fn()} onDone={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Cả ảnh' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dùng ảnh đã cắt' }));
    await waitFor(() => expect(rendered).toHaveLength(1));
    expect(rendered[0].box).toEqual({ x: 0, y: 0, width: 1200, height: 400 });
  });

  it('Hủy → không ra tệp nào', async () => {
    const onCancel = vi.fn();
    const onDone = vi.fn();
    renderWithI18n(<ImageCropDialog file={png()} units={1} onCancel={onCancel} onDone={onDone} />);
    await screen.findByText(/khóa theo mặt tủ 1U/i);
    await userEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(rendered).toHaveLength(0);
  });
});
