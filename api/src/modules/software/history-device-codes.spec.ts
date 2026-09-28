import { deviceIdsInHistory, withDeviceCodes } from './history-device-codes';

const row = (changes: Record<string, { before: unknown; after: unknown }> | null) => ({
  id: 'h1',
  softwareId: 's1',
  action: 'license-assigned',
  actor: 'sa',
  createdAt: new Date('2026-09-28T00:00:00Z'),
  changes,
});

describe('Lịch sử phần mềm: deviceId → mã máy (SW-044)', () => {
  const codes = new Map([
    ['d1', 'LT-E2E-05'],
    ['d2', 'PC-E2E-01'],
  ]);

  it('gom mọi deviceId ở cả hai phía, bỏ null', () => {
    expect(
      deviceIdsInHistory([
        row({ deviceId: { before: null, after: 'd1' } }),
        row({ deviceId: { before: 'd2', after: null } }),
        row({ note: { before: 'a', after: 'b' } }),
        row(null),
      ]).sort(),
    ).toEqual(['d1', 'd2']);
  });

  it.each([
    ['gán', { before: null, after: 'd1' }, { before: null, after: 'LT-E2E-05' }],
    ['gỡ', { before: 'd2', after: null }, { before: 'PC-E2E-01', after: null }],
    // Máy đã bị xoá khỏi kho: giữ nguyên id còn hơn in "trống" như thể chưa từng có máy.
    ['không tra được', { before: null, after: 'd9' }, { before: null, after: 'd9' }],
  ])('%s: đổi `deviceId` thành `device` mang mã máy', (_name, change, expected) => {
    const [out] = withDeviceCodes([row({ deviceId: change, note: { before: null, after: 'x' } })], codes);
    expect(out.changes).toEqual({ device: expected, note: { before: null, after: 'x' } });
  });

  it('dòng không có deviceId giữ nguyên', () => {
    const input = row({ name: { before: 'a', after: 'b' } });
    expect(withDeviceCodes([input], codes)[0]).toEqual(input);
  });
});
