/**
 * AD-15 + convention "Phân trang": MỌI danh sách trả đúng shape này.
 * Module nghiệp vụ không tự chế `{data, meta}` hay `{rows, count}`.
 */
export interface Page<T> {
  items: T[];
  total: number;
}

export interface PageQuery {
  page: number;
  limit: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Chuẩn hóa `?page=&limit=` từ query string: luôn ra số hợp lệ, không NaN, không âm. */
export function parsePageQuery(raw: {
  page?: string | number;
  limit?: string | number;
}): PageQuery {
  const page = Math.max(1, Number.parseInt(String(raw.page ?? '1'), 10) || 1);
  // `limit=0` là ý định "không lấy gì" — kẹp về 1, KHÔNG rơi về mặc định 50 (bẫy `|| default`).
  const limitParsed = Number.parseInt(String(raw.limit ?? DEFAULT_LIMIT), 10);
  const limitRaw = Number.isNaN(limitParsed) ? DEFAULT_LIMIT : limitParsed;
  const limit = Math.min(MAX_LIMIT, Math.max(1, limitRaw));
  return { page, limit };
}

export function pageOffset(q: PageQuery): number {
  return (q.page - 1) * q.limit;
}

export function emptyPage<T>(): Page<T> {
  return { items: [], total: 0 };
}
