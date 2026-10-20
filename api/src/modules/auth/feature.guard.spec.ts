import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Feature } from '../../common/features';
import { FEATURE_KEY } from './feature.decorator';
import { FeatureGuard } from './feature.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthedUser } from './types';

function contextFor(user: AuthedUser | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardWith(declared: Feature[] | undefined, isPublic = false): FeatureGuard {
  const reflector = {
    getAllAndOverride: (key: string) => (key === IS_PUBLIC_KEY ? isPublic : key === FEATURE_KEY ? declared : undefined),
  } as unknown as Reflector;
  return new FeatureGuard(reflector);
}

function member(features: Feature[] | null): AuthedUser {
  return {
    id: 'u1',
    email: 'member@pmh.com.vn',
    fullName: 'Thành viên',
    role: 'member',
    sessionId: 's1',
    steppedUpAt: null,
    diagramSteppedUpAt: null,
    mustChangePassword: false,
    features,
  };
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    return ((error as ForbiddenException).getResponse() as { code: string }).code;
  }
}

describe('FeatureGuard (Q-31)', () => {
  it('route @Public đi qua, không cần khai mảng', () => {
    expect(guardWith(undefined, true).canActivate(contextFor(undefined))).toBe(true);
  });

  it('MẶC ĐỊNH ĐÓNG: route quên khai mảng thì 403 cho mọi vai, kể cả người đủ quyền', () => {
    expect(codeOf(() => guardWith(undefined).canActivate(contextFor(member(null))))).toBe(
      'FEATURE_NOT_DECLARED',
    );
  });

  it('@FeatureFree: Member bị giới hạn vẫn vào', () => {
    expect(guardWith([]).canActivate(contextFor(member(['network'])))).toBe(true);
  });

  it('Member không giới hạn (features = null) vào mọi mảng', () => {
    expect(guardWith(['assets']).canActivate(contextFor(member(null)))).toBe(true);
  });

  it('Member có mảng thì vào', () => {
    expect(guardWith(['network']).canActivate(contextFor(member(['network'])))).toBe(true);
  });

  it('Member có MỘT trong các mảng khai là đủ', () => {
    expect(guardWith(['assets', 'network']).canActivate(contextFor(member(['network'])))).toBe(true);
  });

  it('Member thiếu mảng thì 403 FEATURE_HIDDEN', () => {
    expect(codeOf(() => guardWith(['assets']).canActivate(contextFor(member(['network']))))).toBe(
      'FEATURE_HIDDEN',
    );
  });

  it('nhóm rỗng không lọt: thiếu mảng là 403', () => {
    expect(codeOf(() => guardWith(['overview']).canActivate(contextFor(member([]))))).toBe(
      'FEATURE_HIDDEN',
    );
  });
});
