import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

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
  /** Có ít nhất một điều kiện đang bật (kể cả ô tìm). */
  dirty: boolean;
  clearAll: () => void;
}

export function useListUrlState<F extends Record<string, string>>(options: {
  /** Khóa bộ lọc và giá trị rỗng của chúng, vd `{ siteId: '', status: '' }`. */
  emptyFilters: F;
  defaultLimit: number;
  defaultSort: SortState;
  /**
   * Khóa trong `F` nhận giá trị ô tìm ĐÃ LẮNG (thường là `'search'`). Khai nó thì `filters` trả
   * về đã có sẵn từ khoá, nên `buildFilterQuery(filters)` của màn không phải đổi một chữ.
   */
  searchKey?: keyof F;
}): ListUrlState<F> {
  const { emptyFilters, defaultLimit, defaultSort, searchKey } = options;
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
  const limit = Number.parseInt(read('limit', String(defaultLimit)), 10) || defaultLimit;
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
  useEffect(() => setSearchInput(search), [search]);

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

  /* Gõ xong 250ms mới đẩy lên URL (và do đó mới gọi API). Trước đây mỗi phím là một request:
     gõ "SW-CORE-01" là mười lượt gọi, chín lượt vứt đi. */
  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => write({ q: searchInput.trim() }), 250);
    return () => clearTimeout(timer);
  }, [searchInput, search, write]);

  return {
    searchInput,
    setSearchInput,
    search,
    filters,
    setFilter: (key, value) => write({ [key as string]: value }),
    page,
    setPage: (value) => write({ page: value === 1 ? '' : value }, false),
    limit,
    setLimit: (value) => write({ limit: value === defaultLimit ? '' : value }),
    sorting,
    setSorting: (value) =>
      write({
        sort: value.key === defaultSort.key && value.desc === defaultSort.desc ? '' : value.key,
        dir: value.desc ? 'desc' : '',
      }),
    dirty:
      search !== '' || Object.values(filters).some((value) => value !== ''),
    clearAll: () => {
      const patch: Record<string, string> = { q: '' };
      for (const key of Object.keys(emptyFilters)) patch[key] = '';
      write(patch);
    },
  };
}
