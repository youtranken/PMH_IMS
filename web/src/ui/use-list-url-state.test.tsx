import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useClampPage, useListUrlState } from '@/ui/use-list-url-state';

/**
 * TRẠNG THÁI DANH SÁCH SỐNG TRÊN THANH ĐỊA CHỈ — bài kiểm bảng dữ liệu cho luật ấy.
 *
 * ===== VÌ SAO BÀI NÀY TỒN TẠI =====
 *
 * `useListUrlState` là 185 dòng, SÁU màn danh sách đứng trên nó, và tới 18/09/2026 nó không
 * có một bài kiểm đơn vị nào — mọi lời hứa của nó chỉ được canh gián tiếp qua E2E, tức qua
 * một lượt chạy 35 phút cần cả stack docker.
 *
 * Nặng hơn: chính docblock của hook TỰ KHAI một lỗi đã lọt ra bản dùng nội bộ ("đúng lỗi đã
 * lọt vào `devices-screen.tsx` ngày 17/09, ô tìm gõ được mà bảng đứng yên"). Lỗi đó được sửa
 * bằng tay và KHÔNG có bài kiểm nào ra đời cùng nó — nên màn thứ bảy quên `searchKey` sẽ lặp
 * lại y hệt.
 *
 * Toàn bộ thứ dưới đây là logic THUẦN: đọc/kẹp tham số, quyết cái gì được ghi lên URL. Kiểm
 * được bằng bảng dữ liệu, không cần trình duyệt, không cần server.
 */

function boc(duongDan: string) {
  return function Boc({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[duongDan]}>{children}</MemoryRouter>;
  };
}

/** Dựng hook kèm một cửa sổ nhìn vào URL hiện hành, để khẳng định cả hai chiều. */
function dung(duongDan: string, tuyChon?: Parameters<typeof useListUrlState>[0]) {
  return renderHook(
    () => ({
      url: useListUrlState<Record<string, string>>(
        tuyChon ?? { emptyFilters: { status: '', siteId: '' } },
      ),
      // `search` của thanh địa chỉ — thứ người dùng copy đi gửi cho người khác.
      thanhDiaChi: useLocation().search,
    }),
    { wrapper: boc(duongDan) },
  );
}

describe('useListUrlState — đọc tham số từ URL', () => {
  const ca: { ten: string; url: string; mongDoi: Partial<{ page: number; limit: number }> }[] = [
    { ten: 'URL trống thì dùng mặc định', url: '/devices', mongDoi: { page: 1, limit: 20 } },
    { ten: 'trang hợp lệ thì giữ nguyên', url: '/devices?page=3', mongDoi: { page: 3 } },
    // `Math.max(1, …)` — trang 0 và trang âm đều vô nghĩa với người đọc.
    { ten: 'trang 0 bị kéo lên 1', url: '/devices?page=0', mongDoi: { page: 1 } },
    { ten: 'trang âm bị kéo lên 1', url: '/devices?page=-4', mongDoi: { page: 1 } },
    { ten: 'trang không phải số thì về 1', url: '/devices?page=abc', mongDoi: { page: 1 } },
    { ten: 'số dòng hợp lệ thì giữ', url: '/devices?limit=50', mongDoi: { limit: 50 } },
    /*
     * Ba ca dưới là lý do `limit` phải KẸP theo `PAGE_SIZES` chứ không chỉ `|| defaultLimit`:
     * số âm là truthy nên nó lọt qua phép `||`, và `99999` thì hợp lệ về kiểu nhưng bắt server
     * dựng một trang không ai đọc nổi. Trạng thái trên URL phải là trạng thái giao diện dựng
     * lại được — ô "Số dòng" chỉ cho chọn 10/20/50/100.
     */
    { ten: 'số dòng ÂM rơi về mặc định', url: '/devices?limit=-5', mongDoi: { limit: 20 } },
    { ten: 'số dòng quá lớn rơi về mặc định', url: '/devices?limit=99999', mongDoi: { limit: 20 } },
    { ten: 'số dòng ngoài danh sách rơi về mặc định', url: '/devices?limit=37', mongDoi: { limit: 20 } },
  ];

  for (const { ten, url, mongDoi } of ca) {
    it(ten, () => {
      const { result } = dung(url);
      expect(result.current.url).toMatchObject(mongDoi);
    });
  }

  it('bộ lọc lạ trên URL vẫn đọc được, nhưng chỉ những khóa đã khai', () => {
    const { result } = dung('/devices?status=retired&khongKhai=xyz');
    expect(result.current.url.filters).toEqual({ status: 'retired', siteId: '' });
  });
});

