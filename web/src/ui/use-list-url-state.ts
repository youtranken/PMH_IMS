import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PAGE_SIZES } from '@/ui/pagination';
import { clampPage } from '@/lib/paging';

/**
 * Trạng thái của MỘT màn danh sách — bộ lọc, trang, số dòng, cột sắp — sống trên THANH ĐỊA CHỈ
 * chứ không trong `useState`.
 *
 * VÌ SAO ĐỔI (17/09/2026). Trước đây `devices-screen.tsx` và các màn danh sách khác giữ tất cả
 * trong `useState`. Ba hậu quả, và cả ba đều là chuyện xảy ra hằng ngày:
 *   · F5 là mất sạch bộ lọc — đang soi "máy hỏng ở tủ T-1" thì tải lại trang là về đầu;
 *   · không gửi được link cho đồng nghiệp: "mở cái danh sách tôi đang xem" thành một đoạn
 *     hướng dẫn bấm năm bước;
 *   · và đau nhất: mở một máy ra xem rồi bấm Back thì **về một danh sách trắng**, phải lọc lại
 *     từ đầu. Với 100+ thiết bị thì đó là một cú mỗi lần.
 *
 * Trang chi tiết vốn đã làm đúng chuyện này từ lâu (`?tab=`); màn danh sách thì chưa.
 *
 * KHÓA NGẮN, MẶC ĐỊNH THÌ KHÔNG GHI: URL chỉ mang thứ KHÁC mặc định, nên đường dẫn sạch
 * (`/devices` chứ không phải `/devices?page=1&limit=20&sort=code`), và một link đã gửi đi vẫn
 * mở ra đúng cái người gửi đang nhìn.
 */

export interface SortState {
  key: string;
  desc: boolean;
}

export interface ListUrlState<F extends Record<string, string>> {
  /** Giá trị đang GÕ trong ô tìm — đổi ngay để ô không giật. */
  searchInput: string;
  setSearchInput: (value: string) => void;
  /** Giá trị đã lắng (debounce) — thứ dùng để gọi API. */
  search: string;
  filters: F;
  setFilter: (key: keyof F, value: string) => void;
  page: number;
  setPage: (value: number) => void;
  limit: number;
  setLimit: (value: number) => void;
  sorting: SortState;
  setSorting: (value: SortState) => void;
  /**
   * Có bộ lọc nào đang bật, hoặc ô tìm có chữ, hay không.
   *
   * Dùng để chọn giữa HAI câu rỗng khác hẳn nhau: "chưa khai gì" (mời người dùng thêm bản ghi
   * đầu tiên) và "lọc không ra" (mời họ nới bộ lọc). Trước 23/09 bốn màn dùng chung một câu,
   * nên hệ thống mới tinh chưa ai lọc gì vẫn báo "Chưa có thiết bị nào khớp bộ lọc".
   *
   * `page`/`limit`/`sort` KHÔNG tính: chúng không giấu dòng nào đi, nên nới chúng ra cũng
   * không làm bảng có thêm gì.
   */
  isFiltered: boolean;
  /** Số bộ lọc đang bật (ô tìm có chữ tính là một) — cho nút "Xóa lọc (n)". */
  activeCount: number;
  /** Gỡ mọi bộ lọc và ô tìm trong một lượt ghi URL. */
  clearFilters: () => void;
}

/**
 * Kéo `page` về trang cuối còn tồn tại mỗi khi API trả về `total` mới.
 *
 * Phải là hook RIÊNG gọi ở màn, không nằm trong `<Pagination>`: đứng ở trang không tồn tại thì
 * API trả `items: []`, màn rẽ sang `<EmptyState>` và `<Pagination>` không còn được dựng — nên
 * không còn ai để kéo trang về. `total` chưa có (đang tải lần đầu) thì không đụng vào gì.
 */
