import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { SystemConfigService } from '../config-sys/system-config.service';
import { StepUpGuard } from './step-up.guard';
import type { AuthedUser } from './types';

function contextFor(user: AuthedUser | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardWith(required: boolean, graceMinutes = 10): StepUpGuard {
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  const config = {
    getNumber: () => Promise.resolve(graceMinutes),
  } as unknown as SystemConfigService;
  return new StepUpGuard(reflector, config);
}

function userSteppedUpMinutesAgo(minutes: number | null): AuthedUser {
  return {
    id: 'u1',
    email: 'admin@pmh.com.vn',
    fullName: 'Quản trị',
    role: 'admin',
    sessionId: 's1',
    steppedUpAt: minutes === null ? null : new Date(Date.now() - minutes * 60_000),
    mustChangePassword: false,
  };
}

describe('StepUpGuard — FR-022', () => {
  it('route không khai @RequiresStepUp thì đi thẳng, không đọc cấu hình', async () => {
    await expect(guardWith(false).canActivate(contextFor(undefined))).resolves.toBe(true);
  });

  it('vừa gõ mã xong → cho qua', async () => {
    const ctx = contextFor(userSteppedUpMinutesAgo(0));
    await expect(guardWith(true).canActivate(ctx)).resolves.toBe(true);
  });

  it('còn trong grace → cho qua mà không hỏi lại (đó mới là ý nghĩa của grace)', async () => {
    const ctx = contextFor(userSteppedUpMinutesAgo(9));
    await expect(guardWith(true).canActivate(ctx)).resolves.toBe(true);
  });

  it('quá grace → đòi gõ lại', async () => {
    const ctx = contextFor(userSteppedUpMinutesAgo(11));
    await expect(guardWith(true).canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('chưa từng gõ mã trong phiên → đòi gõ', async () => {
    const ctx = contextFor(userSteppedUpMinutesAgo(null));
    await expect(guardWith(true).canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  /**
   * SessionGuard chạy trước và đã chặn phiên rác, nhưng guard này KHÔNG được suy ra
   * "không có user nghĩa là ổn" — thứ tự guard là thứ dễ bị đổi nhất khi thêm module mới.
   */
  it('không có phiên → chặn, không phải cho qua', async () => {
    await expect(guardWith(true).canActivate(contextFor(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  /**
   * Mã phải là SESSION_MISSING chứ KHÔNG phải STEPUP_REQUIRED: client coi STEPUP_REQUIRED là
   * "phiên còn sống, chỉ cần gõ mã" và mở hộp nhập mã. Không có phiên thì gõ mã nào cũng vô
   * nghĩa — người dùng kẹt trong hộp thoại không thoát được (code review Epic 4).
   */
  it('không có phiên trả SESSION_MISSING, để UI đưa về màn đăng nhập', async () => {
    await guardWith(true)
      .canActivate(contextFor(undefined))
      .catch((error: UnauthorizedException) => {
        expect(error.getResponse()).toMatchObject({ code: 'SESSION_MISSING' });
      });
    expect.assertions(1);
  });

  it('grace đọc từ system_config, không phải hằng số 10', async () => {
    const ctx = contextFor(userSteppedUpMinutesAgo(20));
    // Admin nới grace lên 30 phút → cùng một phiên đó phải được đi qua.
    await expect(guardWith(true, 30).canActivate(ctx)).resolves.toBe(true);
    await expect(guardWith(true, 15).canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('lỗi trả về mang mã STEPUP_REQUIRED để UI biết mở hộp nhập mã, không đá về đăng nhập', async () => {
    const ctx = contextFor(userSteppedUpMinutesAgo(null));
    await guardWith(true).canActivate(ctx).catch((error: UnauthorizedException) => {
      expect(error.getResponse()).toMatchObject({ code: 'STEPUP_REQUIRED', graceMinutes: 10 });
    });
    expect.assertions(1);
  });
});
