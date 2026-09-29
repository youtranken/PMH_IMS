import { portVlanOf } from './port-vlan';

describe('portVlanOf — VLAN của một cổng (CHECK device_port_vlan_check)', () => {
  it.each([
    ['20', '20'],
    [' 20 ', '20'],
    ['1', '1'],
    ['4094', '4094'],
    ['trunk', 'trunk'],
    ['Trunk', 'trunk'],
    [' TRUNK ', 'trunk'],
  ])('%s → %s', (raw, value) => {
    expect(portVlanOf(raw)).toEqual({ value, valid: true });
  });

  it.each(['', '  '])('chuỗi rỗng "%s" là bỏ VLAN', (raw) => {
    expect(portVlanOf(raw)).toEqual({ value: null, valid: true });
  });

  it.each(['0', '4095', '020', 'VLAN20', 'vlan 20', '10,20', 'trunk 10', '-1', '1.5'])(
    '%s bị từ chối',
    (raw) => {
      expect(portVlanOf(raw)).toEqual({ value: null, valid: false });
    },
  );
});
