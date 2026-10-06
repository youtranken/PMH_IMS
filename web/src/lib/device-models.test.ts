import { describe, expect, it } from 'vitest';
import { deviceModelParts, modelKey } from './device-models';

describe('modelKey — cùng phép với api (Q-26)', () => {
  it.each([
    ['C9300-48P', 'C930048P'],
    ['c9300 48p', 'C930048P'],
    [' C9300_48P. ', 'C930048P'],
    ['FortiGate 60F', 'FORTIGATE60F'],
    ['R740\txd', 'R740XD'],
    ['---', ''],
  ])('%j → %j', (input, key) => {
    expect(modelKey(input)).toBe(key);
  });
});

describe('deviceModelParts', () => {
  it.each([
    [{ manufacturer: 'Cisco', model: 'C9300-48P', rackMountable: true, uSize: 1 }, { head: 'Cisco · C9300-48P', size: '1U' }],
    [{ manufacturer: null, model: 'M404', rackMountable: false, uSize: null }, { head: 'M404', size: null }],
  ])('%o', (input, expected) => {
    expect(deviceModelParts(input)).toEqual(expected);
  });
});
