import { modelKey } from './device-model-key';

describe('modelKey — chống model tách đôi (Q-26)', () => {
  it.each([
    ['C9300-48P', 'C930048P'],
    ['c9300 48p', 'C930048P'],
    [' C9300_48P. ', 'C930048P'],
    ['XG-430', 'XG430'],
    ['FortiGate 60F', 'FORTIGATE60F'],
    ['R740\txd', 'R740XD'],
    ['---', ''],
  ])('%j → %j', (input, key) => {
    expect(modelKey(input)).toBe(key);
  });
});
