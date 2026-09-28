import { foldSearch } from '../../common/search-fold';
import { isoDateInTz } from '../../common/today';
import type { SortDir } from '../../common/sorting';
import { DISPOSAL_KINDS, type DisposalItem, type DisposalKind } from './disposal.types';

export const DISPOSAL_SORT_KEYS = ['disposedAt', 'code'] as const;
export type DisposalSortKey = (typeof DISPOSAL_SORT_KEYS)[number];

export interface DisposalQuery {
  kind?: DisposalKind;
  search?: string;
  /** YYYY-MM-DD, tính theo NGÀY LỊCH ở múi giờ ứng dụng — "quý này" là quý của người đọc. */
  from?: string;
  to?: string;
  sort: DisposalSortKey;
  dir: SortDir;
  page: number;
  limit: number;
}

export interface DisposalQueryResult {
  items: DisposalItem[];
  total: number;
  /** Số hồ sơ mỗi loại trong tập đã lọc ngày/từ khoá — nút lọc loại hiện con số này. */
  counts: Record<DisposalKind, number>;
}

/**
 * Lọc + sắp + cắt trang kho thanh lý, trên tập đã gộp từ bốn module.
 *
 * Chạy trong bộ nhớ chứ không bằng SQL: kho là bốn bảng của bốn chủ khác nhau (AD-3), và mỗi
 * nguồn đã bị chặn ở trần 500 dòng — gộp bằng một câu UNION là tự tay phá AD-2.
 *
 * `counts` bỏ qua ô Loại nhưng theo mọi bộ lọc còn lại: chọn "Quý này" thì nút "Thiết bị 3"
 * phải nói 3 máy của quý này; còn đếm theo chính ô Loại thì nút đang bật luôn bằng tổng và các
 * nút khác về 0 — con số hết còn là bộ đếm.
 *
 * Hồ sơ chưa rõ ngày vào kho (`disposedAt` null) rơi khỏi mọi khoảng ngày, và luôn nằm cuối
 * khi sắp theo ngày dù chiều nào — nó không phải "cũ nhất" hay "mới nhất".
 */
export function queryInventory(
  all: DisposalItem[],
  q: DisposalQuery,
  timeZone: string,
): DisposalQueryResult {
  const term = q.search ? foldSearch(q.search.trim()) : '';
  const inRange = (item: DisposalItem) => {
    if (!q.from && !q.to) return true;
    if (!item.disposedAt) return false;
    const day = isoDateInTz(timeZone, item.disposedAt);
    return (!q.from || day >= q.from) && (!q.to || day <= q.to);
  };
  const matches = (item: DisposalItem) =>
    !term || foldSearch(item.code).includes(term) || foldSearch(item.name).includes(term);

  const scoped = all.filter((item) => inRange(item) && matches(item));
  const counts = Object.fromEntries(DISPOSAL_KINDS.map((kind) => [kind, 0])) as Record<
    DisposalKind,
    number
  >;
  for (const item of scoped) counts[item.kind] += 1;

  const rows = q.kind ? scoped.filter((item) => item.kind === q.kind) : scoped;
  const sign = q.dir === 'desc' ? -1 : 1;
  const sorted = [...rows].sort((a, b) => {
    if (q.sort === 'code') return sign * a.code.localeCompare(b.code, 'vi');
    const at = a.disposedAt?.getTime();
    const bt = b.disposedAt?.getTime();
    if (at === undefined || bt === undefined) {
      if (at === bt) return a.code.localeCompare(b.code, 'vi');
      return at === undefined ? 1 : -1;
    }
    return sign * (at - bt) || a.code.localeCompare(b.code, 'vi');
  });
  const start = (q.page - 1) * q.limit;
  return { items: sorted.slice(start, start + q.limit), total: rows.length, counts };
}
