/// <reference types="node" />
// `tsconfig.app.json` đặt `types: ['vite/client']` nên `node:fs` không tự phân giải.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { quetNguon } from '@/test/quet-nguon';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ĐIỂM DANH: mọi hộp hỏi lại đều phải nói nó đang hỏi về CÁI GÌ.
 *
 * ===== LỖ =====
 *
 * `useConfirm` để `title` là tùy chọn và rơi về `app.confirmTitle` = "Xác nhận". Không có cửa
 * canh thì phần lớn chỗ gọi quên truyền `title`. Nặng nhất là nút đóng phiên ở màn Tài khoản —
 * bảng có nhiều dòng phiên, hộp mở ra đội chữ "Xác nhận" và hỏi "… phiên đăng nhập này?",
 * trong khi chính nó vừa che mất cái bảng chứa chữ "này".
 *
 * ===== VÌ SAO LÀ MỘT BÀI KIỂM, KHÔNG PHẢI MỘT LẦN SỬA =====
 *
 * Sửa các chỗ hôm nay không ngăn được chỗ viết mai. `title` vẫn là tùy chọn (và phải vậy — có
 * những hộp thật sự không có chủ thể nào để nêu), nên thứ giữ luật phải là một cửa canh đọc
 * mã nguồn. Cùng lối với `features/history-action-rollcall.test.ts`.
 *
 * Cần một ngoại lệ thì khai vào `KHONG_CAN_TIEU_DE` KÈM LÝ DO — đó là chỗ để giải thích, không
 * phải chỗ để dập tắt cảnh báo.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');

/** Chỗ gọi được phép không có `title`, kèm lý do. Khóa là đường dẫn tương đối từ `web/src`. */
const KHONG_CAN_TIEU_DE: Record<string, string> = {
  'features/dev/components-gallery.tsx':
    'Trang trình diễn bộ giao diện ở /dev/components — nó cố ý gọi `askConfirm` ở dạng TRẦN NHẤT để người đọc thấy API tối thiểu trông thế nào. Thêm `title` vào đây là làm ví dụ nói dối về cái tối thiểu.',
};

/* Bản dùng chung: nó bỏ qua thư mục `__lint-probe__*` mà `lint-rules.test.ts` tạo/xoá song
   song — thiếu điều đó thì bài này đỏ ngẫu nhiên với ENOENT. Xem `test/quet-nguon.ts`. */
const walk = (dir: string): string[] => quetNguon(dir, /\.tsx$/);

/**
 * Bỏ các khối chú thích trước khi quét.
 *
 * Cần thật, không phải cho đẹp: chú thích trong `confirm-provider.tsx` và `approvals-screen.tsx`
 * đều VIẾT RA mẫu gọi `askConfirm({ … })` để giải thích API. Quét cả chú thích thì hai chỗ đó
 * hiện ra như hai lỗi, và người sửa sẽ đi thêm `title` vào một đoạn văn.
 *
 * Chỉ bỏ khối, không bỏ `//`: mẫu gọi luôn nằm trong khối, còn cắt `//` thì phải phân biệt với
 * `https://` trong chuỗi — thêm rủi ro mà không thêm gì.
 */
function boChuThichKhoi(source: string): string {
  // `.` KHÔNG khớp xuống dòng (không có cờ `s`), nên thay bằng khoảng trắng là giữ nguyên
  // số dòng — báo lỗi vẫn chỉ đúng chỗ.
  return source.replace(/\/\*[\s\S]*?\*\//g, (khoi) => khoi.replace(/./g, ' '));
}

/** Cắt đúng thân object `askConfirm({ … })` bằng cách đếm ngoặc nhọn. */
function thanObject(source: string, tu: number): string {
  let sau = 1;
  let i = tu;
  while (i < source.length && sau > 0) {
    if (source[i] === '{') sau += 1;
    else if (source[i] === '}') sau -= 1;
    i += 1;
  }
  return source.slice(tu, i);
}

describe('Tiêu đề của hộp hỏi lại', () => {
  const thieu: string[] = [];
  let tong = 0;

  for (const file of walk(SRC)) {
    if (file.endsWith('.test.tsx')) continue;
    const source = boChuThichKhoi(readFileSync(file, 'utf8'));
    const tuongDoi = file.slice(SRC.length + 1).replace(/\\/g, '/');
    for (const m of source.matchAll(/askConfirm\(\{/g)) {
      tong += 1;
      if (tuongDoi in KHONG_CAN_TIEU_DE) continue;
      if (!/\btitle:/.test(thanObject(source, m.index + m[0].length))) {
        thieu.push(`${tuongDoi}:${source.slice(0, m.index).split('\n').length}`);
      }
    }
  }

  /*
   * SÀN CHỐNG REGEX HỤT. Đổi cách gọi (`askConfirm(opts)` với biến, xuống dòng sau dấu ngoặc)
   * làm vòng lặp trên không tìm thấy gì, và một bài "mọi chỗ tìm được đều có tiêu đề" sẽ xanh
   * trong khi nó chẳng kiểm gì. 22 là mức sàn dưới số chỗ gọi thật (đếm sau khi bỏ chú thích).
   */
  it('đọc được các chỗ gọi askConfirm (nếu không thì cả bài này vô nghĩa)', () => {
    expect(tong).toBeGreaterThanOrEqual(22);
  });

  it('mọi hộp hỏi lại đều nêu rõ đang hỏi về cái gì', () => {
    // Vitest in nguyên mảng khi đỏ, nên người đọc thấy luôn file:dòng cần sửa.
    expect(thieu).toEqual([]);
  });
});
