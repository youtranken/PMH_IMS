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

/**
 * "CHƯA BIẾT" KHÔNG ĐƯỢC ĐỌC THÀNH "CHƯA GIỮ GÌ".
 *
 * ===== VÌ SAO ĐÂY LÀ CÂU ĐẮT NHẤT CỦA MÀN =====
 *
 * Trang chi tiết thiết bị là nơi người ta ra quyết định THANH LÝ. Cả hai nguồn nuôi bản đồ
 * (`/panels`, `/ports`) đều đi qua `?? []`, nên một lượt 500 hoá thành danh sách rỗng và bản đồ
 * in ra "Máy này chưa giữ gì của ai… Thanh lý nó không kéo theo gì cả" — cho một cái máy đang
 * giữ IP, rule NAT và ghế license. Đo được ngày 18/09/2026 bằng cách ép `/panels` trả 500.
 *
 * Bản vá thêm hai prop `isUnknown`/`isLoading`, kèm bốn khối chú thích dài. Lượt rà soát 19/09 chỉ
 * ra rằng KHÔNG bài nào truyền hai prop ấy — cả cơ chế chỉ có chú thích canh, đúng mẫu hỏng mà
 * chính đợt này gọi tên: "bản vá của đợt trước KHÔNG CHẠY".
 *
 * ===== BA CÂU =====
 *
 * Hai trạng thái chưa-biết nói hai câu khác nhau, và cả hai đều phải chặn lời khẳng định sai.
 */
describe('Bản đồ quan hệ — chưa biết thì đừng khẳng định', () => {
  const dungVoi = (props: Partial<Parameters<typeof RelationMap>[0]>) =>
    renderWithI18n(
      <MemoryRouter>
        <RelationMap hubCode="TB-E2E-01" nodes={[]} missing={['Két sắt', 'Giấy tờ']} {...props} />
      </MemoryRouter>,
    );

  it('HỎNG: nói "chưa đọc được", và KHÔNG nói "chưa gắn với gì cả"', () => {
    dungVoi({ isUnknown: true });
    expect(screen.getByText(/Chưa đọc được máy này đang giữ những gì/)).toBeTruthy();
    // Hai lời khẳng định sai ở đúng chiều nguy hiểm — cả hai phải im.
    expect(screen.queryByText(/chưa giữ gì của ai/i)).toBeNull();
    expect(screen.queryByText(/Chưa gắn:/)).toBeNull();
  });

  it('ĐANG TẢI: nói "đang đọc", KHÔNG dùng câu cảnh báo thanh lý', () => {
    dungVoi({ isUnknown: true, isLoading: true });
    expect(screen.getByText(/Đang đọc máy này đang giữ những gì/)).toBeTruthy();
    /* Câu cảnh báo kèm chỉ dẫn ("đừng dựa vào nó để quyết định thanh lý") là câu cho lúc HỎNG.
       Dùng nó cho một nhịp chờ vài trăm mili giây là mọi lượt mở trang đều nháy một cảnh báo
       sai — và vì nó nằm trong vùng sống, trình đọc màn hình đọc trọn nó lên rồi nó biến mất. */
    expect(screen.queryByText(/Đừng dựa vào nó để quyết định thanh lý/)).toBeNull();
  });

  it('BIẾT RỒI và rỗng thật: mới được nói "chưa gắn"', () => {
    dungVoi({});
    expect(screen.getByText(/Chưa gắn:/)).toBeTruthy();
    expect(screen.queryByText(/Chưa đọc được/)).toBeNull();
  });
});
