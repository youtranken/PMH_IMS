import { buildCellIndex } from './diagram-cells';
import {
  RACK_DEFAULT_U,
  RACK_MARGIN,
  RACK_UNIT_PX,
  RACK_WIDTH,
  cabinetFrameLayout,
  childLinkReason,
  frameRefs,
  introducedRefs,
  type ChildCandidate,
} from './diagram-frames';

const CHILD = '7b0c1c1e-0000-4000-8000-0000000000d1';
const CHILD_2 = '7b0c1c1e-0000-4000-8000-0000000000d2';
const SUBNET = '7b0c1c1e-0000-4000-8000-0000000000e1';
const CAB = '7b0c1c1e-0000-4000-8000-0000000000c1';

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function frame(id: string, label: string, attrs: Record<string, string>, edge = false): string {
  const extra = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  const cell = edge
    ? `<mxCell style="" edge="1" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>`
    : `<mxCell style="rounded=0;container=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="300" height="200" as="geometry"/></mxCell>`;
  return `<UserObject label="${label}"${extra} id="${id}">${cell}</UserObject>`;
}

describe('frameRefs — khung mang dữ liệu (AD-18)', () => {
  it.each([
    { name: 'hình thường không là khung', body: '<mxCell id="s1" value="Tầng 3" style="rounded=0;" vertex="1" parent="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell>', expected: [] },
    {
      name: 'khung bản vẽ con',
      body: frame('f1', 'Tầng 3', { ims_child_diagram_id: CHILD }),
      expected: [{ cellId: 'f1', label: 'Tầng 3', childDiagramId: CHILD, subnetId: null, cabinetId: null }],
    },
    {
      name: 'khung VLAN',
      body: frame('f2', 'VLAN 10', { ims_subnet_id: SUBNET }),
      expected: [{ cellId: 'f2', label: 'VLAN 10', childDiagramId: null, subnetId: SUBNET, cabinetId: null }],
    },
    {
      name: 'khung tủ kèm bản vẽ con',
      body: frame('f3', 'Tủ R1', { ims_cabinet_id: CAB, ims_child_diagram_id: CHILD }),
      expected: [{ cellId: 'f3', label: 'Tủ R1', childDiagramId: CHILD, subnetId: null, cabinetId: CAB }],
    },
    { name: 'thuộc tính rỗng không tính', body: frame('f4', 'X', { ims_child_diagram_id: '' }), expected: [] },
    { name: 'nét dây mang thuộc tính khung bị bỏ qua', body: frame('e1', '', { ims_subnet_id: SUBNET }, true), expected: [] },
  ])('$name', ({ body, expected }) => {
    expect(frameRefs(buildCellIndex(page(body)))).toEqual(expected);
  });
});

describe('introducedRefs — chỉ id MỚI gắn mới bị kiểm lúc lưu', () => {
  const before = buildCellIndex(page(frame('f1', 'Tầng 3', { ims_child_diagram_id: CHILD }) + frame('f2', 'VLAN', { ims_subnet_id: SUBNET })));

  it.each([
    { name: 'bản đầu tiên: mọi id là mới', prev: null, body: frame('f1', 'A', { ims_child_diagram_id: CHILD }), expected: { childDiagramIds: [CHILD], subnetIds: [], cabinetIds: [] } },
    { name: 'giữ nguyên khung cũ: không gì mới', prev: before, body: frame('f1', 'A', { ims_child_diagram_id: CHILD }) + frame('f2', 'B', { ims_subnet_id: SUBNET }), expected: { childDiagramIds: [], subnetIds: [], cabinetIds: [] } },
    {
      name: 'khung cũ trỏ bản vẽ con đã lưu trữ vẫn lưu được — chỉ gắn MỚI mới bị kiểm',
      prev: before,
      body: frame('f9', 'Chép', { ims_child_diagram_id: CHILD }) + frame('f5', 'Mới', { ims_child_diagram_id: CHILD_2, ims_cabinet_id: CAB }),
      expected: { childDiagramIds: [CHILD_2], subnetIds: [], cabinetIds: [CAB] },
    },
    {
      name: 'hai khung cùng một id mới: một lần',
      prev: null,
      body: frame('a', 'A', { ims_subnet_id: SUBNET }) + frame('b', 'B', { ims_subnet_id: SUBNET }),
      expected: { childDiagramIds: [], subnetIds: [SUBNET], cabinetIds: [] },
    },
  ])('$name', ({ prev, body, expected }) => {
    expect(introducedRefs(prev, buildCellIndex(page(body)))).toEqual(expected);
  });
});

