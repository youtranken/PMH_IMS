import { describe, expect, it } from 'vitest';
import { freePortOptions, freePorts, linksBetween, nextFreePort, outsideLayout, portTakenBy, usedPorts, type PortMap, type PortPanelData, type PortRow } from './port-types';

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

describe('usedPorts / portTakenBy / nextFreePort — hộp Khai báo trùng cổng ngay tại ô (Q-23 05/10)', () => {
  it('cổng đã có cáp: dòng của máy nối đi (máy hoặc chữ) + dòng máy khác cắm vào; sắp tự nhiên', () => {
    expect(usedPorts(MAP)).toEqual([
      { label: 'Gi2', peer: 'SRV' },
      { label: 'Gi3', peer: 'Uplink FPT' },
      { label: 'gi4', peer: 'SRV' },
    ]);
    expect(usedPorts(undefined)).toEqual([]);
  });

  it.each([
    ['Gi2', 'SRV'],
    ['GI4', 'SRV'],
    [' gi3 ', 'Uplink FPT'],
    ['Gi1', null],
    ['Gi9', null],
    ['', null],
  ])('portTakenBy(%j) = %j', (label, want) => {
    expect(portTakenBy(MAP, label)).toBe(want);
  });

  it.each([
    ['Gi2', 'Gi5'],
    ['Gi3', 'Gi5'],
    ['Gi1', 'Gi1'],
  ])('nextFreePort(%j) = %j — tăng số cuối tới cổng chưa có cáp', (label, want) => {
    expect(nextFreePort(MAP, label)).toBe(want);
  });

  it('nhãn đã chiếm mà không có số cuối thì không đoán', () => {
    expect(nextFreePort({ ports: [port({ portLabel: 'WAN', connectedLabel: 'ISP' })], incoming: [] }, 'wan')).toBe('');
  });
});

describe('freePortOptions / outsideLayout — gợi ý cổng trống theo danh sách cổng của máy (Q-26)', () => {
  const PANEL: PortPanelData = {
    ports: [
      { label: 'Gi1', kind: 'rj45', peer: null },
      { label: 'Gi2', kind: 'rj45', peer: 'SRV · eth0' },
      { label: 'Gi5', kind: 'rj45', peer: null },
      { label: 'Te1', kind: 'sfp+', peer: null },
    ],
    unlisted: [],
    used: 1,
    total: 4,
  };

  it('cổng vật lý chưa có dây theo thứ tự cổng thật, rồi dòng trống ngoài danh sách; không lặp', () => {
    // MAP: Gi1 (chỉ VLAN — trống), Gi4 (dòng trống nhưng máy khác cắm vào → đang dùng).
    expect(freePortOptions(MAP, PANEL)).toEqual(['Gi1', 'Gi5', 'Te1']);
  });

  it('máy chưa có danh sách cổng: như freePorts cũ', () => {
    expect(freePortOptions(MAP, undefined)).toEqual(freePorts(MAP));
  });

  it.each([
    ['trong danh sách (khác hoa thường)', 'gi5', false],
    ['ngoài danh sách', 'mgmt', true],
    ['ô trống', '  ', false],
  ])('%s', (_name, label, expected) => {
    expect(outsideLayout(PANEL, label)).toBe(expected);
  });

  it('máy chưa có danh sách cổng thì không bao giờ là "ngoài danh sách"', () => {
    expect(outsideLayout({ ports: [], unlisted: [], used: 0, total: 0 }, 'mgmt')).toBe(false);
  });
});
