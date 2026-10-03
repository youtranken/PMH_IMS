import { describe, expect, it } from 'vitest';
import { bindEdgeValue, diffAutosave, edgeById, firstDeviceCell, pendingEdges, styleWithoutImsEdge, undeclaredEdges } from './cable-diff';

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'aaaaaaaa-0000-4000-8000-00000000000b';
const C = 'aaaaaaaa-0000-4000-8000-00000000000c';
const L1 = '11111111-0000-4000-8000-000000000001';

/** XML `autosave` của draw.io với `pages=0`: mô hình trần, không `<diagram>`. */
function model(body: string): string {
  return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel>`;
}

const dev = (id: string, deviceId: string, code: string) =>
  `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="${id}"><mxCell style="" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell></UserObject>`;
const shape = (id: string) => `<mxCell id="${id}" value="Mây" style="ellipse;" vertex="1" parent="1"><mxGeometry as="geometry"/></mxCell>`;
const edge = (id: string, s: string, t: string) =>
  `<mxCell id="${id}" value="" style="endArrow=none;" edge="1" parent="1"${s ? ` source="${s}"` : ''}${t ? ` target="${t}"` : ''}><mxGeometry relative="1" as="geometry"/></mxCell>`;
const linked = (id: string, s: string, t: string, link = L1) =>
  `<UserObject label="Gi1 ↔ eth0" ims_link_id="${link}" ims_cable_type_id="" id="${id}"><mxCell style="endArrow=none;imsPaint=cable-1;" edge="1" parent="1" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject>`;

const DEVICES = dev('a', A, 'SW-01') + dev('b', B, 'SRV-01') + dev('c', C, 'AP-01') + shape('s');

/**
 * Cầu nối so hai lần `autosave` liên tiếp (giao thức embed không báo "vừa nối dây" — AD-18):
 * chỉ cạnh MỚI nối hai máy kho khác nhau mà chưa có `ims_link_id` mới sinh câu hỏi "Khai";
 * cạnh mang link vừa biến mất sinh câu hỏi "Chỉ xoá nét vẽ / Gỡ luôn kết nối".
 */
describe('diffAutosave', () => {
  const cases: [string, string, string, { added: string[]; removed: string[]; strip: string[] }][] = [
    ['vẽ thêm một nét nối hai máy → hỏi khai', DEVICES, DEVICES + edge('e1', 'a', 'b'), { added: ['e1'], removed: [], strip: [] }],
    ['nét một đầu là hình tự do → không hỏi', DEVICES, DEVICES + edge('e1', 'a', 's'), { added: [], removed: [], strip: [] }],
    ['nét nối một máy với chính nó → không hỏi', DEVICES, DEVICES + edge('e1', 'a', 'a'), { added: [], removed: [], strip: [] }],
    ['nét lơ lửng (chưa gắn đầu) → không hỏi', DEVICES, DEVICES + edge('e1', 'a', ''), { added: [], removed: [], strip: [] }],
    [
      'kéo đầu nét từ hình tự do sang máy → hỏi',
      DEVICES + edge('e1', 'a', 's'),
      DEVICES + edge('e1', 'a', 'c'),
      { added: ['e1'], removed: [], strip: [] },
    ],
    [
      'kéo đầu nét chưa khai sang máy khác (đổi cặp máy) → hỏi lại',
      DEVICES + edge('e1', 'a', 'b'),
      DEVICES + edge('e1', 'a', 'c'),
      { added: ['e1'], removed: [], strip: [] },
    ],
    ['nét chưa khai giữ nguyên qua nhiều autosave → không hỏi lại', DEVICES + edge('e1', 'a', 'b'), DEVICES + edge('e1', 'a', 'b'), { added: [], removed: [], strip: [] }],
    [
      'kéo đầu nét ĐÃ khai sang máy khác → không hỏi (tự kiểm báo đỏ)',
      DEVICES + linked('e1', 'a', 'b'),
      DEVICES + linked('e1', 'a', 'c'),
      { added: [], removed: [], strip: [] },
    ],
    ['xoá nét đã khai → hỏi gỡ', DEVICES + linked('e1', 'a', 'b'), DEVICES, { added: [], removed: ['e1'], strip: [] }],
    ['xoá nét chưa khai → không hỏi gì', DEVICES + edge('e1', 'a', 'b'), DEVICES, { added: [], removed: [], strip: [] }],
    [
      'nhân bản nét đã khai → bản sao bỏ ims_link_id và coi là nét mới',
      DEVICES + linked('e1', 'a', 'b'),
      DEVICES + linked('e1', 'a', 'b') + linked('e2', 'a', 'b'),
      { added: ['e2'], removed: [], strip: ['e2'] },
    ],
    [
      'dán nét đã khai lơ lửng → chỉ bỏ ims_link_id, không hỏi',
      DEVICES + linked('e1', 'a', 'b'),
      DEVICES + linked('e1', 'a', 'b') + linked('e2', '', ''),
      { added: [], removed: [], strip: ['e2'] },
    ],
    ['hoàn tác một lần vẽ nét (nét chưa khai biến mất) → không hỏi gì', DEVICES + edge('e1', 'a', 'b'), DEVICES, { added: [], removed: [], strip: [] }],
    ['hoàn tác một lần xoá nét đã khai (nét trở lại) → không hỏi gì', DEVICES, DEVICES + linked('e1', 'a', 'b'), { added: [], removed: [], strip: [] }],
  ];

  it.each(cases)('%s', (_name, before, after, expected) => {
    const diff = diffAutosave(model(before), model(after));
    expect({
      added: diff.added.map((e) => e.id),
      removed: diff.removed.map((e) => e.id),
      strip: diff.strip,
    }).toEqual(expected);
  });

  it('nét mới mang id máy + mã hai đầu; nét xoá mang ims_link_id', () => {
    expect(diffAutosave(model(DEVICES), model(DEVICES + edge('e1', 'b', 'a'))).added[0]).toMatchObject({
      id: 'e1',
      sourceDeviceId: B,
      sourceCode: 'SRV-01',
      targetDeviceId: A,
      targetCode: 'SW-01',
    });
    expect(diffAutosave(model(DEVICES + linked('e1', 'a', 'b')), model(DEVICES)).removed).toEqual([{ id: 'e1', linkId: L1 }]);
  });

  it('XML hỏng hay rỗng ở lượt trước (lượt đầu) → so với bản trống, không ném', () => {
    expect(diffAutosave('', model(DEVICES + edge('e1', 'a', 'b'))).added.map((e) => e.id)).toEqual(['e1']);
    expect(diffAutosave('<not xml', model(DEVICES)).added).toEqual([]);
  });

  it('đọc được cả tệp đầy đủ (mxfile + diagram) lẫn mô hình trần', () => {
    const file = `<mxfile><diagram id="p1">${model(DEVICES + edge('e1', 'a', 'b'))}</diagram></mxfile>`;
    expect(diffAutosave(model(DEVICES), file).added.map((e) => e.id)).toEqual(['e1']);
  });
});

describe('undeclaredEdges — nút "Dây chưa khai"', () => {
  it('mọi nét nối hai máy kho khác nhau chưa có ims_link_id', () => {
    const xml = model(DEVICES + edge('e1', 'a', 'b') + linked('e2', 'a', 'c') + edge('e3', 'a', 's'));
    expect(undeclaredEdges(xml).map((e) => [e.id, e.sourceCode, e.targetCode])).toEqual([['e1', 'SW-01', 'SRV-01']]);
  });
});

describe('edgeById / firstDeviceCell / bindEdgeValue', () => {
  const xml = model(DEVICES + edge('e1', 'a', 'b') + linked('e2', 'a', 'c'));

  it('đọc style + thuộc tính hiện tại của một nét', () => {
    expect(edgeById(xml, 'e1')).toMatchObject({ id: 'e1', style: 'endArrow=none;', linkId: null });
    expect(edgeById(xml, 'e2')).toMatchObject({ linkId: L1, attrs: { label: 'Gi1 ↔ eth0', ims_link_id: L1, ims_cable_type_id: '' } });
    expect(edgeById(xml, 'zz')).toBeNull();
  });

  it('ô đầu tiên của một máy trên bản vẽ', () => {
    expect(firstDeviceCell(xml, B)).toBe('b');
    expect(firstDeviceCell(xml, 'không-có')).toBeNull();
  });

  it('giá trị ô khi gắn kết nối: UserObject giữ thuộc tính tự do, thay nhãn + ims_*; bỏ link khi nhân bản', () => {
    expect(bindEdgeValue('e1', { note: 'tạm' }, { label: 'Gi1 ↔ eth0', ims_link_id: L1, ims_cable_type_id: '' })).toBe(
      `<UserObject note="tạm" label="Gi1 ↔ eth0" ims_link_id="${L1}" ims_cable_type_id="" id="e1"/>`,
    );
    expect(bindEdgeValue('e2', { label: 'Gi1 ↔ eth0', ims_link_id: L1, ims_cable_type_id: 'x' }, { label: '' }, ['ims_link_id', 'ims_cable_type_id'])).toBe(
      '<UserObject label="" id="e2"/>',
    );
  });
});

describe('pendingEdges — danh sách "Dây chưa khai" tính lại từ XML ĐANG vẽ', () => {
  const L2 = '22222222-0000-4000-8000-000000000002';
  // Lúc mở, server báo e2 mang kết nối L1 đã gỡ (đỏ).
  const opened = [{ cellId: 'e2', linkId: L1, state: 'removed' as const }];

  it.each([
    ['nét chưa khai + nét đỏ còn mang kết nối cũ', model(DEVICES + edge('e1', 'a', 'b') + linked('e2', 'b', 'c')), ['e1', 'e2']],
    ['nét đỏ đã khai lại (ims_link_id mới) → ra khỏi danh sách', model(DEVICES + linked('e2', 'b', 'c', L2)), []],
    ['nét đỏ đã bị xoá khỏi bản vẽ', model(DEVICES), []],
    ['nét đỏ chỉ còn vẽ (bỏ ims_link_id) → là nét chưa khai, không lặp hai lần', model(DEVICES + edge('e2', 'b', 'c')), ['e2']],
  ])('%s', (_name, xml, ids) => {
    expect(pendingEdges(xml, opened).map((e) => e.id)).toEqual(ids);
  });

  it('nét đã khai đúng (linked) không bao giờ vào danh sách', () => {
    expect(pendingEdges(model(DEVICES + linked('e2', 'b', 'c')), [{ cellId: 'e2', linkId: L1, state: 'linked' }])).toEqual([]);
  });
});

describe('styleWithoutImsEdge', () => {
  it.each([
    ['endArrow=none;imsPaint=cable-2;strokeColor=#1D5F9E;fontColor=#1D5F9E;html=0;', 'endArrow=none;'],
    ['edgeStyle=orthogonalEdgeStyle;dashed=1;', 'edgeStyle=orthogonalEdgeStyle;'],
    ['imsPaint=warn;', ''],
  ])('%s → %s', (style, expected) => {
    expect(styleWithoutImsEdge(style)).toBe(expected);
  });
});
