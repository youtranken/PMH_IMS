import { describe, expect, it } from 'vitest';
import { ispMenuItems, ispMenuTargets, parseIspAction } from './isp-status-menu';

/* Tạm ngưng đảo được (`warn`), Dùng lại là lối quay lại (`ok`), Thanh lý thì không (`danger`). */
describe('ispMenuItems — màu từng việc', () => {
  const t = ((key: string) => key) as unknown as Parameters<typeof ispMenuItems>[0];
  it('đường đang dùng: Tạm ngưng warn, Thanh lý danger', () => {
    const [suspend, terminate] = ispMenuItems(t, 'active', () => {});
    expect(suspend).toMatchObject({ key: 'suspended', warn: true });
    expect(terminate).toMatchObject({ key: 'terminated', danger: true });
  });
  it('đường tạm ngưng / đã thanh lý: Dùng lại ok', () => {
    expect(ispMenuItems(t, 'suspended', () => {})[0]).toMatchObject({ key: 'active', ok: true });
    expect(ispMenuItems(t, 'terminated', () => {})[0]).toMatchObject({ key: 'active', ok: true });
  });
});

describe('ispMenuTargets — việc đổi trạng thái trong menu ⋮ của một đường truyền', () => {
  it.each([
    ['active', ['suspended', 'terminated']],
    ['suspended', ['active', 'terminated']],
    ['terminated', ['active']],
  ] as const)('%s → %j', (status, targets) => {
    expect(ispMenuTargets(status)).toEqual(targets);
  });
});

/*
 * `?action=` đến từ thanh địa chỉ — ai cũng gõ được. Chỉ nhận đúng bước đi được từ trạng thái
 * hiện tại, không thì một link cũ "Thanh lý" bật hộp thanh lý cho đường đã thanh lý.
 */
describe('parseIspAction — `?action=` từ danh sách', () => {
  it.each([
    ['terminated', 'active', 'terminated'],
    ['suspended', 'active', 'suspended'],
    ['active', 'suspended', 'active'],
    ['active', 'active', null],
    ['terminated', 'terminated', null],
    ['retire', 'active', null],
    [null, 'active', null],
  ] as const)('%s trên đường %s → %s', (action, status, expected) => {
    expect(parseIspAction(action, status)).toBe(expected);
  });
});