describe('useListUrlState — chỉ ghi lên URL thứ KHÁC mặc định', () => {
  it('đặt bộ lọc thì nó lên thanh địa chỉ', () => {
    const { result } = dung('/devices');
    act(() => result.current.url.setFilter('status', 'retired'));
    expect(result.current.thanhDiaChi).toContain('status=retired');
  });

  it('đặt bộ lọc về rỗng thì XÓA khỏi thanh địa chỉ, không để `status=`', () => {
    const { result } = dung('/devices?status=retired');
    act(() => result.current.url.setFilter('status', ''));
    expect(result.current.thanhDiaChi).not.toContain('status');
  });

  it('trang 1 và số dòng mặc định KHÔNG ghi lên URL — link gửi đi phải sạch', () => {
    const { result } = dung('/devices?page=3&limit=50');
    act(() => result.current.url.setPage(1));
    act(() => result.current.url.setLimit(20));
    expect(result.current.thanhDiaChi).not.toContain('page=');
    expect(result.current.thanhDiaChi).not.toContain('limit=');
  });

  it('đổi bộ lọc thì về trang 1 — giữ trang 5 của tập cũ là nhìn vào bảng rỗng', () => {
    const { result } = dung('/devices?page=5');
    act(() => result.current.url.setFilter('status', 'retired'));
    expect(result.current.thanhDiaChi).not.toContain('page=');
  });
});

/**
 * HAI LƯỢT GHI TRONG CÙNG MỘT NHỊP.
 *
 * `ui/pagination.tsx` gọi `onLimitChange(10)` rồi `onPageChange(1)` liền nhau, chưa có lượt
 * render nào xen vào giữa. Không có mẹo `latest` ref thì cả hai cùng dựng URL mới từ CÙNG một
 * bản gốc và lượt sau đè mất lượt trước — triệu chứng đúng như bài E2E mô tả: bấm "10" xong
 * bảng vẫn 20 dòng, ô "Số dòng" trông như chỉ để trang trí.
 *
 * Thời `useState` lỗi này không lộ ra vì `limit` và `page` là hai ô state rời nhau; gom cả
 * bốn thứ lên một sợi dây duy nhất thì thứ tự ghi mới bắt đầu có nghĩa.
 */
describe('useListUrlState — hai lượt ghi liền nhau không đè nhau', () => {
  it('đổi số dòng rồi về trang 1: số dòng PHẢI còn', () => {
    const { result } = dung('/devices?page=4&limit=50');
    act(() => {
      result.current.url.setLimit(10);
      result.current.url.setPage(1);
    });
    expect(result.current.url.limit).toBe(10);
    expect(result.current.thanhDiaChi).toContain('limit=10');
    expect(result.current.thanhDiaChi).not.toContain('page=');
  });

  it('đặt hai bộ lọc liền nhau: cả hai cùng còn', () => {
    const { result } = dung('/devices');
    act(() => {
      result.current.url.setFilter('siteId', 'HN');
      result.current.url.setFilter('status', 'active');
    });
    expect(result.current.url.filters).toMatchObject({ siteId: 'HN', status: 'active' });
  });
});

/**
 * `searchKey` — khóa mà màn dùng để nhận giá trị ô tìm ĐÃ LẮNG.
 *
 * Khai nó thì `filters` trả về đã có sẵn từ khóa, nên hàm dựng query của màn không phải đổi
 * một chữ. KHÔNG khai thì `filters.search` luôn rỗng và tham số `search=` lặng lẽ không được
 * gửi lên API — ô tìm gõ được mà bảng đứng yên, đúng lỗi đã lọt ngày 17/09.
 */
