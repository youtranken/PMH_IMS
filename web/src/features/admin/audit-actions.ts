import type { TFunction } from 'i18next';

/**
 * Mã hành động của `audit_log` → nhãn tiếng Việt cho màn Nhật ký.
 *
 * Mã (`vault.secret.revealed`) là thứ API ghi và thứ bộ lọc gửi lên — giữ nguyên, hiện ở dòng
 * phụ. Người đọc nhật ký cần câu "ai đã làm GÌ", không phải mã nội bộ.
 *
 * Hai tầng:
 *   1. `ACTION_KEY` — nhãn riêng cho từng mã viết thẳng trong API.
 *   2. Họ + động từ — cho mã API ghép lúc chạy (`device.${action}`, `catalog.${entity}.${action}`,
 *      `${kind}.${to}` của phiếu duyệt): "Thiết bị · Gỡ liên kết cổng".
 * Không khớp tầng nào thì trả lại chính mã: thà thấy mã còn hơn một dòng trống.
 *
 * `features/audit-action-rollcall.test.ts` đọc mã nguồn API và đỏ khi có mã mới chưa có nhãn.
 */
export const ACTION_KEY: Record<string, string> = {
  'account.created': 'audit.actions.accountCreated',
  'account.seeded': 'audit.actions.accountSeeded',
  'account.profile.updated': 'audit.actions.accountProfileUpdated',
  'account.status.changed': 'audit.actions.accountStatusChanged',
  'account.locked': 'audit.actions.accountLocked',
  'account.unlocked': 'audit.actions.accountUnlocked',
  'account.disabled': 'audit.actions.accountDisabled',
  'account.password.reset': 'audit.actions.accountPasswordReset',
  'account.mfa.reset': 'audit.actions.accountMfaReset',
  'account.totp_login_required.changed': 'audit.actions.accountTotpRequiredChanged',
  'account.role.changed': 'audit.actions.accountRoleChanged',
  'accounts.exported': 'audit.actions.accountsExported',
  'audit.exported': 'audit.actions.auditExported',
  'auth.login.ok': 'audit.actions.authLoginOk',
  'auth.login.failed': 'audit.actions.authLoginFailed',
  'auth.logout': 'audit.actions.authLogout',
  'auth.account.locked': 'audit.actions.authAccountLocked',
  'auth.device.new': 'audit.actions.authDeviceNew',
  'auth.password.ok': 'audit.actions.authPasswordOk',
  'auth.password.changed': 'audit.actions.authPasswordChanged',
  'auth.password.change_failed': 'audit.actions.authPasswordChangeFailed',
  'auth.password.session_revoked': 'audit.actions.authPasswordSessionRevoked',
  'auth.session.revoked_self': 'audit.actions.authSessionRevokedSelf',
  'auth.session.revoked_others': 'audit.actions.authSessionRevokedOthers',
  'auth.stepup.ok': 'audit.actions.authStepupOk',
  'auth.stepup.failed': 'audit.actions.authStepupFailed',
  'auth.stepup.session_revoked': 'audit.actions.authStepupSessionRevoked',
  'auth.totp.failed': 'audit.actions.authTotpFailed',
  'auth.totp.session_revoked': 'audit.actions.authTotpSessionRevoked',
  'auth.totp.enroll.start': 'audit.actions.authTotpEnrollStart',
  'auth.totp.enroll.done': 'audit.actions.authTotpEnrollDone',
  'auth.totp.enroll.failed': 'audit.actions.authTotpEnrollFailed',
  'auth.totp.enroll.reauth_failed': 'audit.actions.authTotpEnrollReauthFailed',
  'auth.totp.enroll.session_revoked': 'audit.actions.authTotpEnrollSessionRevoked',
  'auth.totp.reenroll.start': 'audit.actions.authTotpReenrollStart',
  'auth.totp.reenroll.done': 'audit.actions.authTotpReenrollDone',
  'auth.totp.reenroll.failed': 'audit.actions.authTotpReenrollFailed',
  'auth.totp.reenroll.reauth_failed': 'audit.actions.authTotpReenrollReauthFailed',
  'auth.totp.reenroll.session_revoked': 'audit.actions.authTotpReenrollSessionRevoked',
  'session.killed': 'audit.actions.sessionKilled',
  'session.killed_all': 'audit.actions.sessionKilledAll',
  'security.probe.alerted': 'audit.actions.securityProbeAlerted',
  'vault.secret.created': 'audit.actions.vaultSecretCreated',
  'vault.secret.updated': 'audit.actions.vaultSecretUpdated',
  'vault.secret.rotated': 'audit.actions.vaultSecretRotated',
  'vault.secret.revoked': 'audit.actions.vaultSecretRevoked',
  'vault.secret.revealed': 'audit.actions.vaultSecretRevealed',
  'vault.secret.reveal_denied': 'audit.actions.vaultSecretRevealDenied',
  'vault.access.granted': 'audit.actions.vaultAccessGranted',
  'vault.access.revoked': 'audit.actions.vaultAccessRevoked',
  'break_glass.requested': 'audit.actions.breakGlassRequested',
  'break_glass.approved': 'audit.actions.breakGlassApproved',
  'break_glass.denied': 'audit.actions.breakGlassDenied',
  'break_glass.cancelled': 'audit.actions.breakGlassCancelled',
  'break_glass.revoked': 'audit.actions.breakGlassRevoked',
  'break_glass.expired': 'audit.actions.breakGlassExpired',
  'break_glass.claimed': 'audit.actions.breakGlassClaimed',
  'break_glass.exported': 'audit.actions.breakGlassExported',
  'catalog.created': 'audit.actions.catalogCreated',
  'catalog.updated': 'audit.actions.catalogUpdated',
  'catalog.deleted': 'audit.actions.catalogDeleted',
  'catalog.active.changed': 'audit.actions.catalogActiveChanged',
  'catalog.imported': 'audit.actions.catalogImported',
  'catalog.exported': 'audit.actions.catalogExported',
  'devices.exported': 'audit.actions.devicesExported',
  'software.exported': 'audit.actions.softwareExported',
  'software.assignments.exported': 'audit.actions.softwareAssignmentsExported',
  'isp.exported': 'audit.actions.ispExported',
  'ip.exported': 'audit.actions.ipExported',
  'nat.exported': 'audit.actions.natExported',
  'expiry.exported': 'audit.actions.expiryExported',
  'disposal.exported': 'audit.actions.disposalExported',
  'expiry.renewed': 'audit.actions.expiryRenewed',
  'expiry.digest.sent': 'audit.actions.expiryDigestSent',
  'expiry.digest.test': 'audit.actions.expiryDigestTest',
  'expiry.rule.created': 'audit.actions.expiryRuleCreated',
  'expiry.rule.updated': 'audit.actions.expiryRuleUpdated',
  'expiry.rule.deleted': 'audit.actions.expiryRuleDeleted',
  'file.uploaded': 'audit.actions.fileUploaded',
  'file.downloaded': 'audit.actions.fileDownloaded',
  'file.deleted': 'audit.actions.fileDeleted',
  'file.purged': 'audit.actions.filePurged',
  'ip.created': 'audit.actions.ipCreated',
  'ip.updated': 'audit.actions.ipUpdated',
  'ip.assigned': 'audit.actions.ipAssigned',
  'ip.transitioned': 'audit.actions.ipTransitioned',
  'ip.voided': 'audit.actions.ipVoided',
  'ip.subnet_voided': 'audit.actions.ipSubnetVoided',
  'ip.restored': 'audit.actions.ipRestored',
  'subnet.created': 'audit.actions.subnetCreated',
  'subnet.updated': 'audit.actions.subnetUpdated',
  'subnet.voided': 'audit.actions.subnetVoided',
  'subnet.restored': 'audit.actions.subnetRestored',
  'subnet.deleted': 'audit.actions.subnetDeleted',
  'nat.created': 'audit.actions.natCreated',
  'nat.updated': 'audit.actions.natUpdated',
  'nat.voided': 'audit.actions.natVoided',
  'system_config.updated': 'audit.actions.systemConfigUpdated',
  'crypto.rewrapped': 'audit.actions.cryptoRewrapped',
};

