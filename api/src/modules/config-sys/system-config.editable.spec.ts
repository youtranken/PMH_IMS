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

  it('X-02: danh sách cổng nhạy cảm của NAT sửa được — cổng 1..65535, không trùng, KHÔNG bắt tăng dần', () => {
    const ports = editableByKey('nat.sensitive_ports')!;
    expect(ports.group).toBe('ipam');
    expect(validateSetting(ports, '3389, 22,8291')).toEqual({ value: '3389,22,8291', reason: null });
    expect(validateSetting(ports, '22,22').reason).toMatch(/trùng/);
    expect(validateSetting(ports, '0,22').reason).not.toBeNull();
    expect(validateSetting(ports, '70000').reason).not.toBeNull();
    expect(validateSetting(ports, Array.from({ length: 51 }, (_, i) => i + 1).join(',')).reason).not.toBeNull();
  });

  it('X-02: cửa sổ "break-glass gần đây" sửa được, 1..365 ngày', () => {
    const window = editableByKey('breakglass.recent_window_days')!;
    expect(window.group).toBe('approval');
    expect(validateSetting(window, 0).reason).not.toBeNull();
    expect(validateSetting(window, 90)).toEqual({ value: 90, reason: null });
  });

  it('sơ đồ mạng (AD-17): hạn chờ trình vẽ và trần cổng kiểm sửa được, có khoảng', () => {
    const timeout = editableByKey('diagram.editor_init_timeout_seconds')!;
    const xml = editableByKey('diagram.xml_max_kb')!;
    const svg = editableByKey('diagram.svg_max_kb')!;
    const cells = editableByKey('diagram.max_cells')!;
    for (const spec of [timeout, xml, svg, cells]) expect(spec.group).toBe('diagram');
    expect(validateSetting(timeout, 20)).toEqual({ value: 20, reason: null });
    expect(validateSetting(timeout, 0).reason).not.toBeNull();
    // Trần trên phải nằm dưới trần body 5 MB của route lưu, không thì nới tham số cũng vô ích.
    for (const spec of [xml, svg]) expect(spec.max! * 1024).toBeLessThan(5 * 1024 * 1024);
    expect(validateSetting(cells, 100).reason).not.toBeNull();
  });

  it('giấy tờ đính kèm (Q-18): ba khoá sửa được, có khoảng', () => {
    const size = editableByKey('file.max_size_mb')!;
    const batch = editableByKey('file.max_files_per_batch')!;
    const purge = editableByKey('file.purge_after_days')!;
    for (const spec of [size, batch, purge]) expect(spec.group).toBe('files');
    // Trần 25 khớp trần cứng multer/nginx — `files/file-validation.spec.ts` chốt hai số bằng nhau.
    expect(validateSetting(size, 25)).toEqual({ value: 25, reason: null });
    expect(validateSetting(size, 26).reason).not.toBeNull();
    expect(validateSetting(size, 0).reason).not.toBeNull();
    expect(validateSetting(batch, 0).reason).not.toBeNull();
    // Dọn blob là việc không lùi lại được: không cho đặt ngắn tới mức lỡ tay xoá hôm qua đã mất.
    expect(validateSetting(purge, 6).reason).not.toBeNull();
    expect(validateSetting(purge, 7)).toEqual({ value: 7, reason: null });
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

  it.each(['11/2026', '2026-1', '2026-13', '2026-00', '202611', 'abc'])('tháng bắt đầu phiếu ISO "%s" bị từ chối', (raw) => {
    expect(validateSetting(editableByKey('iso.first_month')!, raw).reason).not.toBeNull();
  });

  it('tháng bắt đầu phiếu ISO dạng YYYY-MM được nhận', () => {
    expect(validateSetting(editableByKey('iso.first_month')!, ' 2026-11 ')).toEqual({ value: '2026-11', reason: null });
  });

  it('danh sách số: chuẩn hoá "5, 15,30" → "5,15,30"; phải tăng dần, trong khoảng', () => {
    expect(validateSetting(backoff, '5, 15,30')).toEqual({ value: '5,15,30', reason: null });
    expect(validateSetting(backoff, '30,15').reason).not.toBeNull();
    expect(validateSetting(backoff, '5,,15').reason).not.toBeNull();
    expect(validateSetting(backoff, '0,5').reason).not.toBeNull();
    expect(validateSetting(backoff, '').reason).not.toBeNull();
  });
});
