/// <reference types="node" />
// `tsconfig.app.json` đặt `types: ['vite/client']` nên `node:fs` không tự phân giải.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import '@/lib/i18n';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { quetNguon } from '@/test/quet-nguon';

/**
 * HỒ SƠ ĐÃ NGỪNG DÙNG THÌ THÔI ĐEO NHÃN HẠN (B-05).
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * `/software` vẽ `ExpiryBadge` cho MỌI dòng bất kể trạng thái, còn cỗ máy hạn bên API thì lọc
 * `status <> 'retired'`. Kết quả đo được: cùng một hồ sơ, `/software` kêu "Quá hạn 23 ngày"
 * trong khi `/expiry` báo "0 Đã quá hạn" và `/disposal` nói thẳng *"Hồ sơ trong kho KHÔNG còn
 * được tính hạn"*. Ba màn, ba câu trả lời cho một hồ sơ.
 *
 * Và nó không chỉ ở `/software`: cả ba nguồn hạn bên API đều loại trạng thái cuối đời ra
 * (`device` và `software` là `retired`, `isp_line` là `terminated`), nhưng cả ba màn danh sách
 * đều vẽ huy hiệu vô điều kiện. Sổ chỉ nêu một; đo ra ba.
 *
 * ===== VÌ SAO LÀ PROP CỦA BẢN DÙNG CHUNG =====
 *
 * AD-15: cần khác đi thì thêm tham số vào bản dùng chung, cấm copy ra bản riêng. Để mỗi màn
 * tự `{status === 'retired' ? <span…> : <ExpiryBadge/>}` là ba bản chép tay của cùng một câu,
 * và bản thứ tư (màn nào đó của epic sau) sẽ quên.
 *
 * Tên prop là `notCounted` chứ không phải `retired`: ISP gọi trạng thái ấy là `terminated`.
 * Đặt tên theo Ý NGHĨA thì màn thứ tư không phải tự hỏi "trạng thái của tôi có tên retired
 * đâu, chắc prop này không dành cho tôi".
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');

function dung(node: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('ExpiryBadge — notCounted', () => {
  // Một ngày chắc chắn đã qua, để nhánh "Quá hạn …" thật sự được chọn nếu prop bị bỏ qua.
  const DA_QUA = '2020-01-01';

  it('không có prop thì vẫn kêu quá hạn như cũ (vế đối chứng)', () => {
    /*
     * Ô này giữ cho ô dưới có nghĩa. Thiếu nó thì một bản `ExpiryBadge` trả về chuỗi rỗng
     * trong MỌI trường hợp cũng làm ô dưới xanh.
     */
    dung(<ExpiryBadge end={DA_QUA} />);
    expect(screen.getByText(/Quá hạn/)).toBeTruthy();
  });

  it('notCounted thì thôi nói về hạn, và nói ra VÌ SAO', () => {
    dung(<ExpiryBadge end={DA_QUA} notCounted />);
    expect(screen.queryByText(/Quá hạn/)).toBeNull();
    expect(screen.getByText('Không tính hạn')).toBeTruthy();
  });

  it('notCounted KHÔNG được để ô trống', () => {
    /*
     * Cách sửa hiển nhiên là `return null`. Một ô trống trong bảng đọc ra thành "thiếu dữ
     * liệu" — người dùng đi tìm xem ai quên nhập ngày hết hạn. Câu ngắn nói rõ "hồ sơ này
     * không còn được tính hạn" mới khớp với chính chữ mà `/disposal` đang nói.
     */
    const { container } = dung(<ExpiryBadge end={DA_QUA} notCounted />);
    expect(container.textContent?.trim()).not.toBe('');
  });

  it('notCounted thắng cả khi không có ngày hết hạn', () => {
    dung(<ExpiryBadge end={null} notCounted />);
    expect(screen.queryByText('Không có hạn')).toBeNull();
    expect(screen.getByText('Không tính hạn')).toBeTruthy();
  });
});

/**
 * ĐIỂM DANH: màn danh sách nào vẽ `ExpiryBadge` cho một hàng CÓ TRẠNG THÁI thì phải truyền
 * `notCounted`.
 *
 * Thêm prop vào component không tự nó sửa được gì — ba màn phải thật sự truyền. Và màn thứ tư
 * của epic sau sẽ quên, vì quên thì không gì đỏ: huy hiệu vẫn vẽ ra, chỉ là nói sai.
 *
 * Phạm vi cố ý HẸP — chỉ `*-screen.tsx`, tức màn danh sách. Trang chi tiết và bảng con (ghế
 * license, thẻ dashboard) nhận dữ liệu đã lọc sẵn hoặc không mang trạng thái vòng đời nào.
 */
describe('mọi màn danh sách vẽ ExpiryBadge đều khai notCounted', () => {
  /**
   * Khai tay, kèm lý do — cùng lối với `MAY_GROW` của `e2e/leak-guard.ts`: kể tên ngoại lệ ra
   * giấy, thay vì nới vị từ cho tới khi bài hết đỏ.
   */
  const MIEN_TRU: Record<string, string> = {
    // Hàng của màn này do chính cỗ máy hạn trả về, và nó đã lọc trạng thái cuối đời ở SQL.
    'features/expiry/expiry-screen.tsx': 'dữ liệu đến từ ExpirySource, đã lọc ở API',
    // Khối "sắp hết hạn" của bảng điều khiển đọc `ExpiryApiService.list()` — cùng cỗ máy đó.
    'features/dashboard/dashboard-screen.tsx': 'đọc ExpiryApiService.list(), đã lọc ở API',
  };

  const MAN_HINH = quetNguon(join(SRC, 'features'), /-screen\.tsx$/).filter((duong) =>
    readFileSync(duong, 'utf8').includes('<ExpiryBadge'),
  );

  it('tìm được các màn (vế đối chứng cho chính bài này)', () => {
    // Đổi quy ước đặt tên file mà bài này im lặng thì nó thôi canh gì cả.
    expect(MAN_HINH.length).toBeGreaterThanOrEqual(4);
  });

  it.each(MAN_HINH)('%s', (duong) => {
    const ten = duong.slice(SRC.length + 1).replace(/\\/g, '/');
    if (MIEN_TRU[ten]) return;
    expect(readFileSync(duong, 'utf8')).toContain('notCounted=');
  });
});
