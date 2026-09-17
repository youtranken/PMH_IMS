import { useCallback, useEffect, useMemo, useState } from 'react';
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
}): ListUrlState<F> {
  const { emptyFilters, defaultLimit, defaultSort } = options;
  const [params, setParams] = useSearchParams();

  const read = useCallback(
    (key: string, fallback = '') => params.get(key) ?? fallback,
    [params],
  );

  const filters = useMemo(() => {
    const out = { ...emptyFilters };
    for (const key of Object.keys(emptyFilters)) {
      (out as Record<string, string>)[key] = params.get(key) ?? '';
    }
    return out;
    // `params` đổi là đọc lại; `emptyFilters` là hằng của màn nên không cần theo dõi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const search = read('q');
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

  const write = useCallback(
    (patch: Record<string, string | number | boolean | null>, resetPage = true) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            const text = value === null || value === false ? '' : String(value);
            if (text === '') next.delete(key);
            else next.set(key, text);
          }
          if (resetPage) next.delete('page');
          return next;
        },
        // `replace` để mỗi lần đổi bộ lọc KHÔNG thêm một mục lịch sử: người dùng bấm Back là
        // muốn rời khỏi màn, không phải đi lùi qua mười hai lần chỉnh bộ lọc.
        { replace: true },
      );
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
