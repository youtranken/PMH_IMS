import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellIdsIn, linkEndTexts, portEndPatch, portEndRemoval } from './cable-ends';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'aaaaaaaa-0000-4000-8000-00000000000b';
const LINK = { deviceId: A, portLabel: 'Gi1/0/1', peerDeviceId: B, peerPort: 'Gi1/0/2' };
const SPEC = { style: 'edgeLabel;imsPortEnd=1;imsPaint=cable-2;html=0;fontSize=10;resizable=0;', offset: 0.75 };
const PALETTE = { 'cable-2': '1D5F9E' };

function file(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}
const edge = '<UserObject label="" ims_link_id="l1" id="e1"><mxCell style="" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject>';
const endCell = (id: string, value: string) =>
  `<mxCell id="${id}" value="${value}" style="edgeLabel;imsPortEnd=1;" vertex="1" connectable="0" parent="e1"><mxGeometry x="-0.75" relative="1" as="geometry"/></mxCell>`;

describe('linkEndTexts — cổng ở mỗi đầu nét (Q-23 06/10)', () => {
  it.each([
    ['nét đi từ máy giữ bản ghi (A)', A, { source: 'Gi1/0/1', target: 'Gi1/0/2' }],
    ['nét vẽ ngược (từ B)', B, { source: 'Gi1/0/2', target: 'Gi1/0/1' }],
    ['đầu nguồn không rõ → coi như từ A', null, { source: 'Gi1/0/1', target: 'Gi1/0/2' }],
  ])('%s', (_name, source, expected) => {
    expect(linkEndTexts(LINK, source)).toEqual(expected);
  });

  it('cổng đầu kia chưa ghi → "—"', () => {
    expect(linkEndTexts({ ...LINK, peerPort: null }, A)).toEqual({ source: 'Gi1/0/1', target: '—' });
  });
});

describe('portEndPatch — hai ô nhãn con của nét, ở -offset (đầu nguồn) và +offset (đầu đích)', () => {
  it('nét chưa có nhãn đầu → chèn hai ô, chữ tô màu loại dây (không khung)', () => {
    const patch = portEndPatch(file(edge), 'e1', { source: 'Gi1/0/1', target: 'Gi1/0/2' }, SPEC, PALETTE);
    expect(patch.u).toEqual({});
    expect(patch.i).toEqual([
      {
        id: 'e1-ims-ps',
        vertex: 1,
        connectable: 0,
        parent: 'e1',
        value: 'Gi1/0/1',
        style: 'edgeLabel;imsPortEnd=1;imsPaint=cable-2;html=0;fontSize=10;resizable=0;fontColor=#1D5F9E;',
        geometry: '<mxGeometry x="-0.75" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry>',
      },
      {
        id: 'e1-ims-pt',
        vertex: 1,
        connectable: 0,
        parent: 'e1',
        value: 'Gi1/0/2',
        style: 'edgeLabel;imsPortEnd=1;imsPaint=cable-2;html=0;fontSize=10;resizable=0;fontColor=#1D5F9E;',
        geometry: '<mxGeometry x="0.75" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry>',
      },
    ]);
  });

  it('nhãn đầu đã có (mở lại / khai lại) → sửa tại chỗ, không chèn trùng id', () => {
    const xml = file(edge + endCell('e1-ims-ps', 'cũ') + endCell('e1-ims-pt', 'cũ'));
    const patch = portEndPatch(xml, 'e1', { source: 'Te1/1', target: 'eth0' }, SPEC, PALETTE);
    expect(patch.i).toEqual([]);
    expect(Object.keys(patch.u)).toEqual(['e1-ims-ps', 'e1-ims-pt']);
    expect(patch.u['e1-ims-ps']).toMatchObject({ value: 'Te1/1' });
    expect(patch.u['e1-ims-pt'].geometry).toContain('x="0.75"');
  });
});

describe('portEndPatch trên tập id đã đọc sẵn — vòng lặp theo dây không parse lại XML', () => {
  afterEach(() => vi.restoreAllMocks());

  it('cùng kết quả như truyền XML; không parse thêm lần nào', () => {
    const xml = file(edge + endCell('e1-ims-ps', 'cũ'));
    const fromXml = portEndPatch(xml, 'e1', { source: 'Te1/1', target: 'eth0' }, SPEC, PALETTE);
    const present = cellIdsIn(xml);
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    expect(portEndPatch(present, 'e1', { source: 'Te1/1', target: 'eth0' }, SPEC, PALETTE)).toEqual(fromXml);
    expect(parse).not.toHaveBeenCalled();
  });

  it('cellIdsIn: id của mxCell trần và của phần tử bọc; XML hỏng → rỗng', () => {
    expect([...cellIdsIn(file(edge + endCell('e1-ims-ps', 'x')))].sort()).toEqual(['0', '1', 'e1', 'e1-ims-ps']);
    expect(cellIdsIn('<mxfile>').size).toBe(0);
  });
});

describe('portEndRemoval — nét thôi mang kết nối (bản sao, "Chỉ vẽ") thì bỏ nhãn đầu', () => {
  it('chỉ trả id ô đang có', () => {
    expect(portEndRemoval(file(edge + endCell('e1-ims-pt', 'x')), 'e1')).toEqual(['e1-ims-pt']);
    expect(portEndRemoval(file(edge), 'e1')).toEqual([]);
  });

  it('bản sao nhãn draw.io nhân bản theo nét (id mới) cũng bị gỡ; chữ tự do người vẽ gắn lên nét thì giữ', () => {
    const copy = endCell('k9', 'Gi1/0/1').replace('parent="e1"', 'parent="e1"');
    const own = '<mxCell id="t1" value="ghi chú" style="edgeLabel;" vertex="1" connectable="0" parent="e1"><mxGeometry relative="1" as="geometry"/></mxCell>';
    expect(portEndRemoval(file(edge + copy + own), 'e1')).toEqual(['k9']);
  });

  it('ô nằm trong phần tử lạ (không phải UserObject/object) giữ id của chính nó, không mượn id phần tử bọc', () => {
    const odd = `<Array as="extra" id="arr1">${endCell('e1-ims-ps', 'x')}</Array>`;
    expect(portEndRemoval(file(edge + odd), 'e1')).toEqual(['e1-ims-ps']);
  });
});
