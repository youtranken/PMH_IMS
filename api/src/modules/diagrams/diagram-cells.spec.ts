import {
  buildCellIndex,
  diffCellIndex,
  secretLabelReason,
  summarizeDiff,
  type CellDiff,
  type CellIndex,
} from './diagram-cells';

const DEV_A = '7b0c1c1e-0000-4000-8000-00000000000a';
const DEV_B = '7b0c1c1e-0000-4000-8000-00000000000b';

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function device(id: string, deviceId: string, code: string, x = 0): string {
  return `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="${id}"><mxCell style="shape=mxgraph.cisco.switches.workgroup_switch;" vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="100" height="40" as="geometry"/></mxCell></UserObject>`;
}

function shape(id: string, value: string, x = 0, style = 'rounded=1;'): string {
  return `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="0" width="80" height="40" as="geometry"/></mxCell>`;
}

function edge(id: string, source: string, target: string, extra = ''): string {
  return `<mxCell id="${id}" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry">${extra}</mxGeometry></mxCell>`;
}

const EMPTY: CellDiff = {
  devices: { added: [], removed: [], changed: [] },
  edges: { added: [], removed: [], changed: [] },
  shapes: { added: [], removed: [], changed: [] },
};

describe('buildCellIndex — chỉ mục ô của một phiên bản (AD-18)', () => {
  it('bản vẽ trống: không ô nào, một lớp', () => {
    const index = buildCellIndex(page(''));
    expect(index.cells).toEqual([]);
    expect(index.layers).toEqual(['1']);
  });

  it('phân loại thiết bị / dây / hình tự do; đọc ims_* của UserObject; bỏ ô gốc và lớp', () => {
    const index = buildCellIndex(
      page(device('d1', DEV_A, 'SW-01') + device('d2', DEV_B, 'SW-02', 200) + edge('e1', 'd1', 'd2') + shape('s1', 'Tầng 3')),
    );
    expect(index.cells.map((c) => [c.id, c.kind])).toEqual([
      ['d1', 'device'],
      ['d2', 'device'],
      ['e1', 'edge'],
      ['s1', 'shape'],
    ]);
    const d1 = index.cells[0];
    expect(d1.deviceId).toBe(DEV_A);
    expect(d1.ims).toEqual({ ims_device_id: DEV_A, ims_device_code: 'SW-01' });
    expect(d1.label).toBe('SW-01');
    expect(d1.layer).toBe('1');
    expect(d1.bounds).toEqual({ x: 0, y: 0, width: 100, height: 40 });
    expect(index.cells[2]).toMatchObject({ source: 'd1', target: 'd2' });
  });

  it('nhãn HTML thành chữ thuần (bỏ thẻ, giải mã thực thể)', () => {
    const index = buildCellIndex(page(shape('s1', '&lt;b&gt;Core&lt;/b&gt;&lt;br&gt;10.0.0.1 &amp;amp; WAN', 0, 'html=1;')));
    expect(index.cells[0].label).toBe('Core 10.0.0.1 & WAN');
  });

  it('ô trong nhóm vẫn thuộc lớp chứa nhóm', () => {
    const group = '<mxCell id="g1" value="" style="group" vertex="1" connectable="0" parent="1"><mxGeometry x="0" y="0" width="300" height="200" as="geometry"/></mxCell>';
    const inner = '<mxCell id="s2" value="x" style="" vertex="1" parent="g1"><mxGeometry x="1" y="1" width="2" height="2" as="geometry"/></mxCell>';
    const index = buildCellIndex(page(group + inner));
    expect(index.cells.find((c) => c.id === 's2')?.layer).toBe('1');
  });
});

