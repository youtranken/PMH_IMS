import { describe, expect, it } from 'vitest';
import { detailChanges } from './audit-detail';

describe('detailChanges — "đổi từ gì sang gì" trong detail nhật ký', () => {
  it('sửa hồ sơ: mỗi trường là { before, after }', () => {
    expect(
      detailChanges({
        phone: { before: null, after: '0912' },
        fullName: { before: 'A', after: 'B' },
      }),
    ).toEqual({
      changes: [
        { field: 'phone', before: null, after: '0912' },
        { field: 'fullName', before: 'A', after: 'B' },
      ],
      rest: [],
    });
  });

  it('sửa danh mục: { before: {chỉ trường đổi}, after: {mọi trường} }', () => {
    expect(
      detailChanges({ before: { address: '12 NVB' }, after: { code: 'HCM', address: '14 NVB' } }),
    ).toEqual({ changes: [{ field: 'address', before: '12 NVB', after: '14 NVB' }], rest: [] });
  });

  it('dạng cặp { changes: { k: [cũ, mới] } } và các khoá khác đi vào phần còn lại', () => {
    expect(detailChanges({ changes: { phone: [null, '09'] }, reason: 'Nghỉ việc' })).toEqual({
      changes: [{ field: 'phone', before: null, after: '09' }],
      rest: [['reason', 'Nghỉ việc']],
    });
  });

  it.each([
    [null, { changes: [], rest: [] }],
    [{ revokedSessions: 2 }, { changes: [], rest: [['revokedSessions', 2]] }],
    ['chuỗi trần', { changes: [], rest: [['', 'chuỗi trần']] }],
  ])('%j không có thay đổi', (detail, expected) => {
    expect(detailChanges(detail)).toEqual(expected);
  });
});
