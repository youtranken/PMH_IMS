import { buildCellIndex } from './diagram-cells';
import { cableEdgeStates } from './diagram-checks';
import { buildDraftXml } from './diagram-draft';
import { checkDiagramXml } from './diagram-gate';

const A = '7b0c1c1e-0000-4000-8000-00000000000a';
const B = '7b0c1c1e-0000-4000-8000-00000000000b';
const C = '7b0c1c1e-0000-4000-8000-00000000000c';
const L1 = '11111111-0000-4000-8000-000000000001';
const L2 = '11111111-0000-4000-8000-000000000002';

const cell = { style: 'align=center;verticalLabelPosition=middle;verticalAlign=middle;html=0;', label: 'x', width: 120, height: 60 };

/** "Dựng nháp từ sơ đồ cổng" (FR-048): lưới đơn giản, IMS không viết thuật toán bố cục. */
describe('buildDraftXml', () => {
  const devices = [
    { id: A, code: 'SW-01', cell },
    { id: B, code: 'SRV-01', cell },
    { id: C, code: 'AP-01', cell },
  ];
  const links = [
    { id: L1, deviceA: A, deviceB: B, cableTypeId: null, portA: 'Gi1', portB: 'eth0' },
    // Đầu kia không có trong phạm vi → không vẽ (không có ô để nối).
    { id: L2, deviceA: A, deviceB: '7b0c1c1e-0000-4000-8000-0000000000ff', cableTypeId: null, portA: 'Gi2', portB: null },
  ];

  it('một trang, mỗi máy một ô (lưới), mỗi kết nối trong phạm vi một nét đã gắn ims_link_id; qua cổng kiểm', () => {
    const xml = buildDraftXml(devices, links);
    expect(checkDiagramXml(xml, { xmlMaxKb: 2048, maxCells: 5000 }).reason).toBeNull();
    const index = buildCellIndex(xml);
    expect(index.cells.filter((c) => c.kind === 'device').map((c) => c.deviceId)).toEqual([A, B, C]);
    const edges = cableEdgeStates(index.cells, new Map(links.map((l) => [l.id, l])));
    expect(edges).toEqual([{ cellId: expect.any(String), linkId: L1, state: 'linked', sourceDeviceId: A, targetDeviceId: B }]);
    const xs = index.cells.filter((c) => c.kind === 'device').map((c) => `${c.bounds?.x},${c.bounds?.y}`);
    expect(new Set(xs).size).toBe(3);
  });

  it('không máy nào: bản vẽ trống vẫn hợp lệ', () => {
    expect(buildCellIndex(buildDraftXml([], [])).cells).toEqual([]);
  });
});