/** Họ của mã ghép lúc chạy — phần trước động từ cuối. */
export const FAMILY_KEY: Record<string, string> = {
  account: 'audit.family.account',
  device: 'audit.family.device',
  software: 'audit.family.software',
  isp: 'audit.family.isp',
  service_account: 'audit.family.serviceAccount',
  break_glass: 'audit.family.breakGlass',
  'catalog.site': 'audit.family.catalogSite',
  'catalog.cabinet': 'audit.family.catalogCabinet',
  'catalog.device_type': 'audit.family.catalogDeviceType',
  'catalog.vendor': 'audit.family.catalogVendor',
  'catalog.department': 'audit.family.catalogDepartment',
  'catalog.isp_provider': 'audit.family.catalogIspProvider',
  'catalog.service_port': 'audit.family.catalogServicePort',
};

/** Động từ cuối của mã ghép — cùng bộ mã với sổ lịch sử từng module và trạng thái phiếu duyệt. */
export const VERB_KEY: Record<string, string> = {
  created: 'audit.verb.created',
  updated: 'audit.verb.updated',
  deleted: 'audit.verb.deleted',
  imported: 'audit.verb.imported',
  'imported-update': 'audit.verb.importedUpdate',
  activated: 'audit.verb.activated',
  deactivated: 'audit.verb.deactivated',
  enabled: 'audit.verb.enabled',
  disabled: 'audit.verb.disabled',
  'status-changed': 'audit.verb.statusChanged',
  'port-added': 'audit.verb.portAdded',
  'port-updated': 'audit.verb.portUpdated',
  'port-removed': 'audit.verb.portRemoved',
  'port-unlinked': 'audit.verb.portUnlinked',
  'device-detached': 'audit.verb.deviceDetached',
  renewed: 'audit.verb.renewed',
  expired: 'audit.verb.expired',
  reactivated: 'audit.verb.reactivated',
  'auto-retired': 'audit.verb.autoRetired',
  'license-assigned': 'audit.verb.licenseAssigned',
  'license-released': 'audit.verb.licenseReleased',
  'license-terms-updated': 'audit.verb.licenseTermsUpdated',
  requested: 'audit.verb.requested',
  approved: 'audit.verb.approved',
  denied: 'audit.verb.denied',
  cancelled: 'audit.verb.cancelled',
  revoked: 'audit.verb.revoked',
  exported: 'audit.verb.exported',
  locked: 'audit.verb.locked',
  unlocked: 'audit.verb.unlocked',
};

