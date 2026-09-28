import { describe, expect, it } from 'vitest';
import { cidrContains, looksLikeIp, parseIpv4, subnetOf } from './ipv4';

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
