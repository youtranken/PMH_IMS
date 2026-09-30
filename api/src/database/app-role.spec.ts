import { appRoleVerdict, type AppRoleFacts } from './app-role';

/**
 * D-01 — phép phán xét "role này có rộng quá không", tách hẳn khỏi DB nên test được bằng bảng.
 *
 * Hai vế, và bảng phải có cả hàng "chỉ sai vế thứ hai": bỏ sót vế đó thì một `ims_app` lỡ
 * được cấp quyền sở hữu `audit_log` sẽ đi qua cổng mà không ai biết — nó không phải superuser,
 * nhưng nó vẫn `ALTER TABLE ... DISABLE TRIGGER ALL` được.
 */
describe('appRoleVerdict — cổng khởi động D-01', () => {
  const base: AppRoleFacts = {
    currentUser: 'ims_app',
    isSuperuser: false,
    ownsAuditLog: false,
  };

  const cases: { name: string; facts: AppRoleFacts; ok: boolean; match?: RegExp }[] = [
    {
      name: 'role hẹp đúng mức → qua',
      facts: base,
      ok: true,
    },
    {
      name: 'superuser → chặn, và câu lỗi nói rõ vì sao REVOKE vô nghĩa',
      facts: { ...base, currentUser: 'ims', isSuperuser: true, ownsAuditLog: true },
      ok: false,
      match: /SUPERUSER/,
    },
    {
      name: 'KHÔNG superuser nhưng SỞ HỮU audit_log → vẫn chặn (vế dễ quên)',
      facts: { ...base, currentUser: 'ims', ownsAuditLog: true },
      ok: false,
      match: /CHỦ SỞ HỮU/,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const verdict = appRoleVerdict(c.facts);
      expect(verdict.ok).toBe(c.ok);
      if (c.match) {
        expect(verdict.reason).toMatch(c.match);
      } else {
        expect(verdict.reason).toBeNull();
      }
    });
  }

  it('câu lỗi luôn chỉ đúng chỗ phải sửa — tên role và tên migration', () => {
    // Một câu "cấu hình sai" trần trụi lúc 2 giờ sáng là một câu vô dụng. Người đọc nó đang
    // đứng trước một API không boot được và cần biết SỬA Ở ĐÂU.
    for (const facts of [
      { ...base, currentUser: 'postgres', isSuperuser: true },
      { ...base, currentUser: 'ims', ownsAuditLog: true },
    ]) {
      const reason = appRoleVerdict(facts).reason as string;
      expect(reason).toContain(facts.currentUser);
      expect(reason).toContain('DATABASE_URL');
      expect(reason).toContain('0001_app_role.sql');
    }
  });
});
