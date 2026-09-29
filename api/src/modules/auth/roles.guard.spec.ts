import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY } from './roles.decorator';
import type { AppRole } from './roles.decorator';
import { RolesGuard } from './roles.guard';
import type { AuthedUser } from './types';

/**
 * `RolesGuard` LÀ HIỆN THÂN CỦA AD-9.
 *
 * ===== VÌ SAO PHẢI CÓ FILE NÀY =====
 *
 * Guard này 51 dòng, ba nhánh, và là thứ duy nhất đứng giữa "quên gõ `@Roles(...)`" với "route
 * mở toang cho mọi người đã đăng nhập". Guard anh em `StepUpGuard` có HAI file kiểm
 * (`step-up.guard.spec.ts` 12 ca + `step-up-surface.spec.ts` quét mọi controller); guard này
 * không có gì.
 *
 * Điểm sống còn của nó là nhánh **mặc định ĐÓNG**: khác QLTS, route không khai `@Roles` thì bị
 * chặn chứ không "cho qua vì đã đăng nhập". Bất biến ấy chỉ là một câu `if` — đổi nó thành
 * `return true` là mở toang cả hệ thống, và **không một bài kiểm nghiệp vụ nào đỏ**, vì mọi
 * route thật đều đã khai `@Roles` rồi.
 */

function contextFor(user: AuthedUser | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardWith(required: AppRole[] | undefined, isPublic = false): RolesGuard {
  const reflector = {
    getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? isPublic : required),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

function userWithRole(role: AppRole): AuthedUser {
  return {
    id: 'u1',
    email: `${role}@pmh.com.vn`,
    fullName: 'Người dùng',
    role,
    sessionId: 's1',
    steppedUpAt: null,
    mustChangePassword: false,
  };
}

/** Bắt đúng `code` chứ không chỉ "có ném": hai nhánh từ chối mang hai mã KHÁC nhau. */
function expectForbidden(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({ code });
    return;
  }
  throw new Error(`Phải ném ForbiddenException mã ${code}, nhưng không ném gì cả.`);
}

describe('RolesGuard — AD-9 mặc định đóng', () => {
  /*
   * ===== NHÁNH QUAN TRỌNG NHẤT =====
   *
   * Không khai `@Roles` ⇒ CHẶN. Đây là khác biệt cố ý so với QLTS, và là thứ khiến "quên khai"
   * trở thành 403 ngay ở máy dev thay vì một lỗ hổng lặng lẽ trên production.
   */
  it('route KHÔNG khai @Roles thì bị chặn, kèm mã ROLES_NOT_DECLARED', () => {
    expectForbidden(
      () => guardWith(undefined).canActivate(contextFor(userWithRole('sa'))),
      'ROLES_NOT_DECLARED',
    );
  });

  it('khai @Roles() RỖNG cũng bị chặn — mảng rỗng không phải "cho mọi người"', () => {
    expectForbidden(
      () => guardWith([]).canActivate(contextFor(userWithRole('sa'))),
      'ROLES_NOT_DECLARED',
    );
  });

  it('mã từ chối vì SAI VAI khác mã từ chối vì QUÊN KHAI', () => {
    // Hai chuyện hoàn toàn khác nhau: một là lỗi lập trình, một là quyền của người dùng.
    // Gộp mã là người trực đọc log không phân biệt được "hệ thống viết sai" với "bạn không có quyền".
    expectForbidden(
      () => guardWith(['sa']).canActivate(contextFor(userWithRole('member'))),
      'FORBIDDEN_ROLE',
    );
  });

  it('đúng vai thì cho qua', () => {
    expect(guardWith(['sa', 'admin']).canActivate(contextFor(userWithRole('admin')))).toBe(true);
  });

  it('@Public() đi thẳng, KHÔNG cần khai @Roles', () => {
    // Màn đăng nhập chưa có người dùng nào để mà xét vai.
    expect(guardWith(undefined, true).canActivate(contextFor(undefined))).toBe(true);
  });

  /*
   * Chưa đăng nhập mà route có khai vai: `SessionGuard` đáng lẽ chặn trước, nhưng guard này
   * KHÔNG được dựa vào thứ tự ấy — một lượt đổi thứ tự guard trong `app.module` không được
   * biến nó thành cửa mở.
   */
  it('không có user thì vẫn chặn dù route khai vai', () => {
    expectForbidden(
      () => guardWith(['sa', 'admin', 'member']).canActivate(contextFor(undefined)),
      'FORBIDDEN_ROLE',
    );
  });

  it('vai lạ (dữ liệu hỏng, vai mới chưa khai) bị chặn, không lọt', () => {
    expectForbidden(
      () => guardWith(['sa']).canActivate(contextFor(userWithRole('auditor' as AppRole))),
      'FORBIDDEN_ROLE',
    );
  });

  /*
   * Khoá luôn KHÓA metadata: `ROLES_KEY` là thứ nối `@Roles()` với guard này. Đổi chuỗi ở một
   * đầu mà quên đầu kia thì `required` luôn `undefined` ⇒ MỌI route 403 — hỏng ồn ào, dễ thấy.
   * Nhưng nếu ai đó "sửa" bằng cách cho `undefined` đi qua thì thành hỏng IM LẶNG, và đó mới
   * là thứ file này canh.
   */
  it('ROLES_KEY có tiền tố riêng của dự án, không phải một tên chung dễ đụng', () => {
    // `'roles'` trần là tên mà một decorator của thư viện khác rất dễ dùng trùng; trùng khoá
    // metadata thì `getAllAndOverride` đọc nhầm giá trị của người khác và guard quyết sai.
    expect(ROLES_KEY).toBe('ims:roles');
    expect(ROLES_KEY.startsWith('ims:')).toBe(true);
  });
});
