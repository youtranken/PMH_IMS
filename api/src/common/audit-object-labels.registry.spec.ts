import {
  AuditObjectLabelRegistry,
  auditObjectKey,
  type AuditObjectLabeler,
} from './audit-object-labels.registry';

const DEV = '11111111-1111-4111-8111-111111111111';
const DEV2 = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

type Label = { label: string; path: string | null };

function labeler(
  types: string[],
  impl: (type: string, ids: string[]) => Map<string, Label>,
): AuditObjectLabeler & { calls: [string, string[]][] } {
  const calls: [string, string[]][] = [];
  return {
    objectTypes: types,
    calls,
    labelsFor: (type, ids) => {
      calls.push([type, ids]);
      return Promise.resolve(impl(type, ids));
    },
  };
}

describe('AuditObjectLabelRegistry', () => {
  it('gom theo loại: MỘT lời gọi cho cả trang, không phải một lời mỗi dòng', async () => {
    const registry = new AuditObjectLabelRegistry();
    const devices = labeler(['device'], (_t, ids) =>
      new Map(ids.map((id) => [id, { label: `PC-${id.slice(0, 2)}`, path: `/devices/${id}` }])),
    );
    registry.register(devices);
    const out = await registry.labelsFor([
      { objectType: 'device', objectId: DEV },
      { objectType: 'device', objectId: DEV2 },
      { objectType: 'device', objectId: DEV },
    ]);
    expect(devices.calls).toHaveLength(1);
    expect(devices.calls[0][1].sort()).toEqual([DEV, DEV2].sort());
    expect(out.get(auditObjectKey('device', DEV))).toEqual({ label: 'PC-11', path: `/devices/${DEV}` });
  });

  it('id không phải UUID, loại chưa ai khai → bỏ qua, không gọi ai', async () => {
    const registry = new AuditObjectLabelRegistry();
    const users = labeler(['user'], () => new Map());
    registry.register(users);
    const out = await registry.labelsFor([
      { objectType: 'user', objectId: 'not-a-uuid' },
      { objectType: 'nat_rule', objectId: DEV },
      { objectType: null, objectId: DEV },
    ]);
    expect(users.calls).toHaveLength(0);
    expect(out.size).toBe(0);
  });

  it('một người gọi tên ném lỗi thì các loại khác vẫn có nhãn (nhật ký không được tắt vì một nhãn)', async () => {
    const registry = new AuditObjectLabelRegistry();
    registry.register(
      labeler(['device'], () => {
        throw new Error('db down');
      }),
    );
    registry.register(
      labeler(['user'], (_t, ids) => new Map(ids.map((id) => [id, { label: 'a@pmh.com.vn', path: null }]))),
    );
    const out = await registry.labelsFor([
      { objectType: 'device', objectId: DEV },
      { objectType: 'user', objectId: USER },
    ]);
    expect(out.get(auditObjectKey('user', USER))?.label).toBe('a@pmh.com.vn');
    expect(out.has(auditObjectKey('device', DEV))).toBe(false);
  });

  it('khoá theo cả loại: cùng một UUID ở hai loại không đè nhau', async () => {
    const registry = new AuditObjectLabelRegistry();
    registry.register(labeler(['device'], (_t, ids) => new Map(ids.map((id) => [id, { label: 'máy', path: null }]))));
    registry.register(labeler(['user'], (_t, ids) => new Map(ids.map((id) => [id, { label: 'người', path: null }]))));
    const out = await registry.labelsFor([
      { objectType: 'device', objectId: DEV },
      { objectType: 'user', objectId: DEV },
    ]);
    expect(out.get(auditObjectKey('device', DEV))?.label).toBe('máy');
    expect(out.get(auditObjectKey('user', DEV))?.label).toBe('người');
  });
});
