import { nextPortLabel, planBulkPorts } from './port-plan';

describe('nextPortLabel — tăng số cuối của nhãn cổng', () => {
  it.each([
    ['Gi1/0/5', 'Gi1/0/6'],
    ['Gi1/0/9', 'Gi1/0/10'],
    ['12', '13'],
    ['eth09', 'eth10'],
    ['uplink', ''],
    ['', ''],
  ])('%s → %s', (from, expected) => {
    expect(nextPortLabel(from)).toBe(expected);
  });
});

/**
 * Nối hàng loạt (Story 10.5): một switch + N máy, cổng bắt đầu (và cổng cuối nếu có) → cổng cho
 * từng máy theo thứ tự, BỎ QUA cổng đã chiếm; không đủ cổng thì không chia gì cả.
 */
describe('planBulkPorts', () => {
  const taken = (...labels: string[]) => new Set(labels.map((l) => l.toLowerCase()));

  it.each([
    ['liền nhau', { start: 'Gi1/0/1', count: 3, taken: taken() }, ['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/3'], null],
    ['bỏ qua cổng đã chiếm (không phân biệt hoa/thường)', { start: 'Gi1/0/1', count: 3, taken: taken('gi1/0/2') }, ['Gi1/0/1', 'Gi1/0/3', 'Gi1/0/4'], null],
    ['có cổng cuối, vừa đủ', { start: 'Gi1/0/1', end: 'Gi1/0/4', count: 3, taken: taken('Gi1/0/3') }, ['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/4'], null],
    ['có cổng cuối, không đủ → không chia gì', { start: 'Gi1/0/1', end: 'Gi1/0/3', count: 3, taken: taken('Gi1/0/2') }, [], 'not-enough'],
    ['cổng bắt đầu không kết thúc bằng số', { start: 'uplink', count: 2, taken: taken() }, [], 'start-not-numbered'],
    ['cổng cuối khác tiền tố', { start: 'Gi1/0/1', end: 'Te1/0/4', count: 2, taken: taken() }, [], 'end-mismatch'],
    ['cổng cuối nhỏ hơn cổng đầu', { start: 'Gi1/0/5', end: 'Gi1/0/2', count: 1, taken: taken() }, [], 'end-mismatch'],
    ['không có máy nào', { start: 'Gi1/0/1', count: 0, taken: taken() }, [], 'no-targets'],
  ])('%s', (_label, input, ports, reason) => {
    expect(planBulkPorts(input)).toEqual({ ports, reason });
  });
});
