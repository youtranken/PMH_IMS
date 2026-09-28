import { describe, expect, it } from 'vitest';
import { allowsAnyIp, invalidAllowedIps } from './service-account-types';

describe('allowsAnyIp — VPN mở cho mọi IP nguồn', () => {
  it.each<[string, 'vpn' | 'shared', string | null, boolean]>([
    ['VPN trống', 'vpn', null, true],
    ['VPN chuỗi rỗng', 'vpn', '  ', true],
    ['VPN có 0.0.0.0/0', 'vpn', '203.113.1.5, 0.0.0.0/0', true],
    ['VPN giới hạn', 'vpn', '203.113.1.5, 118.70.2.0/24', false],
    // Tài khoản dùng chung không có khái niệm dải IP — không bao giờ gắn cờ.
    ['dùng chung', 'shared', null, false],
  ])('%s → %s', (_name, kind, ips, expected) => {
    expect(allowsAnyIp(kind, ips)).toBe(expected);
  });
});

describe('invalidAllowedIps — kiểm từng mục ngay khi gõ', () => {
  it.each<[string, string[]]>([
    ['203.113.1.5, 118.70.2.0/24', []],
    ['203.113.1.5\n118.70.2.0/24', []],
    ['203.113.1, 118.70.2.0/33, abc', ['203.113.1', '118.70.2.0/33', 'abc']],
    ['', []],
  ])('%j → %j', (text, expected) => {
    expect(invalidAllowedIps(text)).toEqual(expected);
  });
});
