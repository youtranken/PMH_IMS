import { describe, expect, it } from 'vitest';
import { accessView } from './device-access';

describe('accessView — dòng Truy cập quản trị thành link / lệnh (Q-26)', () => {
  it.each([
    ['Web IP + cổng lạ', { kind: 'web', address: '10.0.1.1', port: 8080 }, { href: 'http://10.0.1.1:8080', command: null, text: '10.0.1.1:8080' }],
    ['Web cổng 443 → https', { kind: 'web', address: 'fw.pmh.local', port: 443 }, { href: 'https://fw.pmh.local', command: null, text: 'fw.pmh.local:443' }],
    ['Web đã có http(s)://', { kind: 'web', address: 'https://10.0.1.1:4444/', port: null }, { href: 'https://10.0.1.1:4444/', command: null, text: 'https://10.0.1.1:4444/' }],
    ['Web scheme lạ không thành link', { kind: 'web', address: 'javascript:alert(1)', port: null }, { href: null, command: null, text: 'javascript:alert(1)' }],
    ['SSH có cổng', { kind: 'ssh', address: '10.0.1.1', port: 2222 }, { href: null, command: 'ssh 10.0.1.1 -p 2222', text: '10.0.1.1:2222' }],
    ['SSH không cổng', { kind: 'ssh', address: 'sw01', port: null }, { href: null, command: 'ssh sw01', text: 'sw01' }],
    ['Telnet', { kind: 'telnet', address: '10.0.0.9', port: 23 }, { href: null, command: 'telnet 10.0.0.9 23', text: '10.0.0.9:23' }],
    ['RDP chỉ hiện chữ', { kind: 'rdp', address: 'srv01', port: 3389 }, { href: null, command: null, text: 'srv01:3389' }],
    // Dữ liệu cũ lỡ lưu địa chỉ độc: không bao giờ thành lệnh để chép.
    ['SSH chèn tuỳ chọn → không có lệnh', { kind: 'ssh', address: '-oProxyCommand=sh', port: null }, { href: null, command: null, text: '-oProxyCommand=sh' }],
    ['SSH chèn lệnh → không có lệnh', { kind: 'ssh', address: '10.0.0.1;id', port: null }, { href: null, command: null, text: '10.0.0.1;id' }],
  ] as const)('%s', (_name, point, expected) => {
    expect(accessView(point)).toEqual(expected);
  });
});