describe('diffCellIndex + summarizeDiff — tóm tắt một dòng (hàm thuần dùng chung với so sánh/tự kiểm)', () => {
  const base = page(device('d1', DEV_A, 'SW-01') + device('d2', DEV_B, 'SW-02', 200) + edge('e1', 'd1', 'd2') + shape('s1', 'Tầng 3'));

  const cases: [string, string | null, string, string][] = [
    ['bản đầu tiên: mọi thứ là thêm', null, base, 'Thêm 2 thiết bị, thêm 1 dây, 1 hình tự do'],
    ['không đổi gì', base, base, 'Không đổi gì'],
    [
      'thêm một máy, bỏ một máy',
      base,
      page(device('d1', DEV_A, 'SW-01') + device('d3', DEV_B, 'SW-02', 200) + edge('e1', 'd1', 'd2') + shape('s1', 'Tầng 3')),
      'Thêm 1 thiết bị, bỏ 1 thiết bị',
    ],
    [
      'đổi dây (nối sang máy khác + thêm điểm uốn)',
      base,
      page(
        device('d1', DEV_A, 'SW-01') +
          device('d2', DEV_B, 'SW-02', 200) +
          edge('e1', 'd2', 'd1', '<Array as="points"><mxPoint x="50" y="90"/></Array>') +
          shape('s1', 'Tầng 3'),
      ),
      'Đổi 1 dây',
    ],
    [
      'kéo máy sang chỗ khác là đổi thiết bị; sửa chữ khung là hình tự do',
      base,
      page(device('d1', DEV_A, 'SW-01', 40) + device('d2', DEV_B, 'SW-02', 200) + edge('e1', 'd1', 'd2') + shape('s1', 'Tầng 4')),
      'Đổi 1 thiết bị, 1 hình tự do',
    ],
    [
      'bỏ dây, thêm hai hình',
      base,
      page(device('d1', DEV_A, 'SW-01') + device('d2', DEV_B, 'SW-02', 200) + shape('s1', 'Tầng 3') + shape('s2', 'ISP') + shape('s3', 'VLAN 10')),
      'Bỏ 1 dây, 2 hình tự do',
    ],
  ];

  it.each(cases)('%s', (_name, before, after, line) => {
    const prev: CellIndex | null = before === null ? null : buildCellIndex(before);
    const diff = diffCellIndex(prev, buildCellIndex(after));
    expect(summarizeDiff(diff)).toBe(line);
  });

  it('chi tiết nhóm theo loại, thiết bị đọc bằng mã kho', () => {
    const prev = buildCellIndex(base);
    const next = buildCellIndex(page(device('d1', DEV_A, 'SW-01') + edge('e1', 'd1', 'd2') + shape('s1', 'Tầng 3')));
    expect(diffCellIndex(prev, next)).toEqual({
      ...EMPTY,
      devices: { added: [], removed: [{ id: 'd2', label: 'SW-02' }], changed: [] },
    });
  });

  it('đổi một ô từ hình thường sang ô thiết bị: bỏ hình, thêm thiết bị', () => {
    const prev = buildCellIndex(page(shape('x1', 'SW-01')));
    const next = buildCellIndex(page(device('x1', DEV_A, 'SW-01')));
    const diff = diffCellIndex(prev, next);
    expect(diff.devices.added).toEqual([{ id: 'x1', label: 'SW-01' }]);
    expect(diff.shapes.removed).toEqual([{ id: 'x1', label: 'SW-01' }]);
  });
});

describe('secretLabelReason — chữ trên hình trông như mật khẩu', () => {
  it.each([
    ['nhãn thường', shape('s1', 'Core switch tầng 3'), null],
    ['mã model có gạch nối', shape('s1', 'WS-C2960X-48TS-L'), null],
    ['IP + VLAN', shape('s1', '10.0.0.1/24 VLAN 10'), null],
  ])('cho qua: %s', (_name, body, expected) => {
    expect(secretLabelReason(buildCellIndex(page(body)))).toBe(expected);
  });

  it('chặn nhãn mang mật khẩu, câu lỗi không nhắc lại chữ đó', () => {
    const reason = secretLabelReason(buildCellIndex(page(shape('s9', 'pass: Xk9#mQ2!vLp7'))));
    expect(reason).toMatch(/mật khẩu/);
    expect(reason).toContain('s9');
    expect(reason).not.toContain('Xk9#mQ2!vLp7');
  });
});
