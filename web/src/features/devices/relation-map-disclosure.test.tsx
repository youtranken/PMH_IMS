import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
/* Đường dẫn tương đối, không `@/features/...`: luật AD-15 trong `web/eslint.config.js` cấm
   alias đó ngay cả khi đích nằm trong CÙNG feature — xem thông điệp của `no-restricted-imports`. */
import { RelationMap, type RelationNode } from './relation-map';
import { renderWithI18n, screen, within } from '@/test/test-utils';

/**
 * BỐ CỤC LƯỚI CỐ ĐỊNH (DEV-043, DEV-044, DEV-050).
 *
 * Toạ độ phần trăm trên hình bầu dục cho nút đè lên hạch và lên nhau ở cột hẹp, số đếm bị cắt
 * ở mép nút, và câu "chưa giữ gì" đè thẳng lên hạch. Lưới ba cột (trái · hạch · phải) không
 * thể chồng nhau; jsdom không đo được bố cục nên bài này canh CẤU TRÚC sinh ra bố cục ấy.
 */
function node(key: string, count: number): RelationNode {
  return { key, title: `Khu ${key}`, count, icon: 'ip', cut: true, onOpen: () => {}, lines: [] };
}

describe('Bản đồ quan hệ — lưới cố định', () => {
  it('rỗng thật: KHÔNG vẽ hạch, chỉ còn câu nói máy chưa giữ gì', () => {
    renderWithI18n(
      <MemoryRouter>
        <RelationMap hubCode="TB-E2E-01" nodes={[]} missing={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/không giữ IP, luật NAT/i)).toBeTruthy();
    expect(screen.queryByText('TB-E2E-01')).toBeNull();
  });

  it('chia nút đều hai cột quanh hạch, số đếm nằm TRONG nút', () => {
    renderWithI18n(
      <MemoryRouter>
        <RelationMap
          hubCode="TB-E2E-01"
          nodes={[node('a', 7), node('b', 1), node('c', 2)]}
          missing={[]}
        />
      </MemoryRouter>,
    );
    const left = screen.getByTestId('rmap-left');
    const right = screen.getByTestId('rmap-right');
    expect(within(left).getAllByRole('button')).toHaveLength(2);
    expect(within(right).getAllByRole('button')).toHaveLength(1);
    expect(within(left).getByRole('button', { name: /Khu a.*7/ })).toBeTruthy();
    expect(screen.getByTestId('rmap-hub').textContent).toBe('TB-E2E-01');
  });

  it('không còn nút "Xem lượt thanh lý cắt gì" — phần đó ở trong hộp Thanh lý', () => {
    renderWithI18n(
      <MemoryRouter>
        <RelationMap hubCode="TB-E2E-01" nodes={[node('a', 1)]} missing={[]} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: /cắt gì/i })).toBeNull();
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
    expect(screen.queryByText(/không giữ IP, luật NAT/i)).toBeNull();
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