describe('useListUrlState — searchKey', () => {
  it('khai searchKey thì giá trị ô tìm chảy vào filters', () => {
    const { result } = dung('/devices?q=SW-CORE', {
      emptyFilters: { status: '', search: '' },
      searchKey: 'search',
    });
    expect(result.current.url.filters.search).toBe('SW-CORE');
    // Ô nhập cũng phải hiện lại giá trị đó khi mở link sâu.
    expect(result.current.url.searchInput).toBe('SW-CORE');
  });

  it('KHÔNG khai searchKey thì filters.search rỗng dù URL có q= — đây là cái bẫy', () => {
    const { result } = dung('/devices?q=SW-CORE', {
      emptyFilters: { status: '', search: '' },
    });
    expect(result.current.url.search).toBe('SW-CORE');
    expect(result.current.url.filters.search).toBe('');
  });
});

/**
 * DEBOUNCE 250ms + ĐỒNG BỘ NGƯỢC — hai lời hứa ghép vào nhau từng thành một chốt chết.
 *
 * Đợt rà 19/09/2026 chỉ ra 18 ca bên trên KHÔNG ca nào gọi `setSearchInput`, tức không ca nào
 * chạm hai lời hứa vừa vá ngày 18/09. Gỡ phép so đã-trim ra khỏi hook thì cả 18 vẫn xanh.
 *
 * Hai ca dưới đây khoá đúng hai lời hứa ấy, và ca thứ hai khoá hậu quả mà chúng gây ra khi
 * ghép: dấu cách thừa làm chốt `searchInput === search` không bao giờ đúng, effect debounce
 * sống mãi, và mỗi lần `location.search` đổi là 250ms sau `page` bị xoá — bảng nhảy về trang 1
 * dưới tay người đang đọc trang 3.
 */
