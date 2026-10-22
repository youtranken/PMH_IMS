import { describe, expect, it } from 'vitest';
import { bandwidthLabel } from './bandwidth';

/* PW-A15: ô Tốc độ gói cước là chữ tự do — "400" trơn không nói 400 gì. */
describe('bandwidthLabel', () => {
  it.each([
    ['400', '400 Mbps'],
    [' 1000 ', '1000 Mbps'],
    ['2.5', '2.5 Mbps'],
    ['300 Mbps', '300 Mbps'],
    ['1 Gbps', '1 Gbps'],
    ['100/50 Mbps', '100/50 Mbps'],
    ['', ''],
  ])('%j → %j', (raw, label) => {
    expect(bandwidthLabel(raw)).toBe(label);
  });
  it('null → null', () => expect(bandwidthLabel(null)).toBeNull());
});
