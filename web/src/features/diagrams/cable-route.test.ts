import { describe, expect, it } from 'vitest';
import { cableRoutePatch, orthogonalStyle } from './cable-route';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'aaaaaaaa-0000-4000-8000-00000000000b';
const C = 'aaaaaaaa-0000-4000-8000-00000000000c';
const L1 = '11111111-0000-4000-8000-000000000001';
const L2 = '11111111-0000-4000-8000-000000000002';

function file(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

const dev = (id: string, deviceId: string, code: string, parent = '1') =>
  `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="${id}"><mxCell style="" vertex="1" parent="${parent}"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></UserObject>`;
const frame = (id: string) =>
  `<UserObject label="Tủ" ims_cabinet_id="cab" id="${id}"><mxCell style="childLayout=rack;container=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="204" height="600" as="geometry"/></mxCell></UserObject>`;
/** Nét đã khai; `s`/`t` rỗng = đầu thả nổi; có điểm uốn + ràng buộc cạnh ra như người vẽ để lại. */
const linked = (id: string, s: string, t: string, link = L1, style = 'rounded=0;exitX=1;exitY=0.5;exitDx=0;exitDy=0;endArrow=none;startArrow=none;') =>
  `<UserObject label="" ims_link_id="${link}" id="${id}"><mxCell style="${style}" edge="1" parent="1"${s ? ` source="${s}"` : ''}${t ? ` target="${t}"` : ''}><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="90" y="300"/></Array><mxPoint x="90" y="560" as="targetPoint"/></mxGeometry></mxCell></UserObject>`;
const free = (id: string, s: string) =>
  `<mxCell id="${id}" style="endArrow=none;" edge="1" parent="1" source="${s}"><mxGeometry relative="1" as="geometry"><mxPoint x="530" y="450" as="targetPoint"/></mxGeometry></mxCell>`;

const DEVICES = dev('a', A, 'SW-01') + dev('b', B, 'SRV-01') + dev('c', C, 'AP-01');
const LINKS = new Map([
  [L1, { a: A, b: B }],
  [L2, { a: A, b: C }],
]);

describe('orthogonalStyle — dây của kho là nét vuông góc (Q-23 05/10)', () => {
  it.each([
    ['nét thẳng không có edgeStyle → thêm', 'rounded=0;endArrow=none;', 'rounded=0;endArrow=none;edgeStyle=orthogonalEdgeStyle;'],
    ['kiểu khác → thay', 'edgeStyle=elbowEdgeStyle;elbow=vertical;endArrow=none;', 'elbow=vertical;endArrow=none;edgeStyle=orthogonalEdgeStyle;'],
    ['đã vuông góc → giữ nguyên', 'edgeStyle=orthogonalEdgeStyle;rounded=0;', 'edgeStyle=orthogonalEdgeStyle;rounded=0;'],
    ['style rỗng', '', 'edgeStyle=orthogonalEdgeStyle;'],
  ])('%s', (_name, style, expected) => {
    expect(orthogonalStyle(style)).toBe(expected);
  });
});

describe('cableRoutePatch — "Bẻ dây vuông góc" / "Tự đi lại dây"', () => {
  it('Bẻ dây vuông góc: chỉ đổi style dây của kho, giữ điểm uốn và đầu dây; nét tự do không đụng', () => {
    const xml = file(DEVICES + linked('e1', 'a', 'b') + free('f1', 'a') + linked('e2', 'a', 'c', L2, 'edgeStyle=orthogonalEdgeStyle;'));
    const result = cableRoutePatch(xml, 'p1', LINKS, 'orthogonal');
    expect(Object.keys(result.updates)).toEqual(['e1']);
    expect(result.updates.e1.style).toContain('edgeStyle=orthogonalEdgeStyle;');
    expect(result.updates.e1.style).toContain('exitX=1');
    expect(result.updates.e1.geometry).toBeUndefined();
    expect(result.updates.e1.source).toBeUndefined();
    expect(result).toMatchObject({ count: 1, reattached: 0, stuck: [] });
  });

  it('Tự đi lại dây (bản vẽ "PMH Tower"): đầu thả nổi nối lại về đúng máy, bỏ điểm uốn + ràng buộc cạnh ra', () => {
    const xml = file(DEVICES + linked('e1', 'a', '') + free('f1', 'b'));
    const result = cableRoutePatch(xml, 'p1', LINKS, 'reroute');
    expect(result.updates.e1).toEqual({
      style: 'rounded=0;endArrow=none;startArrow=none;edgeStyle=orthogonalEdgeStyle;',
      geometry: '<mxGeometry relative="1" as="geometry"/>',
      source: 'a',
      target: 'b',
    });
    expect(result).toMatchObject({ count: 1, reattached: 1, stuck: [] });
    expect(result.updates.f1).toBeUndefined();
  });

  it.each([
    ['đầu nguồn nằm sai máy, đầu đích đúng → giữ đích, sửa nguồn', linked('e1', 'c', 'b'), { source: 'a', target: 'b' }],
    ['nối ngược chiều đúng hai máy → không đổi đầu', linked('e1', 'b', 'a'), { source: 'b', target: 'a' }],
    ['cả hai đầu thả nổi → nối A → B', linked('e1', '', ''), { source: 'a', target: 'b' }],
    ['hai đầu cùng một máy → giữ một, đầu kia về máy còn lại', linked('e1', 'a', 'a'), { source: 'a', target: 'b' }],
  ])('%s', (_name, edgeXml, ends) => {
    const result = cableRoutePatch(file(DEVICES + edgeXml), 'p1', LINKS, 'reroute');
    expect(result.updates.e1).toMatchObject(ends);
  });

  it('máy của kết nối không có trên trang → không nối được, báo lại; vẫn đi lại đường', () => {
    const result = cableRoutePatch(file(dev('a', A, 'SW-01') + linked('e1', 'a', '')), 'p1', LINKS, 'reroute');
    expect(result.stuck).toEqual(['e1']);
    expect(result.updates.e1.source).toBeUndefined();
    expect(result.updates.e1.geometry).toBe('<mxGeometry relative="1" as="geometry"/>');
  });

  it('kết nối IMS không biết (đã gỡ) → chỉ đi lại đường, không đoán máy', () => {
    const result = cableRoutePatch(file(DEVICES + linked('e1', 'a', '', '99999999-0000-4000-8000-000000000009')), 'p1', LINKS, 'reroute');
    expect(result.updates.e1.target).toBeUndefined();
    expect(result.reattached).toBe(0);
  });

  it('máy có hai ô (mặt trước / mặt sau tủ): chọn ô cùng khung với đầu đang đúng', () => {
    const xml = file(frame('f1') + frame('f2') + dev('a1', A, 'SW-01', 'f1') + dev('a2', A, 'SW-01', 'f2') + dev('b1', B, 'SRV-01', 'f1') + dev('b2', B, 'SRV-01', 'f2') + linked('e1', 'a2', ''));
    expect(cableRoutePatch(xml, 'p1', LINKS, 'reroute').updates.e1).toMatchObject({ source: 'a2', target: 'b2' });
  });

  it('trang khác / XML hỏng → không có gì', () => {
    expect(cableRoutePatch(file(DEVICES + linked('e1', 'a', '')), 'p9', LINKS, 'reroute')).toEqual({ updates: {}, count: 0, reattached: 0, stuck: [] });
    expect(cableRoutePatch('<mxfile', 'p1', LINKS, 'reroute')).toEqual({ updates: {}, count: 0, reattached: 0, stuck: [] });
  });
});
