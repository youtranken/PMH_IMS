import { buildCellIndex, type CellIndex } from './diagram-cells';
import { absoluteBounds, compareCellIndex, compareCounts } from './diagram-compare';

const DEV_A = '7b0c1c1e-0000-4000-8000-00000000000a';
const DEV_B = '7b0c1c1e-0000-4000-8000-00000000000b';
const LINK_1 = '7b0c1c1e-0000-4000-8000-0000000000f1';
const LINK_2 = '7b0c1c1e-0000-4000-8000-0000000000f2';
const CABLE_1 = '7b0c1c1e-0000-4000-8000-0000000000c1';
const CABLE_2 = '7b0c1c1e-0000-4000-8000-0000000000c2';

function page(body: string): CellIndex {
  return buildCellIndex(
    `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`,
  );
}

function device(id: string, deviceId: string, code: string, x = 0, y = 0, parent = '1'): string {
  return `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="${id}"><mxCell style="shape=mxgraph.cisco.switches.workgroup_switch;" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="100" height="40" as="geometry"/></mxCell></UserObject>`;
}

function shape(id: string, value: string, x = 0, style = 'rounded=1;', parent = '1', y = 0): string {
  return `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" width="80" height="40" as="geometry"/></mxCell>`;
}

function edge(id: string, source: string, target: string, ims: Record<string, string> = {}, style = 'edgeStyle=orthogonalEdgeStyle;'): string {
  const cell = `<mxCell style="${style}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  if (Object.keys(ims).length === 0) return cell.replace('<mxCell ', `<mxCell id="${id}" `);
  const attrs = Object.entries(ims)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
  return `<UserObject label="" ${attrs} id="${id}">${cell}</UserObject>`;
}

describe('compareCellIndex — so sánh tô màu hai phiên bản (bảng dữ liệu)', () => {
  const base = device('d1', DEV_A, 'SW-01') + device('d2', DEV_B, 'SW-02', 200) + shape('s1', 'Tầng 3', 400);

  const cases: {
    name: string;
    before: string;
    after: string;
    added: string[];
    removed: string[];
    changed: [string, string[]][];
  }[] = [
    { name: 'giống hệt: không tô gì', before: base, after: base, added: [], removed: [], changed: [] },
    {
      name: 'thêm một hình tự do: xanh',
      before: base,
      after: base + shape('s2', 'Ghi chú', 600),
      added: ['s2'],
      removed: [],
      changed: [],
    },
    {
      name: 'bỏ một thiết bị: đỏ (ô của bản cũ)',
      before: base,
      after: device('d1', DEV_A, 'SW-01') + shape('s1', 'Tầng 3', 400),
      added: [],
      removed: ['d2'],
      changed: [],
    },
    {
      name: 'dời một ô: vàng, lý do "vị trí"',
      before: base,
      after: device('d1', DEV_A, 'SW-01', 50) + device('d2', DEV_B, 'SW-02', 200) + shape('s1', 'Tầng 3', 400),
      added: [],
      removed: [],
      changed: [['d1', ['moved']]],
    },
    {
      name: 'đổi nhãn hình tự do: vàng, lý do "nhãn"',
      before: base,
      after: device('d1', DEV_A, 'SW-01') + device('d2', DEV_B, 'SW-02', 200) + shape('s1', 'Tầng 4', 400),
      added: [],
      removed: [],
      changed: [['s1', ['label']]],
    },
    {
      name: 'đổi màu/kiểu hình tự do: vàng, lý do "khác"',
      before: base,
      after: device('d1', DEV_A, 'SW-01') + device('d2', DEV_B, 'SW-02', 200) + shape('s1', 'Tầng 3', 400, 'rounded=0;'),
      added: [],
      removed: [],
      changed: [['s1', ['other']]],
    },
    {
      name: 'dây đổi đầu: vàng, lý do "kết nối"',
      before: base + edge('e1', 'd1', 'd2'),
      after: base + edge('e1', 'd1', 's1'),
      added: [],
      removed: [],
      changed: [['e1', ['link']]],
    },
    {
      name: 'dây gắn sang dòng sơ đồ cổng khác: lý do "kết nối"',
      before: base + edge('e1', 'd1', 'd2', { ims_link_id: LINK_1 }),
      after: base + edge('e1', 'd1', 'd2', { ims_link_id: LINK_2 }),
      added: [],
      removed: [],
      changed: [['e1', ['link']]],
    },
    {
      name: 'dây đổi loại dây: lý do "loại dây"',
      before: base + edge('e1', 'd1', 'd2', { ims_link_id: LINK_1, ims_cable_type_id: CABLE_1 }),
      after: base + edge('e1', 'd1', 'd2', { ims_link_id: LINK_1, ims_cable_type_id: CABLE_2 }),
      added: [],
      removed: [],
      changed: [['e1', ['cable']]],
    },
    {
      name: 'xoá ô thiết bị rồi chèn lại đúng máy đó (id ô mới): một ô ĐỔI, không bỏ + thêm',
      before: base,
      after: device('d9', DEV_A, 'SW-01', 30) + device('d2', DEV_B, 'SW-02', 200) + shape('s1', 'Tầng 3', 400),
      added: [],
      removed: [],
      changed: [['d9', ['replaced', 'moved']]],
    },
    {
      name: 'hình tự do thành ô thiết bị (cùng id): đổi loại = bỏ + thêm',
      before: base + shape('x1', 'SW-03', 700),
      after: base + device('x1', DEV_B, 'SW-03', 700).replace(DEV_B, '7b0c1c1e-0000-4000-8000-00000000000c'),
      added: ['x1'],
      removed: ['x1'],
      changed: [],
    },
  ];

  it.each(cases)('$name', ({ before, after, added, removed, changed }) => {
    const result = compareCellIndex(page(before), page(after));
    expect(result.added.map((c) => c.id)).toEqual(added);
    expect(result.removed.map((c) => c.id)).toEqual(removed);
    expect(result.changed.map((c) => [c.id, c.reasons])).toEqual(changed);
  });

  it('ô bỏ mang vị trí TUYỆT ĐỐI ở bản cũ (ô con của nhóm cộng toạ độ nhóm) để vẽ khung đứt', () => {
    const before = page(shape('g1', '', 100, 'group;', '1', 50) + shape('c1', 'Con', 10, 'rounded=1;', 'g1', 5));
    const after = page(shape('g1', '', 100, 'group;', '1', 50));
    const result = compareCellIndex(before, after);
    expect(result.removed).toEqual([{ id: 'c1', kind: 'shape', label: 'Con', bounds: { x: 110, y: 55, width: 80, height: 40 } }]);
  });

  it('dây bị bỏ không có khung (hình học tương đối) — vẫn được đếm', () => {
    const result = compareCellIndex(page(base + edge('e1', 'd1', 'd2')), page(base));
    expect(result.removed).toEqual([{ id: 'e1', kind: 'edge', label: 'e1', bounds: null }]);
  });

  it('mốc căn: ô có khung của bản MỚI, toạ độ tuyệt đối — trình xem lấy độ lệch ảnh SVG từ đây', () => {
    const result = compareCellIndex(page(base), page(base + edge('e1', 'd1', 'd2')));
    expect(result.anchors.map((a) => a.id)).toEqual(['d1', 'd2', 's1']);
    expect(result.anchors[1].bounds).toEqual({ x: 200, y: 0, width: 100, height: 40 });
  });

  it('bản cũ rỗng (so với "chưa có gì"): mọi ô là thêm', () => {
    const result = compareCellIndex(page(''), page(base));
    expect(result.added.map((c) => c.id)).toEqual(['d1', 'd2', 's1']);
  });

  it('bộ đếm', () => {
    const result = compareCellIndex(page(base + shape('s9', 'Bỏ', 900)), page(device('d1', DEV_A, 'SW-01', 5) + shape('s1', 'Tầng 3', 400) + shape('n1', 'Mới', 800)));
    expect(compareCounts(result)).toEqual({ added: 1, removed: 2, changed: 1 });
  });
});

describe('absoluteBounds', () => {
  it('cộng dồn qua nhiều tầng cha; ô cha không có khung (lớp) thì dừng', () => {
    const index = page(
      shape('g1', '', 100, 'group;', '1', 100) + shape('g2', '', 10, 'group;', 'g1', 20) + shape('c1', 'Con', 1, 'rounded=1;', 'g2', 2),
    );
    expect(absoluteBounds(index).get('c1')).toEqual({ x: 111, y: 122, width: 80, height: 40 });
    expect(absoluteBounds(index).get('g1')).toEqual({ x: 100, y: 100, width: 80, height: 40 });
  });
});
