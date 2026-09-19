import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
/* Đường dẫn tương đối, không `@/features/...`: luật AD-15 trong `web/eslint.config.js` cấm
   alias đó ngay cả khi đích nằm trong CÙNG feature — xem thông điệp của `no-restricted-imports`. */
import { RelationMap } from './relation-map';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * NÚT "XEM LƯỢT THANH LÝ CẮT GÌ" PHẢI CÓ ĐÍCH THẬT.
 *
 * ===== LỖ ĐANG VÁ =====
 *
 * Nút khai `aria-controls="rmap-cut-sum"`, nhưng khu mang id ấy chỉ được render KHI ĐÃ BẤM.
 * Ở trạng thái mặc định — trạng thái người dùng gặp đầu tiên — nó trỏ vào hư vô: axe báo
 * `aria-valid-attr-value`, và người dùng JAWS ra lệnh "nhảy tới khu được điều khiển" thì
 * không có gì để nhảy tới.
 *
 * Kèm theo: khu ấy mang `role="status"` mà lại được TẠO RA cùng lúc với nội dung của nó. Trình
 * đọc màn hình chỉ theo dõi vùng sống đã có mặt TRƯỚC khi nội dung đổi, nên một node mới chèn
 * vào kèm sẵn chữ thường không được đọc lên — vùng sống ấy câm đúng lúc nó phải nói.
 *
 * ===== BÀI NÀY HỎI GÌ =====
 *
 * Đây là mẫu DISCLOSURE (người dùng tự bấm để bung), không phải THÔNG BÁO (tin tự đến). Nên:
 * đích của `aria-controls` phải có mặt từ đầu, và nút phải khai `aria-expanded` — thứ nói "bấm
 * vào sẽ bung ra cái kia" — chứ không phải `aria-pressed`, thứ chỉ nói về chính cái nút.
 */

function dung() {
  renderWithI18n(
    <MemoryRouter>
      <RelationMap
        hubCode="TB-E2E-01"
        nodes={[]}
        missing={[]}
        cutSummary="Cắt 2 IP, giữ 1 ghế license."
      />
    </MemoryRouter>,
  );
}

describe('Bản đồ quan hệ — khu "cắt gì" là disclosure', () => {
  it('đích của aria-controls có mặt NGAY khi chưa bấm', () => {
    dung();
    const nut = screen.getByRole('button', { name: /cắt gì|thanh lý/i });
    const dich = nut.getAttribute('aria-controls')!;
    expect(dich).toBeTruthy();

    const khu = document.getElementById(dich);
    // Có mặt trong DOM, nhưng đang ẩn — hai chuyện khác nhau.
    expect(khu).not.toBeNull();
    expect(khu!.hasAttribute('hidden')).toBe(true);
  });

  it('bấm thì bung ra, và nút khai aria-expanded chứ không phải aria-pressed', async () => {
    const user = userEvent.setup();
    dung();
    const nut = screen.getByRole('button', { name: /cắt gì|thanh lý/i });

    expect(nut.getAttribute('aria-expanded')).toBe('false');
    expect(nut.hasAttribute('aria-pressed')).toBe(false);

    await user.click(nut);

    const khu = document.getElementById(nut.getAttribute('aria-controls')!)!;
    expect(khu.hasAttribute('hidden')).toBe(false);
    expect(khu.textContent).toContain('Cắt 2 IP');
    // Dùng lại chính node nút: nhãn của nó đổi sau khi bấm (`cutOn` → `cutOff`), nên truy vấn
    // lại theo tên sẽ trượt — mà thứ đang kiểm là thuộc tính, không phải cái tên.
    expect(nut.getAttribute('aria-expanded')).toBe('true');
  });
});