/**
 * Mẫu mã ghép mà API đang dùng (`${…}` thay bằng `*`). Bài điểm danh so với mã nguồn API: thêm
 * một mẫu mới ở API mà không khai ở đây là đỏ — vì mẫu mới thường đi kèm một HỌ mới chưa có nhãn.
 */
export const TEMPLATE_PATTERNS = [
  '*.requested',
  '*.claimed',
  '*.*',
  'catalog.*.*',
  'device.*',
  'isp.*',
  'service_account.*',
  'software.*',
] as const;

/** Nhãn tiếng Việt của một mã; không biết thì trả lại chính mã. */
export function auditActionLabel(code: string, t: TFunction): string {
  const exact = ACTION_KEY[code];
  if (exact) return t(exact);
  const dot = code.lastIndexOf('.');
  if (dot > 0) {
    const family = FAMILY_KEY[code.slice(0, dot)];
    const verb = VERB_KEY[code.slice(dot + 1)];
    if (family && verb) return `${t(family)} · ${t(verb)}`;
  }
  return code;
}

/*
 * Màu theo NHÓM: an ninh thất bại (đoán mật khẩu, mã 2 lớp sai, bị chặn mở két, cảnh báo dò)
 * là thứ người rà nhật ký phải thấy trước tiên; xem giá trị két là việc hợp lệ nhưng nhạy cảm.
 * Còn lại (tạo/sửa) giữ màu chữ thường — tô màu mọi thứ là không tô gì.
 *
 * Tập đỏ là bản đọc của `SECURITY_AUDIT_ACTIONS` bên API (nguồn của chip "Chỉ sự kiện an ninh");
 * `audit-action-rollcall.test.ts` đỏ khi hai bên lệch — thêm mã thì thêm ở API trước.
 */
