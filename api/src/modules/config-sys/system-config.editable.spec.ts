import { CONFIG_KEYS } from './system-config.keys';
import { EDITABLE_SETTINGS, editableByKey, validateSetting } from './system-config.editable';

describe('Danh sách tham số sửa được trên màn (Q-14)', () => {
  it('mỗi mục trỏ tới một khoá CÓ THẬT trong CONFIG_KEYS, không trùng', () => {
    const keys = EDITABLE_SETTINGS.map((s) => CONFIG_KEYS[s.name].key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('có hai khoá chủ dự án chốt: câu liên hệ hỗ trợ và số ngày ân hạn tự thanh lý', () => {
    expect(editableByKey('auth.support_contact')?.type).toBe('text');
    expect(editableByKey('software.auto_retire_grace_days')?.type).toBe('int');
  });

  it('khoá kỹ thuật/bí mật KHÔNG nằm trong danh sách — không sửa được qua màn', () => {
    for (const key of [
      'mail.from_address',
      'app.timezone',
      'session.retention_days',
      'outbox.max_relay_attempts',
    ]) {
      expect(editableByKey(key)).toBeUndefined();
    }
  });

  it('trần độ rộng dải chỉ SIẾT được: dưới /24 bị từ chối (màn dải liệt kê mọi host một lượt)', () => {
    const spec = editableByKey('ipam.subnet_min_prefix')!;
    expect(spec.group).toBe('ipam');
    expect(validateSetting(spec, 23).reason).not.toBeNull();
    expect(validateSetting(spec, 26)).toEqual({ value: 26, reason: null });
  });

  it('ngưỡng cảnh báo dải cổng NAT sửa được trên màn', () => {
    expect(editableByKey('nat.wide_port_range')?.group).toBe('ipam');
  });

  it('mặc định của mọi khoá số nằm trong khoảng của chính nó', () => {
    for (const spec of EDITABLE_SETTINGS) {
      const fallback = CONFIG_KEYS[spec.name].fallback;
      expect(validateSetting(spec, fallback).reason).toBeNull();
    }
  });
});

describe('validateSetting', () => {
  const idle = editableByKey('session.idle_minutes')!;
  const contact = editableByKey('auth.support_contact')!;
  const backoff = editableByKey('login.account_backoff_minutes')!;
  const grace = editableByKey('software.auto_retire_grace_days')!;

  it.each([
    [30, 30],
    ['45', 45],
    [' 60 ', 60],
  ])('số hợp lệ %j → %j', (raw, value) => {
    expect(validateSetting(idle, raw)).toEqual({ value, reason: null });
  });

  it.each([[''], ['abc'], [2.5], [0], [100000], [null], [true], [[30]]])(
    'số sai / ngoài khoảng %j → bị từ chối (chuỗi rỗng KHÔNG thành 0)',
    (raw) => {
      expect(validateSetting(idle, raw).reason).not.toBeNull();
    },
  );

  it('0 = tắt là giá trị hợp lệ ở khoá cho phép tắt', () => {
    expect(validateSetting(grace, 0)).toEqual({ value: 0, reason: null });
  });

  it('chữ: cắt khoảng trắng, không rỗng, có trần độ dài', () => {
    expect(validateSetting(contact, '  Gọi IT: 1234  ')).toEqual({
      value: 'Gọi IT: 1234',
      reason: null,
    });
    expect(validateSetting(contact, '   ').reason).not.toBeNull();
    expect(validateSetting(contact, 'x'.repeat(1000)).reason).not.toBeNull();
    expect(validateSetting(contact, 42).reason).not.toBeNull();
  });

  it('danh sách số: chuẩn hoá "5, 15,30" → "5,15,30"; phải tăng dần, trong khoảng', () => {
    expect(validateSetting(backoff, '5, 15,30')).toEqual({ value: '5,15,30', reason: null });
    expect(validateSetting(backoff, '30,15').reason).not.toBeNull();
    expect(validateSetting(backoff, '5,,15').reason).not.toBeNull();
    expect(validateSetting(backoff, '0,5').reason).not.toBeNull();
    expect(validateSetting(backoff, '').reason).not.toBeNull();
  });
});
