import { describe, expect, it } from 'vitest';
import { PATHS } from './routes';
import {
  SOFTWARE_KINDS,
  SOFTWARE_SCREENS,
  legacySoftwareListRedirect,
  screenOfKind,
  softwareItemPath,
  softwareKindsParam,
} from './software-screens';

/**
 * Q-22: "Phần mềm" tách thành bốn màn — mỗi loại hồ sơ thuộc ĐÚNG một màn. Bảng dưới là luật
 * chủ dự án chốt; thêm loại mới mà quên xếp màn thì bài cuối đỏ.
 */
describe('SOFTWARE_SCREENS — loại nào ở màn nào (Q-22)', () => {
  it.each([
    ['license', 'software', PATHS.software],
    ['ssl', 'domains', PATHS.domains],
    ['domain', 'domains', PATHS.domains],
    ['maintenance', 'maintenance', PATHS.maintenance],
    ['other', 'services', PATHS.services],
  ] as const)('%s → màn %s (%s)', (kind, screen, list) => {
    expect(screenOfKind(kind).key).toBe(screen);
    expect(screenOfKind(kind).list).toBe(list);
  });

  it('mỗi loại thuộc đúng MỘT màn — không loại nào mồ côi, không loại nào ở hai màn', () => {
    const owners = SOFTWARE_KINDS.map(
      (kind) => Object.values(SOFTWARE_SCREENS).filter((screen) => screen.kinds.includes(kind)).length,
    );
    expect(owners).toEqual(SOFTWARE_KINDS.map(() => 1));
  });

  it('loại lạ (dữ liệu hỏng) rơi về màn Phần mềm, không ném lỗi', () => {
    expect(screenOfKind('???').key).toBe('software');
  });
});

describe('softwareItemPath — link tới hồ sơ đi thẳng vào màn của loại', () => {
  it.each([
    ['license', '/software/x1'],
    ['ssl', '/domains/x1'],
    ['domain', '/domains/x1'],
    ['maintenance', '/maintenance/x1'],
    ['other', '/services/x1'],
  ])('%s → %s', (kind, path) => {
    expect(softwareItemPath(kind, 'x1')).toBe(path);
  });
});

describe('softwareKindsParam — `?kind=` gửi lên API', () => {
  it('màn chưa chọn loại thì hỏi mọi loại của màn', () => {
    expect(softwareKindsParam(SOFTWARE_SCREENS.domains, '')).toBe('domain,ssl');
    expect(softwareKindsParam(SOFTWARE_SCREENS.software, '')).toBe('license');
  });

  it('đã chọn một loại của màn thì chỉ hỏi loại đó', () => {
    expect(softwareKindsParam(SOFTWARE_SCREENS.domains, 'ssl')).toBe('ssl');
  });

  it('loại không thuộc màn (URL gõ tay) thì không lọt ra ngoài màn', () => {
    expect(softwareKindsParam(SOFTWARE_SCREENS.domains, 'license')).toBe('domain,ssl');
  });
});

/**
 * Link cũ `/software?kind=ssl` (đã ghim, đã gửi qua chat) phải tới màn mới. Loại license hay
 * không có `kind` thì ở lại `/software`.
 */
describe('legacySoftwareListRedirect', () => {
  it.each([
    ['?kind=ssl', '/domains?kind=ssl'],
    ['?kind=domain&status=all', '/domains?kind=domain&status=all'],
    ['?kind=maintenance&q=UPS', '/maintenance?q=UPS'],
    ['?kind=other', '/services'],
  ])('/software%s → %s', (search, target) => {
    expect(legacySoftwareListRedirect(search)).toBe(target);
  });

  it.each(['', '?kind=license', '?q=office', '?kind=abc'])('/software%s ở lại', (search) => {
    expect(legacySoftwareListRedirect(search)).toBeNull();
  });
});
