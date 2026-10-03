import { shortestPortPath, type PathEdge } from './diagram-path';

const e = (id: string, a: string, b: string): PathEdge => ({ id, a, b });

/*
 * "Chỉ đường" (FR-047, AD-18): đường ngắn nhất theo SỐ DÂY trên đồ thị sơ đồ cổng — máy là đỉnh,
 * mỗi dòng `device_port` là một cạnh vô hướng. Hàm thuần, server nạp cạnh qua `devices.api`.
 */
describe('shortestPortPath — đường ngắn nhất trên sơ đồ cổng', () => {
  const RING = [e('l1', 'A', 'B'), e('l2', 'B', 'C'), e('l3', 'C', 'D'), e('l4', 'A', 'E'), e('l5', 'E', 'D')];

  it.each([
    ['nối thẳng một dây', [e('l1', 'A', 'B')], 'A', 'B', { devices: ['A', 'B'], links: ['l1'] }],
    ['đi ngược chiều bản ghi (cạnh vô hướng)', [e('l1', 'B', 'A')], 'A', 'B', { devices: ['A', 'B'], links: ['l1'] }],
    ['qua máy giữa', [e('l1', 'A', 'B'), e('l2', 'B', 'C')], 'A', 'C', { devices: ['A', 'B', 'C'], links: ['l1', 'l2'] }],
    ['vòng: chọn nhánh ít dây hơn', [...RING, e('l6', 'A', 'D')], 'A', 'D', { devices: ['A', 'D'], links: ['l6'] }],
    ['nhánh ít dây thắng dù id dây lớn hơn', RING, 'A', 'D', { devices: ['A', 'E', 'D'], links: ['l4', 'l5'] }],
    [
      'hai nhánh bằng nhau: chọn theo id dây nhỏ hơn (ổn định giữa các lần hỏi)',
      [e('l4', 'C', 'D'), e('l3', 'A', 'C'), e('l2', 'B', 'D'), e('l1', 'A', 'B')],
      'A',
      'D',
      { devices: ['A', 'B', 'D'], links: ['l1', 'l2'] },
    ],
    ['cùng một máy: đường một đỉnh, không dây', RING, 'C', 'C', { devices: ['C'], links: [] }],
    ['hai dây song song giữa hai máy: lấy dây id nhỏ', [e('l9', 'A', 'B'), e('l2', 'A', 'B')], 'A', 'B', { devices: ['A', 'B'], links: ['l2'] }],
  ])('%s', (_name, edges, from, to, expected) => {
    expect(shortestPortPath(from, to, edges, 10)).toEqual(expected);
  });

  it.each([
    ['không có cạnh nào', [], 'A', 'B'],
    ['hai cụm rời', [e('l1', 'A', 'B'), e('l2', 'C', 'D')], 'A', 'D'],
    ['dây tự nối (dữ liệu hỏng) không tạo đường', [e('l1', 'A', 'A')], 'A', 'B'],
  ])('không có đường: %s → null', (_name, edges, from, to) => {
    expect(shortestPortPath(from, to, edges, 10)).toBeNull();
  });

  it('vượt trần số dây (`diagram.path_max_hops`) → null, không đi tiếp', () => {
    const chain = [e('l1', 'A', 'B'), e('l2', 'B', 'C'), e('l3', 'C', 'D')];
    expect(shortestPortPath('A', 'D', chain, 2)).toBeNull();
    expect(shortestPortPath('A', 'D', chain, 3)).toEqual({ devices: ['A', 'B', 'C', 'D'], links: ['l1', 'l2', 'l3'] });
  });
});
