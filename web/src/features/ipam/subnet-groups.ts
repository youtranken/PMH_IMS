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

interface SiteFilterable {
  siteId: string | null;
  siteCode: string | null;
}

/**
 * Lọc dải theo site (Q-20). `''` = tất cả. Dải không gắn site là dải DÙNG CHUNG mọi site, nên
 * luôn ở lại khi lọc một site — bỏ nó đi thì người ở site đó không thấy dải họ vẫn đang dùng.
 */
export function filterSubnetsBySite<T extends SiteFilterable>(rows: T[], siteId: string): T[] {
  if (!siteId) return rows;
  return rows.filter((row) => row.siteId === null || row.siteId === siteId);
}

/** Site có ít nhất một dải — ô lọc không bày site mà chọn vào chỉ ra cột rỗng. */
export function siteOptionsOf(rows: SiteFilterable[]): { id: string; code: string }[] {
  const byId = new Map<string, string>();
  for (const row of rows) if (row.siteId && row.siteCode) byId.set(row.siteId, row.siteCode);
  return [...byId.entries()]
    .map(([id, code]) => ({ id, code }))
    .sort((a, b) => a.code.localeCompare(b.code));
}
