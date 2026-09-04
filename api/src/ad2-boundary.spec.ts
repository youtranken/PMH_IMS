/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Canh gác cho hàng rào AD-2.
 *
 * Vì sao bài này tồn tại: luật `no-restricted-imports` bản trước dùng glob
 * `'**\/modules\/*\/[!(index|*.api)]*'` và khớp đúng SỐ KHÔNG chuỗi import trong repo —
 * không import nào chứa đoạn `modules/`, và `[!(...)]` là lớp ký tự phủ định chứ không phải
 * extglob. Luật xanh, CI xanh, ranh giới module không được canh bởi bất cứ thứ gì suốt 9 epic.
 *
 * Một luật lint chết trông y hệt một luật lint không có gì để bắt. Bài này phân biệt hai thứ đó.
 */

const { ad2PatternSource, AUTH_USERS_EXCEPTION } = require('../ad2-boundary.js') as {
  ad2PatternSource: (extraExceptions?: string) => string;
  AUTH_USERS_EXCEPTION: string;
  AD2_MESSAGE: string;
};

const ad2 = new RegExp(ad2PatternSource());
const ad2FromAuth = new RegExp(ad2PatternSource(AUTH_USERS_EXCEPTION));

describe('AD-2 — luật chặn import xuyên ruột module', () => {
  describe('PHẢI bắt (import chạm file nội bộ của module khác)', () => {
    it.each([
      // Đúng bốn vi phạm đang sống lúc rà soát 28/08 — bài này giữ cho chúng không quay lại.
      ['../approvals/approvals.service', 'dashboard lấy ApprovalRecord qua cửa sau'],
      ['../users/users.service', 'accounts.controller lấy whitelist sắp xếp'],
      ['../users/users.schema', 'auth chạm thẳng bảng của users'],
      // Các dạng khác cùng lớp.
      ['../vault/vault.service', 'service nội bộ'],
      ['../ipam/subnet.service', 'service nội bộ'],
      ['../devices/devices.schema', 'schema nội bộ'],
      ['../software/license-assignment.service', 'service nội bộ'],
      ['../catalog/catalog-import.service', 'service nội bộ'],
      ['../auth/auth.service', 'service nội bộ của module nền'],
      ['../auth/password.service', 'lõi bảo mật nội bộ'],
    ])('bắt %s (%s)', (specifier) => {
      expect(ad2.test(specifier)).toBe(true);
    });
  });

  describe('PHẢI cho qua (cửa chính + nguyên thủy hạ tầng khai tường minh)', () => {
    it.each([
      // Cửa chính.
      ['../devices/devices.api', '*.api.ts là public api (AD-2)'],
      ['../approvals/approvals.api', '*.api.ts'],
      ['../users/users.api', '*.api.ts'],
      ['../audit/audit.module', '*.module.ts là cửa DI của Nest'],
      ['../devices/devices.module', '*.module.ts'],
      ['../users/users.types', '*.types.ts là hợp đồng kiểu'],
      // Nguyên thủy hạ tầng.
      ['../auth/roles.decorator', 'decorator @Roles dùng ở mọi controller'],
      ['../auth/types', 'AuthedRequest / UserRole'],
      ['../auth/step-up.guard', 'guard step-up cho két sắt'],
      ['../auth/session-policy', 'hàm thuần tính hạn phiên'],
      ['../audit/audited.decorator', 'decorator @Audited (AD-9)'],
      ['../audit/audit-writer.service', 'ghi audit trong tx (AD-5)'],
      ['../config-sys/system-config.service', 'sổ tham số nghiệp vụ (AD-11)'],
      ['../outbox/outbox.service', 'outbox trong cùng tx (AD-5)'],
      ['../queue/sweep.service', 'đăng ký sweep định kỳ'],
      // Trong cùng module, và ra ngoài src/modules.
      ['./devices.service', 'cùng module — luôn hợp lệ'],
      ['./subnet.service', 'cùng module'],
      ['../../common/tx', 'tầng nền, không phải module ↔ module'],
      ['../../common/pagination', 'tầng nền'],
      ['../../database/database.module', 'tầng nền'],
      ['@nestjs/common', 'thư viện ngoài'],
      ['drizzle-orm', 'thư viện ngoài'],
    ])('cho qua %s (%s)', (specifier) => {
      expect(ad2.test(specifier)).toBe(false);
    });
  });

  describe('ngoại lệ auth ↔ users (AD-3: một chủ sở hữu bảng `users`)', () => {
    it.each([
      ['../users/users.service', 'auth cần UsersService để xác thực'],
      ['../users/users.schema', 'sessions.schema khai FK sang usersTable'],
    ])('trong module auth thì %s được phép (%s)', (specifier) => {
      expect(ad2FromAuth.test(specifier)).toBe(false);
      // …nhưng ở mọi module khác thì vẫn bị chặn.
      expect(ad2.test(specifier)).toBe(true);
    });

    it('ngoại lệ chỉ mở đúng hướng users, không mở toang cho auth', () => {
      expect(ad2FromAuth.test('../vault/vault.service')).toBe(true);
      expect(ad2FromAuth.test('../ipam/subnet.service')).toBe(true);
    });
  });

  it('luật phải bắt được ÍT NHẤT một chuỗi — bản glob cũ khớp số không', () => {
    const probes = [
      '../approvals/approvals.service',
      '../users/users.schema',
      '../vault/vault.service',
    ];
    expect(probes.filter((p) => ad2.test(p)).length).toBeGreaterThan(0);
  });
});
