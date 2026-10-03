import { rackUnitLabel } from '../../common/rack-units';
import { rackClaimMoved, rackClaimOf, rackOverlap, rackUnitsReason, type RackUnitsInput } from './rack-units';

const base: RackUnitsInput = { start: 5, size: 2, cabinetCode: 'R1', cabinetHeight: 42, hasCabinet: true };

describe('rackUnitsReason — U bắt đầu / Số U (1–60, không vượt tủ)', () => {
  const cases: [string, Partial<RackUnitsInput>, RegExp | null][] = [
    ['hợp lệ', {}, null],
    ['cùng trống', { start: null, size: null }, null],
    ['trống cả khi không có tủ', { start: null, size: null, hasCabinet: false }, null],
    ['thiếu số U', { size: null }, /cùng có hoặc cùng trống/],
    ['thiếu U bắt đầu', { start: null }, /cùng có hoặc cùng trống/],
    ['U bắt đầu 0', { start: 0 }, /từ 1 tới 60/],
    ['U bắt đầu 61', { start: 61, size: 1 }, /từ 1 tới 60/],
    ['số U 0', { size: 0 }, /từ 1 tới 60/],
    ['số lẻ', { start: 2.5 }, /số nguyên/],
    ['có U mà không gắn tủ', { hasCabinet: false }, /chọn tủ/],
    ['vượt chiều cao tủ', { start: 41, size: 3 }, /U41–U43 vượt tủ R1 \(42U\)/],
    ['vừa khít đỉnh tủ', { start: 41, size: 2 }, null],
    ['tủ chưa khai chiều cao: chỉ trần 60', { start: 59, size: 2, cabinetHeight: null }, null],
    ['tủ chưa khai chiều cao vượt 60', { start: 60, size: 2, cabinetHeight: null }, /vượt 60U/],
  ];
  it.each(cases)('%s', (_name, patch, expected) => {
    const reason = rackUnitsReason({ ...base, ...patch });
    if (expected === null) expect(reason).toBeNull();
    else expect(reason).toMatch(expected);
  });
});

describe('rackOverlap — hai máy chồng U trong cùng tủ (Q-23)', () => {
  const others = [
    { code: 'SW-01', name: 'Switch tầng 3', start: 10, size: 1 },
    { code: 'SRV-01', name: 'Máy chủ', start: 20, size: 4 },
  ];
  it.each([
    [{ start: 10, size: 1 }, 'SW-01'],
    [{ start: 9, size: 2 }, 'SW-01'],
    [{ start: 23, size: 1 }, 'SRV-01'],
    [{ start: 18, size: 3 }, 'SRV-01'],
    [{ start: 11, size: 9 }, null],
    [{ start: 24, size: 1 }, null],
  ])('%o → %s', (range, expected) => {
    expect(rackOverlap(range, others)?.code ?? null).toBe(expected);
  });
});

describe('rackUnitLabel', () => {
  it.each([
    [5, 1, 'U5'],
    [5, 2, 'U5–U6'],
    [5, null, 'U5'],
    [null, null, null],
  ])('(%s, %s) → %s', (start, size, expected) => {
    expect(rackUnitLabel(start, size)).toBe(expected);
  });
});

describe('rackClaimOf / rackClaimMoved — một bản cho form, đối chiếu và ghi import', () => {
  const inRack = { cabinetId: 'c1', rackUStart: 5, rackUSize: 2, status: 'in_use' };
  it.each([
    ['giữ nguyên', {}, { cabinetId: 'c1', start: 5, size: 2 }],
    ['đổi U', { rackUStart: 9 }, { cabinetId: 'c1', start: 9, size: 2 }],
    ['thanh lý thì không giữ chỗ', { status: 'retired' }, null],
    ['bỏ tủ', { cabinetId: null }, null],
  ])('%s', (_name, values, expected) => {
    expect(rackClaimOf(values, inRack)).toEqual(expected);
  });

  it('hồ sơ chưa có cột U (import ảnh chụp cũ) → không chiếm chỗ', () => {
    expect(rackClaimOf({}, { cabinetId: 'c1', status: 'in_use' })).toBeNull();
  });

  it('so hai chỗ', () => {
    const a = { cabinetId: 'c1', start: 5, size: 2 };
    expect(rackClaimMoved(a, { ...a })).toBe(false);
    expect(rackClaimMoved(a, { ...a, start: 6 })).toBe(true);
    expect(rackClaimMoved(null, a)).toBe(true);
    expect(rackClaimMoved(null, null)).toBe(false);
  });
});