export const DANGER_ACTIONS = new Set([
  'auth.login.failed',
  'auth.account.locked',
  'auth.stepup.failed',
  'auth.stepup.session_revoked',
  'auth.totp.failed',
  'auth.totp.session_revoked',
  'auth.totp.enroll.failed',
  'auth.totp.reenroll.failed',
  'auth.password.change_failed',
  'auth.password.session_revoked',
  'auth.totp.enroll.reauth_failed',
  'auth.totp.enroll.session_revoked',
  'auth.totp.reenroll.reauth_failed',
  'auth.totp.reenroll.session_revoked',
  'vault.secret.reveal_denied',
  'security.probe.alerted',
]);
const WARN = new Set(['vault.secret.revealed', 'break_glass.approved', 'break_glass.exported']);

export function auditActionTone(code: string): 'danger' | 'warn' | null {
  if (DANGER_ACTIONS.has(code)) return 'danger';
  if (WARN.has(code)) return 'warn';
  return null;
}

/**
 * Module của một mã hành động — nhóm của ô chọn "Hành động" ở Nhật ký. Tính theo đoạn đầu của
 * mã (`vault.secret.revealed` → két), nên mã mới của một module cũ tự vào đúng nhóm.
 */
export type AuditModule =
  | 'auth'
  | 'account'
  | 'vault'
  | 'breakGlass'
  | 'catalog'
  | 'device'
  | 'software'
  | 'isp'
  | 'serviceAccount'
  | 'network'
  | 'expiry'
  | 'disposal'
  | 'file'
  | 'system'
  | 'other';

const MODULE_OF_PREFIX: Record<string, AuditModule> = {
  auth: 'auth',
  session: 'auth',
  security: 'auth',
  account: 'account',
  accounts: 'account',
  vault: 'vault',
  break_glass: 'breakGlass',
  catalog: 'catalog',
  device: 'device',
  devices: 'device',
  software: 'software',
  isp: 'isp',
  service_account: 'serviceAccount',
  ip: 'network',
  subnet: 'network',
  nat: 'network',
  expiry: 'expiry',
  disposal: 'disposal',
  file: 'file',
  system_config: 'system',
  crypto: 'system',
  audit: 'system',
};

export const MODULE_KEY: Record<AuditModule, string> = {
  auth: 'audit.module.auth',
  account: 'audit.module.account',
  vault: 'audit.module.vault',
  breakGlass: 'audit.module.breakGlass',
  catalog: 'audit.module.catalog',
  device: 'audit.module.device',
  software: 'audit.module.software',
  isp: 'audit.module.isp',
  serviceAccount: 'audit.module.serviceAccount',
  network: 'audit.module.network',
  expiry: 'audit.module.expiry',
  disposal: 'audit.module.disposal',
  file: 'audit.module.file',
  system: 'audit.module.system',
  other: 'audit.module.other',
};

export function auditActionModule(code: string): AuditModule {
  return MODULE_OF_PREFIX[code.split('.')[0]] ?? 'other';
}

/** Loại đối tượng (`object_type`) → nhãn tiếng Việt. */
export const OBJECT_TYPE_KEY: Record<string, string> = {
  user: 'audit.objectType.user',
  session: 'audit.objectType.session',
  device: 'audit.objectType.device',
  software: 'audit.objectType.software',
  isp_line: 'audit.objectType.ispLine',
  service_account: 'audit.objectType.serviceAccount',
  secret: 'audit.objectType.secret',
  access_list: 'audit.objectType.accessList',
  approval: 'audit.objectType.approval',
  subnet: 'audit.objectType.subnet',
  ip_address: 'audit.objectType.ipAddress',
  nat_rule: 'audit.objectType.natRule',
  catalog: 'audit.objectType.catalog',
  expiry_rule: 'audit.objectType.expiryRule',
  expiry: 'audit.objectType.expiry',
  disposal: 'audit.objectType.disposal',
  file: 'audit.objectType.file',
  system_config: 'audit.objectType.systemConfig',
};

export function objectTypeLabel(type: string | null, t: TFunction): string | null {
  if (!type) return null;
  return OBJECT_TYPE_KEY[type] ? t(OBJECT_TYPE_KEY[type]) : type;
}
