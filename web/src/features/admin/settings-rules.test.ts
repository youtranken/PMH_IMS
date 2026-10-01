import { describe, expect, it } from 'vitest';
import { checkDraft, descriptionSlot, warningOf, type SettingRow } from './settings-rules';

const base: SettingRow = {
  name: 'loginRateLimitPerIp',
  key: 'login.rate_limit_per_ip',
  group: 'auth',
  type: 'int',
  unit: 'per_minute',
  min: 5,
  max: 1000,
  warnAbove: 100,
  defaultValue: 20,
  value: 20,
  updatedAt: null,
  updatedBy: null,
};

describe('checkDraft', () => {
  it.each([
    ['20', 20, null],
    [' 150 ', 150, null],
    ['', null, 'settings.errInt'],
    ['abc', null, 'settings.errInt'],
    ['2.5', null, 'settings.errInt'],
    ['4', null, 'settings.errRange'],
    ['1001', null, 'settings.errRange'],
  ])('số %j → %j (%s)', (draft, value, reason) => {
    const got = checkDraft(base, draft);
    expect(got.value).toBe(value);
    expect(got.reason?.key ?? null).toBe(reason);
  });

  it('chữ: cắt khoảng trắng, không rỗng, có trần', () => {
    const row: SettingRow = { ...base, type: 'text', maxLength: 10 };
    expect(checkDraft(row, '  Gọi IT ').value).toBe('Gọi IT');
    expect(checkDraft(row, '   ').reason?.key).toBe('settings.errEmpty');
    expect(checkDraft(row, 'x'.repeat(11)).reason?.key).toBe('settings.errTooLong');
  });

  it('danh sách: tăng dần, trong khoảng, chuẩn hoá dấu phẩy', () => {
    const row: SettingRow = { ...base, type: 'int_list', min: 1, max: 1440 };
    expect(checkDraft(row, '5, 15,30').value).toBe('5,15,30');
    expect(checkDraft(row, '30,15').reason?.key).toBe('settings.errList');
    expect(checkDraft(row, '0,5').reason?.key).toBe('settings.errList');
  });
});

describe('warningOf — giá trị nguy hiểm', () => {
  it('rate limit > 100 cảnh báo; 100 thì không', () => {
    expect(warningOf(base, 150)?.key).toBe('settings.warnAbove');
    expect(warningOf(base, 100)).toBeNull();
  });
  it('0 ở khoá "0 = tắt" cảnh báo', () => {
    const row: SettingRow = { ...base, warnAbove: undefined, warnZero: true, min: 0 };
    expect(warningOf(row, 0)?.key).toBe('settings.warnZero');
    expect(warningOf(row, 3)).toBeNull();
  });
});

describe('descriptionSlot (Q-19)', () => {
  const of = (length: number) => 'a'.repeat(length);
  it.each([
    [0, undefined, undefined],
    [40, of(40), undefined],
    [80, of(80), undefined],
    [81, undefined, of(81)],
    [140, undefined, of(140)],
  ])('mô tả %i ký tự', (length, hint, tip) => {
    expect(descriptionSlot(length ? of(length) : undefined)).toEqual({ hint, tip });
  });

  it('trần dung lượng file luôn hiện dưới ô dù mô tả dài (chủ dự án chốt)', () => {
    expect(descriptionSlot(of(140), 'fileMaxSizeMb')).toEqual({ hint: of(140), tip: undefined });
    expect(descriptionSlot(of(140), 'fileMaxFilesPerBatch')).toEqual({ hint: undefined, tip: of(140) });
  });
});
