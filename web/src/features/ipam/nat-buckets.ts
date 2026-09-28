/**
 * Ba rổ của sổ NAT: đang mở · đã tắt (còn trong sổ, tắt trên router) · đã gỡ.
 *
 * Rule đã gỡ vẫn phải tra được — hộp Gỡ hứa điều đó. Nhưng mặc định giấu nó đi: người mở sổ
 * thường hỏi "port nào đang mở", và một dòng gạch ngang xen giữa là nhiễu.
 */
export type NatBucket = 'open' | 'off' | 'voided';

export const NAT_BUCKETS: NatBucket[] = ['open', 'off', 'voided'];

export const NAT_BUCKET_KEY: Record<NatBucket, string> = {
  open: 'nat.bucketOpen',
  off: 'nat.disabled',
  voided: 'nat.bucketVoided',
};

export const NAT_DEFAULT_SHOWN: Record<NatBucket, boolean> = {
  open: true,
  off: true,
  voided: false,
};

export function natBucket(rule: { enabled: boolean; voidedAt: string | null }): NatBucket {
  if (rule.voidedAt) return 'voided';
  return rule.enabled ? 'open' : 'off';
}

export function countNat(rules: { enabled: boolean; voidedAt: string | null }[]) {
  const counts: Record<NatBucket, number> = { open: 0, off: 0, voided: 0 };
  for (const rule of rules) counts[natBucket(rule)] += 1;
  return counts;
}

export function filterNat<T extends { enabled: boolean; voidedAt: string | null }>(
  rules: T[],
  shown: Record<NatBucket, boolean>,
): T[] {
  return rules.filter((rule) => shown[natBucket(rule)]);
}

export type NatSortKey = 'external' | 'router' | 'internal' | 'newest';
export const NAT_SORT_KEYS: NatSortKey[] = ['external', 'router', 'internal', 'newest'];

/**
 * Sắp sổ NAT ở client — cả sổ đã về trong một lượt (vài trăm rule), đổi thứ tự không cần hỏi
 * lại API. Port và IP so theo SỐ ("443" trước "5060", ".3" trước ".20"), không theo chữ; hoà
 * thì giữ thứ tự port ngoài để hai lần xem ra cùng một thứ tự. Trả mảng MỚI: mảng vào là dữ
 * liệu cache của react-query, sắp tại chỗ là sửa cache của mọi nơi khác.
 */
export function sortNat<
  T extends { deviceCode: string | null; externalPorts: string; internalIp: string; createdAt: string },
>(rules: T[], key: NatSortKey): T[] {
  const port = (rule: T) => Number(rule.externalPorts.split('-')[0]) || 0;
  const ip = (rule: T) =>
    rule.internalIp.split('.').reduce((sum, part) => sum * 256 + (Number(part) || 0), 0);
  const byPort = (a: T, b: T) => port(a) - port(b);
  const compare: Record<NatSortKey, (a: T, b: T) => number> = {
    external: byPort,
    router: (a, b) => (a.deviceCode ?? '').localeCompare(b.deviceCode ?? '') || byPort(a, b),
    internal: (a, b) => ip(a) - ip(b) || byPort(a, b),
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt) || byPort(a, b),
  };
  return [...rules].sort(compare[key]);
}
