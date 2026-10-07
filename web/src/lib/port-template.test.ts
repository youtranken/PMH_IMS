import { describe, expect, it } from 'vitest';
import { expandPortTemplate } from './port-template';

describe('expandPortTemplate (web) — cùng phép với api', () => {
  it.each([
    ['Switch Cisco', [{ pattern: 'Gi1/0/[1-2]', kind: 'rj45' }, { pattern: 'Te1/1/[1-1]', kind: 'sfp+' }], ['Gi1/0/1', 'Gi1/0/2', 'Te1/1/1'], null],
    ['một LAN', [{ pattern: ' LAN ', kind: 'rj45' }], ['LAN'], null],
    ['trống', [], [], null],
    ['dải ngược', [{ pattern: 'Port[8-1]', kind: 'rj45' }], [], { key: 'reversed', value: '[8-1]' }],
    ['hai dải', [{ pattern: 'Gi[1-2]/0/[1-4]', kind: 'rj45' }], [], { key: 'twoRanges', value: 'Gi[1-2]/0/[1-4]' }],
    ['trùng', [{ pattern: 'eth[0-1]', kind: 'rj45' }, { pattern: 'ETH1', kind: 'rj45' }], [], { key: 'duplicate', value: 'ETH1' }],
    ['vượt trần', [{ pattern: 'p[1-300]', kind: 'rj45' }], [], { key: 'tooMany', value: '256' }],
  ] as const)('%s', (_name, groups, labels, error) => {
    const result = expandPortTemplate(groups, 256);
    expect(result.ports.map((p) => p.label)).toEqual(labels);
    expect(result.error).toEqual(error);
  });
});
