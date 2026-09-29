interface GroupableSubnet {
  siteCode: string | null;
  voidedAt: string | null;
}

/**
 * `site:<mã>` · `nosite` · `voided` — hoặc `all` khi chỉ có một nhóm (không vẽ tiêu đề: một
 * tiêu đề "HCM" đứng trên cả cột chỉ tốn một dòng mà không phân biệt được gì).
 */
export type SubnetGroupKey = `site:${string}` | 'nosite' | 'voided' | 'all';

/**
 * Chia dải theo site cho cột trái màn Địa chỉ IP. Site theo A→Z, dải chưa gán site sau các
 * site, dải đã ngừng dùng luôn ở đáy (giữ nếp cũ: cái đã bỏ không xen giữa cái đang dùng).
 * Trong nhóm giữ nguyên thứ tự đầu vào (API đã sắp theo CIDR).
 */
export function groupSubnets<T extends GroupableSubnet>(
  rows: T[],
): { key: SubnetGroupKey; rows: T[] }[] {
  const keyOf = (row: T): SubnetGroupKey =>
    row.voidedAt ? 'voided' : row.siteCode ? `site:${row.siteCode}` : 'nosite';
  const buckets = new Map<SubnetGroupKey, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    buckets.set(key, [...(buckets.get(key) ?? []), row]);
  }
  if (buckets.size <= 1) return [{ key: 'all', rows }];
  const rank = (key: SubnetGroupKey) => (key === 'voided' ? 2 : key === 'nosite' ? 1 : 0);
  return [...buckets.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, list]) => ({ key, rows: list }));
}