export function useClampPage(
  state: { page: number; limit: number; setPage: (value: number) => void },
  total: number | undefined,
): void {
  const { page, limit, setPage } = state;
  const safe = total === undefined ? page : clampPage(page, total, limit);
  useEffect(() => {
    if (safe !== page) setPage(safe);
    // `setPage` là hàm mới mỗi lượt render; chỉ cần chạy lại khi con số đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safe, page]);
}

export function useListUrlState<F extends Record<string, string>>(options: {
  /** Khóa bộ lọc và giá trị rỗng của chúng, vd `{ siteId: '', status: '' }`. */
  emptyFilters: F;
  /**
   * Hai thứ này KHÔNG bắt buộc (nới 17/09/2026): có màn danh sách không phân trang và không
   * sắp theo cột — Két sắt là một, nó tải cả danh sách rồi lọc ở client. Bắt chúng khai hai
   * tham số vô nghĩa chỉ để dùng được ô tìm là cách chắc chắn để người sau gõ đại một con số
   * rồi tưởng nó có tác dụng.
   */
  defaultLimit?: number;
  defaultSort?: SortState;
  /**
   * Khóa trong `F` nhận giá trị ô tìm ĐÃ LẮNG (thường là `'search'`). Khai nó thì `filters` trả
   * về đã có sẵn từ khoá, nên `buildFilterQuery(filters)` của màn không phải đổi một chữ.
   */
  searchKey?: keyof F;
}): ListUrlState<F> {
  const {
    emptyFilters,
    defaultLimit = 20,
    defaultSort = { key: '', desc: false },
    searchKey,
  } = options;
  const [params, setParams] = useSearchParams();

  const read = useCallback(
    (key: string, fallback = '') => params.get(key) ?? fallback,
    [params],
  );

  const search = read('q');

  const filters = useMemo(() => {
    const out = { ...emptyFilters };
    for (const key of Object.keys(emptyFilters)) {
      (out as Record<string, string>)[key] = params.get(key) ?? '';
    }
    /*
     * Ô tìm sống dưới khóa NGẮN `q` trên URL, nhưng mọi màn danh sách đã có sẵn một hàm
     * `buildFilterQuery(filters)` đọc `filters.search` để dựng tham số gửi API. Không nối hai
     * chỗ đó lại thì ô tìm vẫn gõ được, URL vẫn đổi `?q=…`, mà **API không bao giờ nhận
     * `search=`** — bảng đứng yên và không có lỗi nào để lần. Chính cái bẫy đó đã lọt vào
     * `devices-screen.tsx` ở lượt port đầu; đặt lời giải ở đây để bảy màn còn lại khỏi vấp lại.
     */
    if (searchKey) (out as Record<string, string>)[searchKey as string] = search;
    return out;
    // `params`/`search` đổi là đọc lại; `emptyFilters` và `searchKey` là hằng của màn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, search]);

  const page = Math.max(1, Number.parseInt(read('page', '1'), 10) || 1);
  /*
   * `limit` PHẢI nằm trong danh sách mà ô "Số dòng" bày ra (18/09/2026).
   *
   * `page` đã kẹp `Math.max(1, …)` từ đầu, `limit` thì không — và `|| defaultLimit` không cứu
   * được vì số ÂM là truthy. Nên `?limit=-5` đi thẳng vào `queryKey` rồi lên API, `?limit=99999`
   * cũng vậy: một người sửa tay thanh địa chỉ (hoặc một link ai đó gửi) bắt server dựng một
   * trang 99999 dòng. Trần đó là việc của server, nhưng web không có lý do gì để HỎI.
   *
   * Kẹp về đúng `PAGE_SIZES` — tập mà `ui/pagination.tsx` cho chọn — nên trạng thái trên URL
   * luôn là trạng thái mà giao diện dựng lại được. Giá trị lạ rơi về mặc định của màn.
   */
  const limitTho = Number.parseInt(read('limit', String(defaultLimit)), 10);
  const limit = (PAGE_SIZES as readonly number[]).includes(limitTho) ? limitTho : defaultLimit;
  const sortKey = read('sort', defaultSort.key);
  const dirParam = params.get('dir');
  const sorting: SortState = {
    key: sortKey,
    // Không ghi `dir` trên URL = dùng chiều mặc định của CỘT MẶC ĐỊNH; đổi sang cột khác thì
    // mặc định là tăng dần, đó là thứ người ta chờ đợi khi bấm một tiêu đề cột lần đầu.
    desc: dirParam ? dirParam === 'desc' : sortKey === defaultSort.key && defaultSort.desc,
  };

  /*
   * Ô tìm giữ bản GÕ riêng: đẩy thẳng mỗi phím lên URL thì mỗi ký tự là một mục trong lịch sử
   * trình duyệt, bấm Back mười lần mới thoát khỏi một từ vừa gõ.
   */
  const [searchInput, setSearchInput] = useState(search);
  /*
   * ĐỒNG BỘ NGƯỢC CHỈ KHI URL ĐỔI TỪ BÊN NGOÀI (18/09/2026).
   *
   * Effect này sinh ra cho Back/Forward và cho link sâu: URL đổi thì ô nhập phải theo. Nhưng
   * bản trước ghi đè VÔ ĐIỀU KIỆN, kể cả khi URL vừa đổi do CHÍNH lượt debounce của nó — và
   * vì lượt ghi có `.trim()`, dấu cách người dùng vừa gõ bị nuốt mất ngay dưới con trỏ: gõ
   * "máy in " rồi dừng 250ms là mất dấu cách, gõ tiếp thành "máy inHP".
   *
   * So bằng bản ĐÃ TRIM: nếu ô nhập rút gọn lại đúng bằng `search` thì không có gì từ bên
   * ngoài để áp vào cả, đừng động vào thứ người ta đang gõ.
   */
  useEffect(() => {
    setSearchInput((previous) => (previous.trim() === search ? previous : search));
  }, [search]);

  /*
   * BẢN MỚI NHẤT CỦA THAM SỐ, giữ trong một ref — không đọc lại từ `params` của lượt render.
   *
   * VÌ SAO (bắt được 17/09/2026 bởi bài "phân trang ăn thật"). `ui/pagination.tsx` gọi HAI lượt
   * ghi liền nhau trong cùng một nhịp khi người dùng đổi số dòng:
   *     onLimitChange(10);   // → ghi limit
   *     onPageChange(1);     // → xoá page
   * Chưa có lượt render nào xen vào giữa, nên cả hai cùng dựng URL mới từ CÙNG một bản gốc, và
   * lượt sau đè mất `limit=10` của lượt trước. Triệu chứng đúng như bài kiểm mô tả: bấm "10"
   * xong bảng vẫn 20 dòng, ô "Số dòng" trông như chỉ để trang trí.
   *
   * Thời `useState` không lộ ra vì `limit` và `page` là hai ô state rời nhau. Gom cả bốn thứ
   * lên một sợi dây duy nhất (thanh địa chỉ) thì thứ tự ghi bắt đầu có nghĩa — và đây là cái
   * giá phải trả, trả một lần ở đây thay vì bắt mỗi màn tự nhớ.
   */
  const latest = useRef(params);
  latest.current = params;

  const write = useCallback(
    (patch: Record<string, string | number | boolean | null>, resetPage = true) => {
      const next = new URLSearchParams(latest.current);
      for (const [key, value] of Object.entries(patch)) {
        const text = value === null || value === false ? '' : String(value);
        if (text === '') next.delete(key);
        else next.set(key, text);
      }
      if (resetPage) next.delete('page');
      // Ghi lại ngay để lượt ghi THỨ HAI trong cùng nhịp nối tiếp bản này, không quay về bản cũ.
      latest.current = next;
      setParams(next, {
        // `replace` để mỗi lần đổi bộ lọc KHÔNG thêm một mục lịch sử: người dùng bấm Back là
        // muốn rời khỏi màn, không phải đi lùi qua mười hai lần chỉnh bộ lọc.
        replace: true,
      });
    },
    [setParams],
  );

  /*
   * Gõ xong 250ms mới đẩy lên URL (và do đó mới gọi API). Trước đây mỗi phím là một request:
   * gõ "SW-CORE-01" là mười lượt gọi, chín lượt vứt đi.
   *
   * SO BẰNG BẢN ĐÃ TRIM, GIỐNG HỆT EFFECT ĐỒNG BỘ NGƯỢC BÊN TRÊN (19/09/2026).
   *
   * Chốt cũ `searchInput === search` KHÔNG BAO GIỜ đúng khi ô nhập còn dấu cách thừa — vì lượt
   * ghi `.trim()` trước khi lên URL, còn effect đồng bộ ngược thì cố ý GIỮ dấu cách ấy lại. Hai
   * bản vá đúng, ghép vào nhau thành một chốt chết: effect này sống mãi. Mà mỗi lần
   * `location.search` đổi thì `setParams` của react-router đổi định danh → `write` đổi → effect
   * bắn lại → 250ms sau `write({ q })` chạy với `resetPage` mặc định TRUE và xoá `page`.
   *
   * Người dùng gõ "máy in " (có dấu cách cuối) rồi bấm sang trang 3: một phần tư giây sau bảng
   * tự nhảy về trang 1, không thao tác nào giải thích. Gõ không dấu cách thì không sao — nên nó
   * rất khó lần. Dính cả `setFilter` và `setSorting` vì cả hai đều đổi `location.search`.
   */
  useEffect(() => {
    if (searchInput.trim() === search) return;
    const timer = setTimeout(() => write({ q: searchInput.trim() }), 250);
    return () => clearTimeout(timer);
  }, [searchInput, search, write]);

  return {
    searchInput,
    setSearchInput,
    search,
    filters,
    /*
     * Đọc từ `filters` chứ không từ `params`: `filters` đã gộp sẵn ô tìm vào khoá `searchKey`
     * (xem chú thích chỗ dựng nó), nên một chỗ này phủ cả hai nguồn. Đọc `params` thì phải tự
     * nhớ loại `page`/`limit`/`sort`/`dir` ra — và người thêm tham số URL thứ năm sẽ quên.
     *
     * Dùng `search` ĐÃ LẮNG chứ không phải `searchInput`: câu rỗng phải khớp với DỮ LIỆU đang
     * bày, mà dữ liệu chỉ đổi sau nhịp debounce. Lấy `searchInput` thì trong 300ms gõ dở, màn
     * đã đổi sang câu "lọc không ra" trong khi bảng vẫn đang hiện kết quả cũ.
     */
    isFiltered: Object.values(filters).some((value) => value !== ''),
    setFilter: (key, value) => write({ [key as string]: value }),
    page,
    setPage: (value) => write({ page: value === 1 ? '' : value }, false),
    limit,
    setLimit: (value) => write({ limit: value === defaultLimit ? '' : value }),
    sorting,
    setSorting: (value) => {
      const isDefault = value.key === defaultSort.key && value.desc === defaultSort.desc;
      /* Cột mặc định sắp GIẢM (vd "mới nhất trước") thì chiều tăng phải ghi rõ `dir=asc`:
         vắng `dir` là lúc đọc lại rơi về chiều mặc định của cột ấy, và lựa chọn mất tác dụng. */
      const ascOnDescDefault = value.key === defaultSort.key && defaultSort.desc;
      write({
        sort: isDefault ? '' : value.key,
        dir: isDefault ? '' : value.desc ? 'desc' : ascOnDescDefault ? 'asc' : '',
      });
    },
    activeCount: Object.values(filters).filter((value) => value !== '').length,
    /* Một lượt ghi cho mọi khoá (kể cả ô tìm) — gỡ từng khoá một là N lượt `setParams`, mỗi
       lượt một lần gọi API với bộ lọc dở dang. */
    clearFilters: () => {
      const patch: Record<string, string> = { q: '' };
      for (const key of Object.keys(emptyFilters)) {
        if (key !== searchKey) patch[key] = '';
      }
      setSearchInput('');
      write(patch);
    },
  };
}
