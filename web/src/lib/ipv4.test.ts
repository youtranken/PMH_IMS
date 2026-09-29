import { describe, expect, it } from 'vitest';
import {
  cidrContains,
  cidrOverlaps,
  isIpv4OrCidr,
  looksLikeIp,
  maskOfCidr,
  parseIpv4,
  previewCidr,
  subnetOf,
} from './ipv4';

describe('parseIpv4', () => {
  it.each([
    ['10.77.1.53', 0x0a4d0135],
    ['0.0.0.0', 0],
    ['255.255.255.255', 0xffffffff],
    [' 172.16.10.5 ', 0xac100a05],
  ])('%s hợp lệ', (text, value) => {
    expect(parseIpv4(text)).toBe(value);
  });

  it.each(['10.77.1', '10.77.1.256', '10.77.1.5.6', 'abc', '', '10.77.01.5', '10.77.1.5/24'])(
    '%s không phải một địa chỉ',
    (text) => {
      expect(parseIpv4(text)).toBeNull();
    },
  );
});

describe('looksLikeIp — câu gõ có dáng IP/CIDR thì nhóm IP lên đầu', () => {
  it.each(['10.77', '10.77.1.', '10.77.1.53', '172.16.10.0/24', '192.168'])('%s → có', (q) => {
    expect(looksLikeIp(q)).toBe(true);
  });
  it.each(['SW-CORE-01', '10', 'vlan 20', 'PC-10.1', ''])('%s → không', (q) => {
    expect(looksLikeIp(q)).toBe(false);
  });
});

describe('cidrContains', () => {
  it.each([
    ['10.77.1.0/24', '10.77.1.53', true],
    ['10.77.1.0/24', '10.77.2.1', false],
    ['10.77.30.0/28', '10.77.30.15', true],
    ['10.77.30.0/28', '10.77.30.16', false],
    ['0.0.0.0/0', '8.8.8.8', true],
    ['rác', '10.0.0.1', false],
  ])('%s chứa %s → %s', (cidr, ip, expected) => {
    expect(cidrContains(cidr, ip)).toBe(expected);
  });
});

describe('subnetOf — dải chứa địa chỉ, dải hẹp nhất thắng', () => {
  const subnets = [
    { id: 'rong', cidr: '10.77.0.0/16' },
    { id: 'hep', cidr: '10.77.30.0/28' },
    { id: 'khac', cidr: '172.16.10.0/24' },
  ];
  it('chọn dải hẹp nhất khi hai dải lồng nhau', () => {
    expect(subnetOf('10.77.30.5', subnets)?.id).toBe('hep');
  });
  it('rơi về dải rộng khi dải hẹp không chứa', () => {
    expect(subnetOf('10.77.31.5', subnets)?.id).toBe('rong');
  });
  it('không dải nào chứa → null', () => {
    expect(subnetOf('192.168.1.1', subnets)).toBeNull();
  });
});

describe('previewCidr — xem trước dải ngay khi gõ', () => {
  it.each([
    ['10.77.1.5/24', '10.77.1.0/24', 254, '10.77.1.1', '10.77.1.254', '255.255.255.0'],
    ['172.16.10.0/27', '172.16.10.0/27', 30, '172.16.10.1', '172.16.10.30', '255.255.255.224'],
    ['192.168.5.9/30', '192.168.5.8/30', 2, '192.168.5.9', '192.168.5.10', '255.255.255.252'],
    ['10.0.0.7/32', '10.0.0.7/32', 1, '10.0.0.7', '10.0.0.7', '255.255.255.255'],
  ])('%s → %s', (text, cidr, hosts, first, last, mask) => {
    const { value, reason } = previewCidr(text, 24);
    expect(reason).toBeNull();
    expect(value).toEqual({ cidr, hosts, first, last, mask });
  });

  it.each([
    ['', null],
    ['10.77.1', 'format'],
    ['10.77.1.0', 'format'],
    ['10.77.1.0/33', 'format'],
    ['10.77.1.0/x', 'format'],
    ['10.77.0.0/16', 'tooWide'],
    ['10.77.1.0/23', 'tooWide'],
  ])('%s → lỗi %s', (text, reason) => {
    const result = previewCidr(text, 24);
    expect(result.value).toBeNull();
    expect(result.reason).toBe(reason);
  });

  // Trần đến từ `GET ipam/settings` (`ipam.subnet_min_prefix`), không phải hằng số của web.
  it('siết trần lên /26 thì /24 thành quá rộng, /26 vẫn qua', () => {
    expect(previewCidr('10.77.1.0/24', 26).reason).toBe('tooWide');
    expect(previewCidr('10.77.1.0/26', 26).reason).toBeNull();
  });
});

describe('cidrOverlaps — hai dải có chung địa chỉ nào không', () => {
  it.each([
    ['10.77.1.0/24', '10.77.1.128/25', true],
    ['10.77.1.0/25', '10.77.1.128/25', false],
    ['10.77.1.0/24', '10.77.2.0/24', false],
    ['10.77.1.0/24', '10.77.1.0/24', true],
    ['rác', '10.77.1.0/24', false],
  ])('%s ∩ %s → %s', (a, b, expected) => {
    expect(cidrOverlaps(a, b)).toBe(expected);
  });
});

describe('maskOfCidr', () => {
  it.each([
    ['10.77.1.0/24', '255.255.255.0'],
    ['10.77.1.0/28', '255.255.255.240'],
    ['rác', null],
  ])('%s → %s', (cidr, mask) => {
    expect(maskOfCidr(cidr)).toBe(mask);
  });
});

describe('isIpv4OrCidr — IP tĩnh hoặc khối IP', () => {
  it.each(['113.161.10.20', '113.161.10.16/29', '0.0.0.0/0'])('%s → nhận', (text) => {
    expect(isIpv4OrCidr(text)).toBe(true);
  });
  it.each(['113.161.10', '113.161.10.20/33', 'abc', '10.0.0.1/', ''])('%s → không', (text) => {
    expect(isIpv4OrCidr(text)).toBe(false);
  });
});
