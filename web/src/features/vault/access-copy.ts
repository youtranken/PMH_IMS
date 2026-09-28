/** Phần của một dòng quyền két mà phép sao chép cần. */
export interface CopyableRule {
  scopeType: string;
  scopeRef: string;
  tier: string;
}

/**
 * Chia quyền của đồng nghiệp thành: nhóm SẼ GÁN cho người nhận (giữ nguyên tầng), và nhóm người
 * nhận ĐÃ CÓ.
 *
 * Nhóm đã có thì bỏ qua kể cả khi khác tầng: sao chép là để lấp chỗ trống cho người mới, không
 * phải để ghi đè một quyết định đã đặt riêng cho người này. Đổi tầng của một nhóm sẵn có là
 * việc của chip nhóm đó (API cũng từ chối ghi trùng).
 */
export function planCopy<T extends CopyableRule>(
  source: readonly T[],
  target: readonly CopyableRule[],
): { grant: T[]; alreadyHas: T[] } {
  const had = new Set(target.map((rule) => `${rule.scopeType}|${rule.scopeRef}`));
  const grant: T[] = [];
  const alreadyHas: T[] = [];
  for (const rule of source) {
    (had.has(`${rule.scopeType}|${rule.scopeRef}`) ? alreadyHas : grant).push(rule);
  }
  return { grant, alreadyHas };
}
