import { buildCellIndex } from './diagram-cells';
import { cableEdgeStates, checkCables, externalLinks, undrawnLinks } from './diagram-checks';
import type { CheckLink } from './diagram-finding';

const DEV_A = '7b0c1c1e-0000-4000-8000-00000000000a';
const DEV_B = '7b0c1c1e-0000-4000-8000-00000000000b';
const DEV_C = '7b0c1c1e-0000-4000-8000-00000000000c';
const DEV_X = '7b0c1c1e-0000-4000-8000-0000000000ff';
const L1 = '11111111-0000-4000-8000-000000000001';
const L2 = '11111111-0000-4000-8000-000000000002';
const L3 = '11111111-0000-4000-8000-000000000003';

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function device(id: string, deviceId: string, code: string): string {
  return `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="${id}"><mxCell style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></UserObject>`;
}

function shape(id: string): string {
  return `<mxCell id="${id}" value="Mây ISP" style="ellipse;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>`;
}

function edge(id: string, source: string, target: string): string {
  return `<mxCell id="${id}" style="" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
}

function linked(id: string, source: string, target: string, linkId: string): string {
  return `<UserObject label="" ims_link_id="${linkId}" id="${id}"><mxCell style="" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject>`;
}

const DEVICES = device('a', DEV_A, 'SW-01') + device('b', DEV_B, 'SRV-01') + device('c', DEV_C, 'AP-01');

function link(id: string, deviceA: string, deviceB: string): CheckLink {
  return { id, deviceA, deviceB, cableTypeId: null, portA: 'Gi1', portB: 'eth0' };
}

const LINKS = new Map([
  [L1, link(L1, DEV_A, DEV_B)],
  [L2, link(L2, DEV_A, DEV_C)],
]);

function cells(body: string) {
  return buildCellIndex(page(DEVICES + body)).cells;
}

/**
 * Bộ luật dây (AD-18) — MỘT bản dùng chung cho hydrate, tự kiểm khi gửi duyệt/phát hành
 * và cảnh báo lệch kho.
 */
describe('checkCables — tự kiểm dây', () => {
  const cases: [string, string, Map<string, string | null> | undefined, [string, string, string | null][]][] = [
    ['dây đã khai đúng hai máy: không có gì', linked('e1', 'a', 'b', L1), undefined, []],
    ['dây khai ngược chiều vẫn đúng', linked('e1', 'b', 'a', L1), undefined, []],
    ['dây gắn link không còn trong sơ đồ cổng → đỏ', linked('e1', 'a', 'b', L3), undefined, [['error', 'CABLE_LINK_MISSING', 'e1']]],
    ['dây gắn link mà hai đầu link khác hai máy ở hai đầu dây → đỏ', linked('e1', 'a', 'c', L1), undefined, [['error', 'CABLE_LINK_ENDS_MISMATCH', 'e1']]],
    [
      'hai dây cùng một link → đỏ ở dây thứ hai',
      linked('e1', 'a', 'b', L1) + linked('e2', 'b', 'a', L1),
      undefined,
      [['error', 'CABLE_LINK_DUPLICATE', 'e2']],
    ],
    ['dây giữa hai máy kho chưa khai → vàng', edge('e1', 'a', 'b'), undefined, [['warning', 'CABLE_UNDECLARED', 'e1']]],
    ['dây nối hình tự do: không phải dây của kho', edge('e1', 'a', 's') + shape('s'), undefined, []],
    ['dây một đầu lơ lửng: không có gì', edge('e1', 'a', ''), undefined, []],
    ['dây nối một máy với chính nó: không có gì', edge('e1', 'a', 'a'), undefined, []],
    [
      'dây chạm máy đã thanh lý → vàng',
      linked('e1', 'a', 'b', L1),
      new Map([[DEV_B, 'retired']]),
      [['warning', 'CABLE_TO_RETIRED', 'e1']],
    ],
  ];
  it.each(cases)('%s', (_label, body, status, expected) => {
    const findings = checkCables(cells(body), LINKS, status);
    expect(findings.map((f) => [f.level, f.code, f.cellId])).toEqual(expected);
    for (const finding of findings) expect(finding.message).toMatch(/\S/);
  });

  it('câu báo nêu mã máy, không nêu uuid', () => {
    const [finding] = checkCables(cells(edge('e1', 'a', 'b')), LINKS);
    expect(finding.message).toContain('SW-01');
    expect(finding.message).toContain('SRV-01');
    expect(finding.message).not.toContain(DEV_A);
  });
});

describe('checkCables — câu báo dây lệch nói đủ hai máy của kết nối và cách sửa (Q-23 05/10)', () => {
  const NAMED = new Map([[L1, { ...link(L1, DEV_A, DEV_B), codeA: 'SW-01', codeB: 'SRV-01' }]]);
  /** Nét mang kết nối, chỉ nối một đầu (đầu kia người vẽ kéo ra chỗ trống). */
  const half = (id: string, source: string) =>
    `<UserObject label="" ims_link_id="${L1}" id="${id}"><mxCell style="" edge="1" parent="1" source="${source}"><mxGeometry relative="1" as="geometry"><mxPoint x="90" y="560" as="targetPoint"/></mxGeometry></mxCell></UserObject>`;
  const free = (id: string, source: string) =>
    `<mxCell id="${id}" style="endArrow=none;" edge="1" parent="1" source="${source}"><mxGeometry relative="1" as="geometry"><mxPoint x="530" y="450" as="targetPoint"/></mxGeometry></mxCell>`;
  const loose = (id: string) =>
    `<mxCell id="${id}" style="endArrow=none;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="90" y="557" as="sourcePoint"/><mxPoint x="530" y="560" as="targetPoint"/></mxGeometry></mxCell>`;

  it('bản vẽ "PMH Tower": dây đã khai một đầu thả nổi + vài nét tự do nối thêm → MỘT lỗi, ở nét mang kết nối; nét tự do (kể cả chạm máy) không lỗi', () => {
    const findings = checkCables(cells(half('e1', 'a') + loose('f1') + free('f2', 'b')), NAMED);
    expect(findings.map((f) => [f.level, f.code, f.cellId])).toEqual([['error', 'CABLE_LINK_ENDS_MISMATCH', 'e1']]);
    const message = findings[0].message;
    expect(message).toContain('SW-01 Gi1 ↔ SRV-01 eth0');
    expect(message).toContain('đầu thả nổi');
    expect(message).toContain('kéo đầu dây về đúng máy SRV-01');
    expect(message).toContain('Tự đi lại dây');
    expect(message).toContain('Chỉ xoá nét vẽ');
    expect(message).not.toContain('?');
  });

  it('hai đầu nối sai máy: nêu máy đang nối và hai máy đúng', () => {
    const [finding] = checkCables(cells(linked('e1', 'a', 'c', L1)), NAMED);
    expect(finding.message).toContain('SW-01 Gi1 ↔ SRV-01 eth0');
    expect(finding.message).toContain('đang nối SW-01 ↔ AP-01');
    expect(finding.message).toContain('kéo đầu dây về đúng máy SRV-01');
  });

  it('cả hai đầu thả nổi: bảo kéo về cả hai máy', () => {
    const both = `<UserObject label="" ims_link_id="${L1}" id="e1"><mxCell style="" edge="1" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject>`;
    const [finding] = checkCables(cells(both), NAMED);
    expect(finding.message).toContain('kéo đầu dây về đúng máy SW-01 và SRV-01');
  });

  it('dữ liệu cũ không có mã máy trong kết nối: vẫn nêu mã máy đọc từ bản vẽ, không lộ uuid', () => {
    const [finding] = checkCables(cells(half('e1', 'a')), LINKS);
    expect(finding.message).toContain('SW-01');
    expect(finding.message).toContain('SRV-01');
    expect(finding.message).not.toContain(DEV_B);
  });
});

