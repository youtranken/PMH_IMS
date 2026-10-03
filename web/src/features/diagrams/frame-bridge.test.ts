import { describe, expect, it } from 'vitest';
import { bindFrameValue, cabinetFrameCells, frameCandidates, type CabinetFrameLayout } from './frame-bridge';

const CHILD = '7b0c1c1e-0000-4000-8000-0000000000d1';
const SUBNET = '7b0c1c1e-0000-4000-8000-0000000000e1';
const CAB = '7b0c1c1e-0000-4000-8000-0000000000c1';

function file(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

const bare = (id: string, value: string) =>
  `<mxCell id="${id}" value="${value}" style="rounded=0;" vertex="1" parent="1"><mxGeometry width="300" height="200" as="geometry"/></mxCell>`;
const wrapped = (id: string, label: string, attrs: string) =>
  `<UserObject label="${label}" ${attrs} id="${id}"><mxCell style="rounded=0;" vertex="1" parent="1"><mxGeometry width="300" height="200" as="geometry"/></mxCell></UserObject>`;
const device = (id: string) =>
  `<UserObject label="SW" ims_device_id="dev-1" ims_device_code="SW" id="${id}"><mxCell style="" vertex="1" parent="1"><mxGeometry width="60" height="40" as="geometry"/></mxCell></UserObject>`;
const edge = (id: string) => `<mxCell id="${id}" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>`;

describe('frameCandidates — hình gắn được làm khung (đọc từ XML trình vẽ)', () => {
  it.each([
    { name: 'hình trần', body: bare('s1', 'Tầng 3'), expected: [{ id: 's1', label: 'Tầng 3', childDiagramId: null, subnetId: null, cabinetId: null }] },
    {
      name: 'khung đã gắn',
      body: wrapped('f1', 'VLAN 10', `ims_subnet_id="${SUBNET}"`),
      expected: [{ id: 'f1', label: 'VLAN 10', childDiagramId: null, subnetId: SUBNET, cabinetId: null }],
    },
    { name: 'bỏ ô thiết bị, nét dây, ô gốc và lớp', body: device('d1') + edge('e1'), expected: [] },
    {
      name: 'nhãn HTML lấy chữ thuần; hình không chữ hiện bằng id',
      body: bare('s2', '&lt;b&gt;Phòng&lt;/b&gt; server') + bare('s3', ''),
      expected: [
        { id: 's2', label: 'Phòng server', childDiagramId: null, subnetId: null, cabinetId: null },
        { id: 's3', label: '', childDiagramId: null, subnetId: null, cabinetId: null },
      ],
    },
  ])('$name', ({ body, expected }) => {
    expect(frameCandidates(file(body)).map(({ attrs: _attrs, ...rest }) => rest)).toEqual(expected);
  });

  it('XML hỏng → rỗng, không ném', () => {
    expect(frameCandidates('<mxfile><')).toEqual([]);
  });
});

describe('bindFrameValue — giá trị mới của khung (lệnh patch)', () => {
  it('hình trần: bọc UserObject, giữ chữ làm nhãn', () => {
    const [frame] = frameCandidates(file(bare('s1', 'Tầng 3')));
    expect(bindFrameValue(frame, { ims_child_diagram_id: CHILD })).toBe(`<UserObject label="Tầng 3" ims_child_diagram_id="${CHILD}" id="s1"/>`);
  });

  it('khung đã có dữ liệu: giữ thuộc tính khác, đè thuộc tính gắn', () => {
    const [frame] = frameCandidates(file(wrapped('f1', 'Tủ', `ims_cabinet_id="${CAB}" tooltip="x"`)));
    expect(bindFrameValue(frame, { ims_child_diagram_id: CHILD })).toBe(
      `<UserObject label="Tủ" ims_cabinet_id="${CAB}" tooltip="x" ims_child_diagram_id="${CHILD}" id="f1"/>`,
    );
  });

  it('bỏ gắn (null) gỡ thuộc tính, không để giá trị rỗng', () => {
    const [frame] = frameCandidates(file(wrapped('f1', 'VLAN', `ims_subnet_id="${SUBNET}"`)));
    expect(bindFrameValue(frame, { ims_subnet_id: null })).toBe('<UserObject label="VLAN" id="f1"/>');
  });

  it('chữ có ký tự đặc biệt được thoát', () => {
    const [frame] = frameCandidates(file(bare('s1', 'A &amp; B &quot;C&quot;')));
    expect(bindFrameValue(frame, {})).toBe('<UserObject label="A &amp; B &quot;C&quot;" id="s1"/>');
  });
});

describe('cabinetFrameCells — khung tủ thành ô chèn', () => {
  const layout: CabinetFrameLayout = {
    uHeight: 12,
    frames: [
      { key: 'rack', label: 'Tủ R1', style: 'shape=rack;', attrs: { ims_cabinet_id: CAB }, x: 0, y: 0, width: 204, height: 220 },
      { key: 'unplaced', label: 'Tủ R1 · Chưa khai U', style: 'swimlane;', attrs: { ims_cabinet_id: CAB }, x: 244, y: 0, width: 160, height: 300 },
    ],
    devices: [
      { frame: 'unplaced', id: 'dev-1', code: 'SW-01', style: 'shape=sw;', label: 'SW-01\n10.0.0.1', x: 50, y: 38, width: 60, height: 40 },
      { frame: 'unplaced', id: 'dev-2', code: 'SW-02', style: 'shape=sw;', label: 'SW-02', x: 50, y: 156, width: 60, height: 40 },
    ],
  };
  let n = 0;
  const cells = cabinetFrameCells(layout, { parent: '1', previous: 'last', x: 500, y: 40, newId: () => `ims-${(n += 1)}` });

  it('khung nằm trên lớp, dời tới chỗ chèn, nối chuỗi `previous` để nằm trên hình cũ', () => {
    const [rack, column] = cells;
    expect(rack).toMatchObject({ id: 'ims-1', vertex: 1, parent: '1', previous: 'last', style: 'shape=rack;' });
    expect(rack.geometry).toBe('<mxGeometry x="500" y="40" width="204" height="220" as="geometry"/>');
    expect(rack.xmlValue).toBe(`<UserObject label="Tủ R1" ims_cabinet_id="${CAB}" id="ims-1"/>`);
    expect(column).toMatchObject({ parent: '1', previous: 'ims-1' });
    expect(column.geometry).toContain('x="744"');
  });

  it('máy là ô CON của khung chứa nó, toạ độ tương đối, mang đúng hợp đồng ims_device_id + ims_device_code', () => {
    const devices = cells.slice(2);
    expect(devices.map((c) => c.parent)).toEqual(['ims-2', 'ims-2']);
    expect(devices[0].previous).toBeUndefined();
    expect(devices[1].previous).toBe(devices[0].id);
    expect(devices[0].geometry).toBe('<mxGeometry x="50" y="38" width="60" height="40" as="geometry"/>');
    expect(devices[0].xmlValue).toBe(`<UserObject label="SW-01&#xa;10.0.0.1" ims_device_id="dev-1" ims_device_code="SW-01" id="${devices[0].id}"/>`);
  });
});