describe('useListUrlState — ô tìm: debounce và dấu cách', () => {
  it('gõ xong thì 250ms sau mới lên URL, và dấu cách người dùng gõ KHÔNG bị nuốt', async () => {
    vi.useFakeTimers();
    try {
      const { result } = dung('/devices', {
        emptyFilters: { status: '', search: '' },
        searchKey: 'search',
      });

      act(() => result.current.url.setSearchInput('máy in '));
      // Chưa tới hạn: URL còn im, ô nhập giữ nguyên từng ký tự.
      expect(result.current.thanhDiaChi).toBe('');
      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      expect(result.current.thanhDiaChi).toContain('q=m');
      // URL nhận bản đã rút gọn; ô nhập GIỮ dấu cách để gõ tiếp không thành "máy inHP".
      expect(result.current.url.search).toBe('máy in');
      expect(result.current.url.searchInput).toBe('máy in ');
    } finally {
      vi.useRealTimers();
    }
  });

  it('dấu cách thừa KHÔNG được làm bảng nhảy về trang 1 khi người dùng đổi trang', async () => {
    vi.useFakeTimers();
    try {
      const { result } = dung('/devices', {
        emptyFilters: { status: '', search: '' },
        searchKey: 'search',
      });

      act(() => result.current.url.setSearchInput('máy in '));
      await act(async () => {
        vi.advanceTimersByTime(250);
      });

      act(() => result.current.url.setPage(3));
      expect(result.current.url.page).toBe(3);

      // Nhịp debounce kế tiếp không được phép động tới `page`.
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(result.current.url.page).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * ===== `isFiltered` — câu hỏi mà bốn màn đang trả lời SAI =====
   *
   * Bốn màn danh sách (`devices` · `software` · `isp` · `serviceAccounts`) dùng MỘT câu rỗng
   * cho HAI cảnh khác hẳn nhau, nên một hệ thống mới tinh chưa ai lọc gì vẫn báo "Chưa có
   * thiết bị nào **khớp bộ lọc**". Người dùng mới đọc câu đó sẽ đi tìm cái bộ lọc không tồn tại.
   *
   * Câu trả lời nằm sẵn trong hook: nó giữ cả `filters` lẫn `search`. Đặt ở đây chứ không để
   * mỗi màn tự tính `Object.values(...).some(...)` — sáu bản chép tay là sáu cơ hội quên một
   * khoá (AD-15).
   *
   * ĐÂY LÀ LẦN THỨ HAI thứ này được thêm vào hook. Bản đầu tên `dirty`, bị GỠ ngày 18/09 vì
   * **không một màn nào gọi** — nó được viết sẵn cho một cái nút "Xóa lọc" chưa bao giờ làm,
   * và chú thích chỗ gỡ nói đúng: mã chưa từng chạy chỉ làm người đọc sau tưởng việc đã xong.
   * Lần này khác ở đúng một chỗ đáng kể: nó ra đời CÙNG bốn nơi gọi, trong cùng một commit.
   */
  describe('isFiltered — "đang lọc" khác "chưa có gì"', () => {
    const BANG: ReadonlyArray<readonly [string, string, boolean]> = [
      ['mở màn trơn', '/devices', false],
      // Phân trang và sắp cột KHÔNG phải là lọc: chúng không giấu dòng nào đi.
      ['chỉ có phân trang', '/devices?page=3&limit=50', false],
      ['chỉ có sắp cột', '/devices?sort=name&dir=desc', false],
      ['một bộ lọc đang bật', '/devices?status=in_use', true],
      ['ô tìm có chữ', '/devices?q=may%20in', true],
      ['bộ lọc khai rỗng thì không tính', '/devices?status=', false],
    ];

    it.each(BANG)('%s → %s', (_ten, duongDan, mongDoi) => {
      const { result } = dung(duongDan, {
        emptyFilters: { status: '', siteId: '', search: '' },
        searchKey: 'search',
      });
      expect(result.current.url.isFiltered).toBe(mongDoi);
    });

    it('gõ vào ô tìm rồi xóa đi thì quay lại "chưa lọc"', async () => {
      vi.useFakeTimers();
      try {
        const { result } = dung('/devices', {
          emptyFilters: { status: '', search: '' },
          searchKey: 'search',
        });
        expect(result.current.url.isFiltered).toBe(false);

        act(() => result.current.url.setSearchInput('may in'));
        await act(async () => {
          vi.advanceTimersByTime(500);
        });
        expect(result.current.url.isFiltered).toBe(true);

        act(() => result.current.url.setSearchInput(''));
        await act(async () => {
          vi.advanceTimersByTime(500);
        });
        expect(result.current.url.isFiltered).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('useClampPage — trang theo kịp tổng số dòng mới nhất', () => {
  function dungKep(duongDan: string, total: number | undefined) {
    return renderHook(
      ({ tong }: { tong: number | undefined }) => {
        const url = useListUrlState<Record<string, string>>({ emptyFilters: { status: '' } });
        useClampPage(url, tong);
        return { url, thanhDiaChi: useLocation().search };
      },
      { wrapper: boc(duongDan), initialProps: { tong: total } },
    );
  }

  it('?page=99 mà chỉ có 40 dòng thì về trang 2', () => {
    const { result } = dungKep('/devices?page=99', 40);
    expect(result.current.url.page).toBe(2);
    expect(result.current.thanhDiaChi).toBe('?page=2');
  });

  it('xoá dòng cuối của trang cuối (41 → 40) thì lùi về trang 2', () => {
    const { result, rerender } = dungKep('/devices?page=3', 41);
    expect(result.current.url.page).toBe(3);
    rerender({ tong: 40 });
    expect(result.current.url.page).toBe(2);
  });

  it('chưa có tổng (đang tải) thì không đụng vào trang', () => {
    const { result } = dungKep('/devices?page=5', undefined);
    expect(result.current.url.page).toBe(5);
  });

  it('danh sách rỗng hẳn thì về trang 1 và URL sạch', () => {
    const { result } = dungKep('/devices?page=4', 0);
    expect(result.current.url.page).toBe(1);
    expect(result.current.thanhDiaChi).toBe('');
  });
});