describe('cableEdgeStates — trạng thái từng nét dây của kho (hydrate + trình xem)', () => {
  it('linked / removed / undeclared; nét nối hình tự do không có mặt', () => {
    const states = cableEdgeStates(
      cells(linked('e1', 'a', 'b', L1) + linked('e2', 'a', 'c', L3) + edge('e3', 'b', 'c') + edge('e4', 'a', 's') + shape('s')),
      LINKS,
    );
    expect(states.map((s) => [s.cellId, s.state, s.linkId])).toEqual([
      ['e1', 'linked', L1],
      ['e2', 'removed', L3],
      ['e3', 'undeclared', null],
    ]);
    expect(states[0]).toMatchObject({ sourceDeviceId: DEV_A, targetDeviceId: DEV_B });
  });
});

describe('undrawnLinks / externalLinks — kết nối chưa vẽ và kết nối ra ngoài bản vẽ', () => {
  const all = [link(L1, DEV_A, DEV_B), link(L2, DEV_A, DEV_C), link(L3, DEV_A, DEV_X)];

  it('kết nối giữa hai máy đều có trên bản vẽ mà chưa nét nào mang id → "chưa vẽ"', () => {
    expect(undrawnLinks(cells(linked('e1', 'a', 'b', L1)), all).map((l) => l.id)).toEqual([L2]);
    expect(undrawnLinks(cells(''), all).map((l) => l.id)).toEqual([L1, L2]);
  });

  it('kết nối có một đầu KHÔNG nằm trên bản vẽ → "ra ngoài"', () => {
    expect(externalLinks(cells(''), all).map((l) => l.id)).toEqual([L3]);
  });
});
