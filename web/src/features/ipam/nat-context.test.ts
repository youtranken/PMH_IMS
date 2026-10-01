import { describe, expect, it } from 'vitest';
import { serviceNameFor, wanByRouter } from './nat-context';

const svc = (name: string, protocol: 'tcp' | 'udp' | 'both', portFrom: number, portTo = portFrom) => ({
  id: name,
  name,
  protocol,
  portFrom,
  portTo,
  description: null,
  active: true,
});

describe('serviceNameFor — tên dịch vụ của cổng trong', () => {
  const services = [
    svc('RDP', 'tcp', 3389),
    svc('Camera RTSP', 'both', 554),
    svc('DNS', 'udp', 53),
    svc('Dải web phụ', 'tcp', 8000, 8100),
    svc('Web phụ 8080', 'tcp', 8080),
  ];
  it.each<[number, 'tcp' | 'udp' | 'both', string | null]>([
    [3389, 'tcp', 'RDP'],
    [3389, 'udp', null], // RDP khai TCP — rule UDP 3389 không phải RDP
    [554, 'tcp', 'Camera RTSP'], // dịch vụ "both" khớp mọi giao thức
    [53, 'both', null], // rule TCP+UDP mà dịch vụ chỉ UDP: không đoán
    [8080, 'tcp', 'Web phụ 8080'], // mục một cổng thắng mục dải
    [8050, 'tcp', 'Dải web phụ'],
    [22, 'tcp', null],
  ])('%s/%s → %s', (port, protocol, expected) => {
    expect(serviceNameFor(port, protocol, services)).toBe(expected);
  });
});

describe('wanByRouter — IP WAN của đường truyền gắn router', () => {
  it('gom theo thiết bị biên, bỏ đường không có WAN hoặc không gắn máy', () => {
    const map = wanByRouter([
      { deviceId: 'r1', wanIps: ['113.161.10.20', '113.161.10.21'] },
      { deviceId: 'r1', wanIps: ['14.1.1.1'] },
      { deviceId: 'r2', wanIps: [] },
      { deviceId: null, wanIps: ['1.1.1.1'] },
    ]);
    expect(map.get('r1')).toEqual(['113.161.10.20', '113.161.10.21', '14.1.1.1']);
    expect(map.has('r2')).toBe(false);
    expect(map.size).toBe(1);
  });
});