describe('childLinkReason — gắn bản vẽ con', () => {
  const ok: ChildCandidate = { id: CHILD, name: 'Tầng 3', archived: false, kind: 'official', inBranch: true };
  it.each([
    { name: 'bản vẽ con trong nhánh, còn sống → nhận', candidate: ok, expected: null },
    { name: 'không tồn tại', candidate: undefined, expected: /không tồn tại/ },
    { name: 'khác nhánh cây', candidate: { ...ok, inBranch: false }, expected: /nằm dưới bản vẽ này/ },
    { name: 'đã lưu trữ', candidate: { ...ok, archived: true }, expected: /đã lưu trữ/ },
    { name: 'bản trình bày', candidate: { ...ok, kind: 'presentation' as const }, expected: /bản trình bày/ },
  ])('$name', ({ candidate, expected }) => {
    const reason = childLinkReason(CHILD, candidate);
    if (expected === null) expect(reason).toBeNull();
    else expect(reason).toMatch(expected);
  });

  it('câu lý do nêu tên bản vẽ để người vẽ biết khung nào sai', () => {
    expect(childLinkReason(CHILD, { ...ok, archived: true })).toContain('Tầng 3');
  });
});

describe('cabinetFrameLayout — khung tủ dựng từ kho', () => {
  const cell = { style: 'shape=x;', label: 'L', width: 60, height: 40 };
  const dev = (id: string, code: string, u: number | null = null, uSize: number | null = null) => ({ id, code, u, uSize, cell });

  it('cao theo u_height, khung mang ims_cabinet_id, hình rack của draw.io', () => {
    const layout = cabinetFrameLayout({ cabinet: { id: CAB, code: 'R1', uHeight: 12 }, devices: [] });
    expect(layout.frames).toHaveLength(1);
    const rack = layout.frames[0];
    expect(rack.key).toBe('rack');
    expect(rack.attrs).toEqual({ ims_cabinet_id: CAB });
    expect(rack.style).toContain('shape=mxgraph.rackGeneral.rackCabinet3');
    expect(rack.style).toContain('container=1');
    expect(rack.style).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(rack.width).toBe(RACK_WIDTH);
    expect(rack.height).toBeCloseTo(RACK_MARGIN.top + RACK_MARGIN.bottom + 12 * RACK_UNIT_PX);
    expect(rack.label).toBe('Tủ R1');
  });

  it('tủ chưa khai số U thì dựng cỡ mặc định', () => {
    const layout = cabinetFrameLayout({ cabinet: { id: CAB, code: 'R1', uHeight: null }, devices: [] });
    expect(layout.uHeight).toBe(RACK_DEFAULT_U);
  });

  it('máy chưa khai U vào cột "Chưa khai U" bên cạnh (cũng mang ims_cabinet_id), xếp theo mã', () => {
    const layout = cabinetFrameLayout({ cabinet: { id: CAB, code: 'R1', uHeight: 12 }, devices: [dev('b', 'SW-02'), dev('a', 'SW-01')] });
    const column = layout.frames.find((f) => f.key === 'unplaced')!;
    expect(column.attrs).toEqual({ ims_cabinet_id: CAB });
    expect(column.label).toContain('Chưa khai U');
    expect(column.x).toBeGreaterThanOrEqual(RACK_WIDTH);
    expect(layout.devices.map((d) => [d.code, d.frame])).toEqual([
      ['SW-01', 'unplaced'],
      ['SW-02', 'unplaced'],
    ]);
    const [first, second] = layout.devices;
    expect(second.y).toBeGreaterThan(first.y + first.height);
    // Máy nằm gọn trong cột: cột lớn lên theo số máy.
    expect(column.height).toBeGreaterThanOrEqual(second.y + second.height);
    expect(column.width).toBeGreaterThanOrEqual(second.x + second.width);
  });

  it('máy có U xếp đúng U (U1 ở đáy tủ), rộng hết lòng tủ, cao theo số U chiếm', () => {
    const layout = cabinetFrameLayout({ cabinet: { id: CAB, code: 'R1', uHeight: 10 }, devices: [dev('a', 'SW-01', 1), dev('b', 'SRV-01', 5, 2)] });
    expect(layout.frames.map((f) => f.key)).toEqual(['rack']);
    const sw = layout.devices.find((d) => d.code === 'SW-01')!;
    const srv = layout.devices.find((d) => d.code === 'SRV-01')!;
    expect(sw.frame).toBe('rack');
    expect(sw.x).toBe(RACK_MARGIN.left);
    expect(sw.width).toBe(RACK_WIDTH - RACK_MARGIN.left - RACK_MARGIN.right);
    expect(sw.y).toBeCloseTo(RACK_MARGIN.top + 9 * RACK_UNIT_PX);
    expect(sw.height).toBeCloseTo(RACK_UNIT_PX);
    expect(srv.y).toBeCloseTo(RACK_MARGIN.top + 4 * RACK_UNIT_PX);
    expect(srv.height).toBeCloseTo(2 * RACK_UNIT_PX);
  });

  it('U vượt tủ hoặc trùng U máy khác → sang cột "Chưa khai U", không đè nhau', () => {
    const layout = cabinetFrameLayout({
      cabinet: { id: CAB, code: 'R1', uHeight: 10 },
      devices: [dev('a', 'A', 3), dev('b', 'B', 3), dev('c', 'C', 10, 2), dev('d', 'D', 0)],
    });
    expect(layout.devices.map((d) => [d.code, d.frame])).toEqual([
      ['A', 'rack'],
      ['B', 'unplaced'],
      ['C', 'unplaced'],
      ['D', 'unplaced'],
    ]);
  });
});
