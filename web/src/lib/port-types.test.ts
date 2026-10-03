import { describe, expect, it } from 'vitest';
import { freePorts, linksBetween, type PortMap, type PortRow } from './port-types';

function port(over: Partial<PortRow>): PortRow {
  return {
    id: 'p',
    portLabel: 'Gi1',
    connectedDeviceId: null,
    connectedDeviceCode: null,
    connectedDeviceName: null,
    connectedLabel: null,
    connectedPort: null,
    usedBy: null,
    vlan: null,
    note: null,
    ...over,
  };
}

const MAP: PortMap = {
  ports: [
    port({ id: '1', portLabel: 'Gi1', vlan: '20' }),
    port({ id: '2', portLabel: 'Gi2', connectedDeviceId: 'peer', connectedDeviceCode: 'SRV', connectedPort: 'eth0' }),
    port({ id: '3', portLabel: 'Gi3', connectedLabel: 'Uplink FPT' }),
    port({ id: '4', portLabel: 'Gi4' }),
  ],
  incoming: [
    {
      id: '9',
      deviceId: 'peer',
      deviceCode: 'SRV',
      deviceName: 'Máy chủ',
      portLabel: 'eth1',
      connectedPort: 'gi4',
      usedBy: null,
      vlan: null,
      note: null,
    },
  ],
};

describe('freePorts — gợi ý cổng còn trống khi khai dây', () => {
  it('chỉ dòng chưa nối đâu, trừ cổng đang có máy khác cắm vào (không phân biệt hoa/thường)', () => {
    expect(freePorts(MAP)).toEqual(['Gi1']);
    expect(freePorts(undefined)).toEqual([]);
  });
});

describe('linksBetween — dây có sẵn giữa đúng hai máy', () => {
  it('lấy cả dòng của máy này lẫn dòng của máy kia cắm vào', () => {
    expect(linksBetween(MAP, { id: 'me', code: 'SW' }, 'peer').map((l) => [l.id, l.deviceCode, l.portLabel, l.peerPort])).toEqual([
      ['2', 'SW', 'Gi2', 'eth0'],
      ['9', 'SRV', 'eth1', 'gi4'],
    ]);
  });
});
