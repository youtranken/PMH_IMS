import { portEndOffset } from './port-end-place';

/**
 * Nhãn cổng ở hai đầu dây nằm SÁT đầu dây (Q-26 07/10): vị trí tương đối draw.io (−1 … 1 dọc nét)
 * tính sao cho nhãn cách mép máy khoảng `PORT_END_GAP` px, không theo tỉ lệ độ dài dây.
 */
describe('portEndOffset — chỗ đặt nhãn cổng đầu dây', () => {
  const box = (x: number, y: number, width = 160, height = 15) => ({ x, y, width, height });
  const rows: { name: string; path: Parameters<typeof portEndOffset>[0]; expected: number }[] = [
    {
      // Hai máy cùng hàng cách nhau 400px (mép tới mép): nhãn cách mép 22px → 1 − 2·22/400.
      name: 'nét thẳng ngang, 400px giữa hai mép',
      path: { source: box(0, 0), target: box(560, 0), points: [], orthogonal: false },
      expected: 0.89,
    },
    {
      // Dây đi vòng dài như CR3: tổng ~1.250px → nhãn vẫn cách mép ~22px chứ không ~150px.
      name: 'dây vòng có điểm gấp (orthogonal)',
      path: {
        source: box(563, 514.6, 162, 14.8),
        target: box(113, 439.2, 162, 14.8),
        points: [
          { x: 510, y: 522 },
          { x: 510, y: 640 },
          { x: 40, y: 640 },
          { x: 40, y: 446.6 },
        ],
        orthogonal: true,
      },
      expected: 0.952,
    },
    {
      name: 'dây quá ngắn: không đẩy hai nhãn chồng lên nhau quá giữa nét',
      path: { source: box(0, 0), target: box(180, 0), points: [], orthogonal: false },
      expected: 0.3,
    },
    {
      name: 'thiếu máy một đầu (dây trôi): giữ chỗ cũ',
      path: { source: null, target: box(0, 0), points: [], orthogonal: false },
      expected: 0.75,
    },
  ];
  it.each(rows)('$name', ({ path, expected }) => {
    expect(portEndOffset(path)).toBeCloseTo(expected, 2);
  });
});
