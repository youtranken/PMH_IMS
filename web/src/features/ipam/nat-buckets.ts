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
