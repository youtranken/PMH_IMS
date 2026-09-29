import { describe, expect, it } from 'vitest';
import { ACTION_KEY, auditActionModule, MODULE_KEY } from './audit-actions';

/*
 * Ô "Hành động" của Nhật ký có vài chục mã: chia theo module để người rà tìm "mọi việc về két"
 * trong một cụm, không phải dò từng dòng.
 */
describe('auditActionModule — mã hành động thuộc module nào', () => {
  it.each([
    ['auth.login.failed', 'auth'],
    ['session.killed', 'auth'],
    ['security.probe.alerted', 'auth'],
    ['account.role.changed', 'account'],
    ['accounts.exported', 'account'],
    ['vault.secret.revealed', 'vault'],
    ['break_glass.approved', 'breakGlass'],
    ['catalog.site.created', 'catalog'],
    ['device.port-added', 'device'],
    ['devices.exported', 'device'],
    ['software.license-assigned', 'software'],
    ['isp.exported', 'isp'],
    ['service_account.disabled', 'serviceAccount'],
    ['subnet.voided', 'network'],
    ['nat.created', 'network'],
    ['ip.assigned', 'network'],
    ['expiry.rule.created', 'expiry'],
    ['disposal.exported', 'disposal'],
    ['file.downloaded', 'file'],
    ['system_config.updated', 'system'],
    ['crypto.rewrapped', 'system'],
    ['audit.exported', 'system'],
    ['khong.biet', 'other'],
  ])('%s → %s', (code, module) => {
    expect(auditActionModule(code)).toBe(module);
  });

  it('mọi mã có nhãn riêng đều rơi vào một module có tên, không mã nào lọt về "khác"', () => {
    const orphans = Object.keys(ACTION_KEY).filter((code) => auditActionModule(code) === 'other');
    expect(orphans).toEqual([]);
  });

  it('mỗi module có khóa nhãn', () => {
    for (const code of Object.keys(ACTION_KEY)) {
      expect(MODULE_KEY[auditActionModule(code)]).toMatch(/^audit\.module\./);
    }
  });
});
