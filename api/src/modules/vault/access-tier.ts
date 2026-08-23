/**
 * Ba tầng quyền xem secret (story 6.2, FR-023) — hàm THUẦN, không chạm DB.
 *
 * AC nói rõ: "đối tượng không thuộc tầng nào với member đó = tầng CẤM mặc định (không xin
 * được)". Đây là AD-9 (quyền mặc định ĐÓNG) áp vào dữ liệu thay vì vào route.
 *
 * Mặc định phải là CẤM chứ không phải "cần duyệt": nếu mặc định là cần duyệt thì một member
 * mới toanh, chưa ai gán gì cho, đã có thể gửi yêu cầu xin mật khẩu MỌI thiết bị trong công
 * ty — và người duyệt lãnh một đống yêu cầu lẽ ra không nên tồn tại.
 */

export const ACCESS_TIERS = ['whitelist', 'needs_approval', 'denied'] as const;
export type AccessTier = (typeof ACCESS_TIERS)[number];

/** Nhóm đối tượng: thiết bị theo site / theo loại, hoặc phần mềm theo loại hồ sơ. */
export const SCOPE_TYPES = ['device_site', 'device_type', 'software_kind'] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];

export interface AccessGroup {
  scopeType: ScopeType;
  scopeRef: string;
}

export interface AccessRule {
  memberEmail: string;
  scopeType: ScopeType;
  scopeRef: string;
  tier: AccessTier;
}

/**
 * Một thiết bị thuộc những nhóm nào.
 *
 * Thiếu site (thiết bị mới nhập, chưa xếp chỗ) thì KHÔNG đẻ ra một nhóm với `scopeRef` rỗng —
 * nhóm rỗng sẽ khớp với mọi luật cũng có `scopeRef` rỗng, và đó là cách một thiết bị chưa xếp
 * chỗ bỗng nhiên nằm trong quyền của ai đó.
 */
export function groupsOfDevice(device: {
  siteId: string | null;
  deviceTypeId: string | null;
}): AccessGroup[] {
  const groups: AccessGroup[] = [];
  if (device.siteId) groups.push({ scopeType: 'device_site', scopeRef: device.siteId });
  if (device.deviceTypeId) groups.push({ scopeType: 'device_type', scopeRef: device.deviceTypeId });
  return groups;
}

export function groupsOfSoftware(software: { kind: string }): AccessGroup[] {
  return software.kind ? [{ scopeType: 'software_kind', scopeRef: software.kind }] : [];
}

/** Rộng → hẹp. Dùng để chọn khi nhiều luật cùng áp. */
const TIER_RANK: Record<AccessTier, number> = {
  whitelist: 2,
  needs_approval: 1,
  denied: 0,
};

/**
 * Tầng quyền của `memberEmail` trên một đối tượng thuộc các `groups` đã cho.
 *
 * Nhiều luật cùng áp thì lấy cái RỘNG NHẤT. Vì sao không lấy cái chặt nhất: SA gán "mọi switch
 * = xem thẳng" rồi lại gán "site HN = cần duyệt". Lấy cái chặt hơn thì người trực đứng trước
 * con switch ở HN vẫn phải đi xin — trong khi SA đã nói rõ họ được xem mọi switch. Người ta
 * thêm luật để MỞ; muốn siết thì gỡ luật cũ đi, và màn ma trận cho thấy rõ đang có luật nào.
 */
export function resolveTier(
  rules: AccessRule[],
  memberEmail: string,
  groups: AccessGroup[],
): AccessTier {
  const me = memberEmail.toLowerCase();
  let best: AccessTier = 'denied';

  for (const rule of rules) {
    // Email so không phân biệt hoa-thường — `IT01@` và `it01@` là một người.
    if (rule.memberEmail.toLowerCase() !== me) continue;
    const matches = groups.some(
      (group) => group.scopeType === rule.scopeType && group.scopeRef === rule.scopeRef,
    );
    if (!matches) continue;
    if (TIER_RANK[rule.tier] > TIER_RANK[best]) best = rule.tier;
  }
  return best;
}

export function tierLabel(tier: string): string {
  return TIER_LABEL[tier] ?? tier;
}

const TIER_LABEL: Record<string, string> = {
  whitelist: 'Xem thẳng',
  needs_approval: 'Cần duyệt',
  denied: 'Không có quyền',
};

export const SCOPE_LABEL: Record<string, string> = {
  device_site: 'Thiết bị tại site',
  device_type: 'Thiết bị theo loại',
  software_kind: 'Phần mềm theo loại',
};
