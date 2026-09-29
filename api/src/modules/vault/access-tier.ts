/**
 * Ba tầng quyền xem secret (FR-023) — hàm THUẦN, không chạm DB.
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

/**
 * Nhóm đối tượng có thể gán quyền.
 *
 * Gán theo NHÓM chứ không theo từng bản ghi: thêm một cái switch mới vào site là nó tự nằm
 * trong quyền đã gán, không phải gán lại. Đó là lý do ma trận này dùng được với vài trăm thiết
 * bị mà không biến thành một bảng vài trăm dòng.
 *
 * Mọi loại chủ thể cất được mật khẩu vào két đều phải có nhóm phủ (như `service_account_kind`
 * và `isp_provider`). Thiếu nhóm thì Member vĩnh viễn bị từ chối và SA không có ô nào để cấp
 * quyền — một tính năng chết chứ không phải một quyết định.
 */
export const SCOPE_TYPES = [
  'device_site',
  'device_type',
  'software_kind',
  'service_account_kind',
  'isp_provider',
] as const;
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

/**
 * Tài khoản dịch vụ nhóm theo LOẠI (`shared` / `vpn`) — cùng khuôn với phần mềm.
 *
 * Vì sao theo loại chứ không theo bộ phận: "cho cả tổ trực xem mọi tài khoản VPN" là câu có
 * thật, còn "cho họ xem mọi tài khoản của phòng Kế toán" thì gần như không ai gán — bộ phận là
 * ô gõ tự do, viết lệch một chữ là quyền không áp.
 */
export function groupsOfServiceAccount(account: { kind: string }): AccessGroup[] {
  return account.kind ? [{ scopeType: 'service_account_kind', scopeRef: account.kind }] : [];
}

/**
 * Đường truyền nhóm theo NHÀ MẠNG — bằng ID danh mục, không bằng tên (SEC-13): khoá theo tên
 * thì đổi tên nhà mạng trong danh mục là lặng lẽ tước quyền của mọi người đã được gán.
 */
export function groupsOfIsp(line: { providerId: string }): AccessGroup[] {
  return line.providerId ? [{ scopeType: 'isp_provider', scopeRef: line.providerId }] : [];
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
  return explainTier(rules, memberEmail, groups).tier;
}

/**
 * Như `resolveTier`, kèm các dòng quyền đã khớp — dòng RỘNG nhất (dòng quyết định tầng) đứng
 * đầu. Màn Kiểm tra quyền dùng để trả lời "vì sao", không chỉ "được hay không": SA thấy đúng
 * dòng nào phải gỡ nếu muốn siết.
 */
export function explainTier<R extends AccessRule>(
  rules: R[],
  memberEmail: string,
  groups: AccessGroup[],
): { tier: AccessTier; matched: R[] } {
  const me = memberEmail.toLowerCase();
  const matched = rules
    .filter(
      (rule) =>
        // Email so không phân biệt hoa-thường — `IT01@` và `it01@` là một người.
        rule.memberEmail.toLowerCase() === me &&
        groups.some(
          (group) => group.scopeType === rule.scopeType && group.scopeRef === rule.scopeRef,
        ),
    )
    .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
  return { tier: matched[0]?.tier ?? 'denied', matched };
}

export function tierLabel(tier: string): string {
  return TIER_LABEL[tier] ?? tier;
}

const TIER_LABEL: Record<string, string> = {
  whitelist: 'Xem thẳng',
  needs_approval: 'Cần duyệt',
  denied: 'Không có quyền',
};
