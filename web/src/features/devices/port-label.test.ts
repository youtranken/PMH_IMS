import { describe, expect, it } from 'vitest';
import { nextPortLabel, sortByPortLabel } from './port-label';

/* Cổng phải xếp đúng thứ tự mặt trước switch: đứng trước tủ tìm cổng 3 mà bảng xếp
   Gi1/0/1, Gi1/0/10, Gi1/0/2 thì phải dò cả bảng. */
describe('sortByPortLabel', () => {
  it('sắp theo số tự nhiên, cổng Te/uplink sau Gi', () => {
    const rows = ['Gi1/0/10', 'Te1/1/1', 'Gi1/0/2', 'Gi1/0/1', 'Gi1/0/23', 'WAN1', '2', '12'].map(
      (portLabel) => ({ portLabel }),
    );
    expect(sortByPortLabel(rows).map((r) => r.portLabel)).toEqual([
      '2',
      '12',
      'Gi1/0/1',
      'Gi1/0/2',
      'Gi1/0/10',
      'Gi1/0/23',
      'Te1/1/1',
      'WAN1',
    ]);
  });

  it('không đụng vào mảng gốc', () => {
    const rows = [{ portLabel: 'b' }, { portLabel: 'a' }];
    sortByPortLabel(rows);
    expect(rows[0].portLabel).toBe('b');
  });
});

/* "Ghi rồi thêm cổng khác": khai 24 cổng liền nhau thì nhãn kế tiếp tự tăng. */
describe('nextPortLabel', () => {
  it.each([
    ['Gi1/0/5', 'Gi1/0/6'],
    ['Gi1/0/9', 'Gi1/0/10'],
    ['12', '13'],
    ['WAN1', 'WAN2'],
    ['eth09', 'eth10'],
    ['uplink', ''],
    ['', ''],
  ])('%s → %s', (from, expected) => {
    expect(nextPortLabel(from)).toBe(expected);
  });
});
