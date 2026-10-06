import { buildCellIndex } from './diagram-cells';
import { checkDiagramXml } from './diagram-gate';
import { RACK_LABEL_STYLE } from './diagram-hydrate';
import {
  RACK_DEFAULT_U,
  RACK_MARGIN,
  RACK_UNIT_PX,
  RACK_WIDTH,
  buildRackXml,
  cabinetFrameLayout,
  childLinkReason,
  frameRefs,
  introducedRefs,
  unbindFrames,
  type ChildCandidate,
} from './diagram-frames';

const CHILD = '7b0c1c1e-0000-4000-8000-0000000000d1';
const CHILD_2 = '7b0c1c1e-0000-4000-8000-0000000000d2';
const SUBNET = '7b0c1c1e-0000-4000-8000-0000000000e1';
const CAB = '7b0c1c1e-0000-4000-8000-0000000000c1';
const DEV_1 = '7b0c1c1e-0000-4000-8000-0000000000a1';
const DEV_2 = '7b0c1c1e-0000-4000-8000-0000000000a2';

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

describe('unbindFrames — gỡ gắn khung (giữ hình, giữ chữ)', () => {
  const none = { childDiagramIds: [], subnetIds: [], cabinetIds: [] };
  const xml = page(
    frame('f1', 'Tầng 3', { ims_child_diagram_id: CHILD }) +
      frame('f2', 'Tầng 4', { ims_child_diagram_id: CHILD_2 }) +
      frame('v1', 'VLAN 10', { ims_subnet_id: SUBNET, ims_cabinet_id: CAB }),
  );

  it.each([
    ['không gỡ gì → XML y nguyên', none, [CHILD, CHILD_2, SUBNET, CAB], []],
    ['gỡ một bản vẽ con → khung kia giữ', { ...none, childDiagramIds: [CHILD] }, [CHILD_2, SUBNET, CAB], [CHILD]],
    ['gỡ dải, giữ tủ trên cùng khung', { ...none, subnetIds: [SUBNET] }, [CHILD, CHILD_2, CAB], [SUBNET]],
    ['gỡ tủ', { ...none, cabinetIds: [CAB] }, [CHILD, CHILD_2, SUBNET], [CAB]],
  ])('%s', (_name, drop, kept, gone) => {
    const out = unbindFrames(xml, drop);
    for (const id of kept) expect(out).toContain(id);
    for (const id of gone) expect(out).not.toContain(id);
    // Hình và chữ còn nguyên: chỉ mất thuộc tính gắn.
    const cells = buildCellIndex(out).cells;
    expect(cells.map((c) => [c.id, c.label])).toEqual([
      ['f1', 'Tầng 3'],
      ['f2', 'Tầng 4'],
      ['v1', 'VLAN 10'],
    ]);
    expect(checkDiagramXml(out, { xmlMaxKb: 1024, maxCells: 100 }).reason).toBeNull();
  });

  it('giá trị rác có thực thể XML (id như chỉ mục đọc ra) → vẫn gỡ được', () => {
    const junk = page(frame('f1', 'Rác', { ims_child_diagram_id: 'a&amp;b' }));
    const out = unbindFrames(junk, { ...none, childDiagramIds: ['a&b'] });
    expect(frameRefs(buildCellIndex(out))).toEqual([]);
  });

  it('id trùng nằm ở thuộc tính KHÁC (nhãn) thì không bị đụng', () => {
    const tricky = page(frame('f1', CHILD, { ims_child_diagram_id: CHILD }));
    const out = unbindFrames(tricky, { ...none, childDiagramIds: [CHILD] });
    expect(frameRefs(buildCellIndex(out))).toEqual([]);
    expect(buildCellIndex(out).cells[0].label).toBe(CHILD);
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
    // Hình rackCabinet3 của draw.io (mxRackRackCabinet3.sideText): `descend` đánh số từ ĐÁY lên (U1 ở
    // đáy, khớp cách xếp máy ở đây); `ascend` thì U1 ở đỉnh và mọi máy lệch số U.
    expect(rack.style).toContain('numDisp=descend');
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

/* Tủ mạng chỉ vẽ MẶT TRƯỚC (Q-23 06/10): một khung rack, máy xếp đúng U, ảnh thật mặt trước. */
describe('cabinetFrameLayout — chỉ mặt trước, ảnh thật', () => {
  const icon = { style: 'shape=icon;', label: 'L', width: 60, height: 40 };

  it('một khung rack mặt trước + cột "Chưa khai U", cùng mang ims_cabinet_id; máy có U chỉ MỘT ô', () => {
    const layout = cabinetFrameLayout({
      cabinet: { id: CAB, code: 'R1', uHeight: 10 },
      devices: [{ id: 'a', code: 'SW-01', u: 1, uSize: 1, cell: icon }, { id: 'b', code: 'PC-01', u: null, uSize: null, cell: icon }],
    });
    expect(layout.frames.map((f) => [f.key, f.label])).toEqual([
      ['rack', 'Tủ R1'],
      ['unplaced', 'Tủ R1 · Chưa khai U'],
    ]);
    const [front, column] = layout.frames;
    expect(front.attrs).toEqual({ ims_cabinet_id: CAB });
    expect(column.attrs).toEqual({ ims_cabinet_id: CAB });
    expect(column.x).toBeGreaterThanOrEqual(front.x + front.width);
    expect(layout.devices.map((d) => [d.code, d.frame])).toEqual([
      ['PC-01', 'unplaced'],
      ['SW-01', 'rack'],
    ]);
  });

  it('máy có ảnh mặt trước thì ô dùng ảnh và ghi ims_photo="front"; không có thì giữ biểu tượng', () => {
    const layout = cabinetFrameLayout({
      cabinet: { id: CAB, code: 'R1', uHeight: 10 },
      devices: [
        { id: 'a', code: 'SW-01', u: 2, uSize: 1, cell: icon, front: { style: 'shape=image;image=data:image/png,AAA;' } },
        { id: 'b', code: 'SW-02', u: 4, uSize: 1, cell: icon },
      ],
    });
    const [withPhoto, plain] = layout.devices;
    expect(withPhoto).toMatchObject({ frame: 'rack', style: `shape=image;image=data:image/png,AAA;${RACK_LABEL_STYLE}`, attrs: { ims_photo: 'front' } });
    expect(plain).toMatchObject({ frame: 'rack', style: `shape=icon;${RACK_LABEL_STYLE}`, attrs: {} });
  });

  it('buildRackXml ("Dựng lại mặt tủ"): XML một trang qua cổng kiểm, máy là ô con của đúng khung, không có mặt sau', () => {
    const layout = cabinetFrameLayout({
      cabinet: { id: CAB, code: 'R1', uHeight: 10 },
      devices: [
        { id: DEV_1, code: 'SW-01', u: 2, uSize: 1, cell: icon, front: { style: 'shape=image;image=data:image/png,AAA;' } },
        { id: DEV_2, code: 'PC-01', u: null, uSize: null, cell: icon },
      ],
    });
    const xml = buildRackXml(layout);
    expect(checkDiagramXml(xml, { xmlMaxKb: 2048, maxCells: 5000 }).reason).toBeNull();
    expect(xml).not.toContain('Mặt sau');
    const index = buildCellIndex(xml);
    const frameIds = new Map(index.cells.filter((c) => c.ims.ims_cabinet_id).map((c) => [c.label, c.id]));
    expect([...frameIds.keys()]).toEqual(['Tủ R1', 'Tủ R1 · Chưa khai U']);
    const devices = index.cells.filter((c) => c.kind === 'device');
    expect(devices.map((c) => [c.ims.ims_device_code, c.parent, c.ims.ims_photo ?? null])).toEqual([
      ['PC-01', frameIds.get('Tủ R1 · Chưa khai U'), null],
      ['SW-01', frameIds.get('Tủ R1'), 'front'],
    ]);
  });
});

/* Mặt tủ không đè U (Q-23 05/10): ô cao đúng số U, nhãn bên phải một dòng, hai mặt cách đủ chỗ cho nhãn. */
describe('cabinetFrameLayout — máy chiếm đúng số U, nhãn không đè U khác', () => {
  const photo = { style: 'align=center;shape=image;image=data:image/png,AAA;imageAspect=1;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;html=0;' };
  /** Ảnh ngang 4:1 — ô chèn tự do cao 120 cho rộng 480; trong tủ vẫn phải đúng 1U. */
  const tall = { style: photo.style, label: 'UPS-03\n172.16.110.5\nTower · TU-01 · U30', width: 480, height: 120 };

  it('máy 1U ở U30 tủ 42U: cao đúng 1U, nằm đúng U30 (U1 ở đáy) — tỉ lệ ảnh không đổi chiều cao', () => {
    const layout = cabinetFrameLayout(
      { cabinet: { id: CAB, code: 'TU-01', uHeight: 42 }, devices: [{ id: 'u', code: 'UPS-03', u: 30, uSize: 1, cell: tall, front: photo, rackLabel: 'UPS-03 · 172.16.110.5' }] },
    );
    expect(layout.devices).toHaveLength(1);
    const [front] = layout.devices;
    expect(front.height).toBeCloseTo(RACK_UNIT_PX);
    expect(front.y).toBeCloseTo(RACK_MARGIN.top + (42 - 30) * RACK_UNIT_PX);
    expect(front.label).toBe('UPS-03 · 172.16.110.5');
    expect(front.style.endsWith(RACK_LABEL_STYLE)).toBe(true);
    expect(front.style).not.toContain('verticalLabelPosition=bottom');
  });

  it('cột "Chưa khai U" cách mặt tủ đủ chỗ cho nhãn bên phải', () => {
    const icon = { style: 'shape=icon;', label: 'L', width: 60, height: 40 };
    const layout = cabinetFrameLayout({ cabinet: { id: CAB, code: 'TU-01', uHeight: 10 }, devices: [{ id: 'u', code: 'UPS-03', u: null, uSize: null, cell: icon }] });
    const [front, column] = layout.frames;
    expect(column.x - (front.x + front.width)).toBeGreaterThanOrEqual(160);
  });

  it('máy ở cột "Chưa khai U" giữ nhãn ba dòng dưới hình', () => {
    const layout = cabinetFrameLayout({ cabinet: { id: CAB, code: 'TU-01', uHeight: 10 }, devices: [{ id: 'u', code: 'UPS-03', u: null, uSize: null, cell: tall, rackLabel: 'một dòng' }] });
    expect(layout.devices[0]).toMatchObject({ frame: 'unplaced', label: tall.label, style: tall.style });
  });
});

describe('buildRackXml + bản trước — "Dựng lại mặt tủ" giữ id ô máy và dây', () => {
  const icon = { style: 'shape=icon;', label: 'L', width: 60, height: 40 };
  const layout = () =>
    cabinetFrameLayout(
      {
        cabinet: { id: CAB, code: 'R1', uHeight: 10 },
        devices: [
          { id: DEV_1, code: 'SW-01', u: 2, uSize: 1, cell: icon },
          { id: DEV_2, code: 'PC-01', u: 5, uSize: 2, cell: icon },
        ],
      },
    );
  const old =
    page(
      `<UserObject label="Tủ R1 · Mặt trước" ims_cabinet_id="${CAB}" id="fA"><mxCell style="childLayout=rack;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="204" height="191" as="geometry"/></mxCell></UserObject>` +
        `<UserObject label="Tủ R1 · Mặt sau" ims_cabinet_id="${CAB}" id="fB"><mxCell style="childLayout=rack;" vertex="1" parent="1"><mxGeometry x="300" y="0" width="204" height="191" as="geometry"/></mxCell></UserObject>` +
        `<UserObject label="SW-01" ims_device_id="${DEV_1}" ims_device_code="SW-01" id="swFront"><mxCell style="" vertex="1" parent="fA"><mxGeometry x="33" y="0" width="162" height="133" as="geometry"/></mxCell></UserObject>` +
        `<UserObject label="SW-01" ims_device_id="${DEV_1}" ims_device_code="SW-01" id="swBack"><mxCell style="" vertex="1" parent="fB"><mxGeometry x="33" y="0" width="162" height="133" as="geometry"/></mxCell></UserObject>` +
        `<UserObject label="PC-01" ims_device_id="${DEV_2}" ims_device_code="PC-01" id="pcLoose"><mxCell style="" vertex="1" parent="1"><mxGeometry x="700" y="0" width="60" height="40" as="geometry"/></mxCell></UserObject>` +
        `<UserObject label="X" ims_device_id="7b0c1c1e-0000-4000-8000-0000000000a9" ims_device_code="GONE-01" id="gone"><mxCell style="" vertex="1" parent="1"><mxGeometry x="900" y="0" width="60" height="40" as="geometry"/></mxCell></UserObject>` +
        `<UserObject label="" ims_link_id="L1" id="eKept"><mxCell style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="fA" source="swFront" target="pcLoose"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="5" y="5"/></Array></mxGeometry></mxCell></UserObject>` +
        `<mxCell id="eGone" style="" edge="1" parent="1" source="swFront" target="gone"><mxGeometry relative="1" as="geometry"/></mxCell>` +
        `<mxCell id="note" value="Ghi chú" style="text;" vertex="1" parent="1"><mxGeometry x="0" y="400" width="80" height="20" as="geometry"/></mxCell>`,
    );

  it('ô máy cũ giữ id; bản trước có khung mặt sau (dữ liệu cũ) thì giữ ô mặt TRƯỚC, khung mặt sau và ô của nó bỏ', () => {
    const index = buildCellIndex(buildRackXml(layout(), old));
    const devices = index.cells.filter((c) => c.kind === 'device').map((c) => [c.ims.ims_device_code, c.id]);
    expect(devices).toEqual([
      ['PC-01', 'pcLoose'],
      ['SW-01', 'swFront'],
    ]);
    expect(index.cells.some((c) => c.label.includes('Mặt sau'))).toBe(false);
    const ids = index.cells.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ô mặt sau đứng TRƯỚC ô mặt trước trong XML cũ: vẫn giữ id ô mặt trước', () => {
    const swapped = old.replace(
      /(<UserObject label="SW-01"[^>]*id="swFront">.*?<\/UserObject>)(<UserObject label="SW-01"[^>]*id="swBack">.*?<\/UserObject>)/,
      '$2$1',
    );
    expect(swapped.indexOf('swBack')).toBeLessThan(swapped.indexOf('swFront'));
    const index = buildCellIndex(buildRackXml(layout(), swapped));
    expect(index.cells.find((c) => c.kind === 'device' && c.ims.ims_device_code === 'SW-01')?.id).toBe('swFront');
  });

  it('dây giữa hai máy còn trên mặt tủ được giữ (kể cả dây đã khai), đi lại đường; dây tới máy không còn thì bỏ; hình tự do bỏ', () => {
    const xml = buildRackXml(layout(), old);
    expect(checkDiagramXml(xml, { xmlMaxKb: 2048, maxCells: 5000 }).reason).toBeNull();
    const index = buildCellIndex(xml);
    const kept = index.cells.find((c) => c.id === 'eKept')!;
    expect(kept).toMatchObject({ kind: 'edge', source: 'swFront', target: 'pcLoose', parent: '1', ims: { ims_link_id: 'L1' } });
    expect(xml).not.toContain('<mxPoint x="5" y="5"/>');
    expect(index.cells.some((c) => c.id === 'eGone' || c.id === 'note' || c.id === 'gone')).toBe(false);
  });

  it('không có bản trước: như cũ (id ims-f*/ims-d*)', () => {
    const index = buildCellIndex(buildRackXml(layout()));
    expect(index.cells.filter((c) => c.kind === 'device').every((c) => c.id.startsWith('ims-d'))).toBe(true);
  });
});
