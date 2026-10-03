import { buildCellIndex } from './diagram-cells';
import {
  PRESENTATION_BAND,
  isPlannedCell,
  newerOfficialSeq,
  plannedNotAllowedReason,
  presentationBand,
  presentationName,
  type PresentationSource,
} from './diagram-presentation';

const DEV_A = '7b0c1c1e-0000-4000-8000-00000000000a';

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function planned(id: string, attrs: string): string {
  return `<UserObject label="AP mới" ${attrs} id="${id}"><mxCell style="rounded=1;dashed=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="40" as="geometry"/></mxCell></UserObject>`;
}

const device = `<UserObject label="SW-01" ims_device_id="${DEV_A}" ims_device_code="SW-01" id="d1"><mxCell style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="40" as="geometry"/></mxCell></UserObject>`;
const freeShape = `<mxCell id="s1" value="Tầng 1" style="rounded=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>`;

describe('isPlannedCell — thiết bị dự kiến chỉ sống trong bản trình bày (Q-23, AD-18)', () => {
  const cases: { name: string; body: string; planned: boolean }[] = [
    { name: 'ims_planned="1"', body: planned('p', 'ims_planned="1"'), planned: true },
    { name: 'ims_planned giá trị lạ vẫn tính là dự kiến (dữ liệu không tin cậy)', body: planned('p', 'ims_planned="yes"'), planned: true },
    { name: 'ims_planned rỗng vẫn tính', body: planned('p', 'ims_planned=""'), planned: true },
    { name: 'chỉ có thuộc tính phụ ims_planned_price', body: planned('p', 'ims_planned_price="12000000"'), planned: true },
    { name: 'máy kho thường', body: device, planned: false },
    { name: 'hình tự do', body: freeShape, planned: false },
  ];
  it.each(cases)('$name', ({ body, planned: expected }) => {
    const [cell] = buildCellIndex(page(body)).cells;
    expect(isPlannedCell(cell)).toBe(expected);
  });
});

describe('plannedNotAllowedReason — lưu XML có thiết bị dự kiến', () => {
  const withPlanned = buildCellIndex(page(device + planned('p1', 'ims_planned="1"')));
  const clean = buildCellIndex(page(device + freeShape));

  it('bản chính thức có ô dự kiến → câu từ chối nêu id ô', () => {
    const reason = plannedNotAllowedReason(withPlanned, 'official');
    expect(reason).toContain('p1');
    expect(reason).toMatch(/trình bày/);
  });
  it('bản trình bày có ô dự kiến → nhận', () => {
    expect(plannedNotAllowedReason(withPlanned, 'presentation')).toBeNull();
  });
  it('bản chính thức không có ô dự kiến → nhận', () => {
    expect(plannedNotAllowedReason(clean, 'official')).toBeNull();
  });
});

describe('newerOfficialSeq — "Bản gốc đã có phiên bản mới (N+k)"', () => {
  const base: PresentationSource = {
    diagramId: 'src',
    name: 'Tầng 1',
    versionId: 'v3',
    seq: 3,
    officialVersionId: 'v3',
    officialSeq: 3,
  };
  const cases: { name: string; source: PresentationSource | null; expected: number | null }[] = [
    { name: 'bản gốc vẫn chính thức đúng phiên bản đã chép → không báo', source: base, expected: null },
    { name: 'bản gốc phát hành phiên bản mới hơn → báo số mới', source: { ...base, officialVersionId: 'v5', officialSeq: 5 }, expected: 5 },
    { name: 'bản gốc lùi về phiên bản cũ hơn bằng khôi phục (số mới hơn) → báo', source: { ...base, officialVersionId: 'v6', officialSeq: 6 }, expected: 6 },
    { name: 'bản gốc mất cờ chính thức → không báo', source: { ...base, officialVersionId: null, officialSeq: null }, expected: null },
    { name: 'không có nguồn (bản chính thức) → không báo', source: null, expected: null },
    { name: 'nguồn đã bị dọn (seq null) → không báo', source: { ...base, versionId: null, seq: null }, expected: null },
  ];
  it.each(cases)('$name', ({ source, expected }) => {
    expect(newerOfficialSeq(source)).toBe(expected);
  });
});

describe('presentationBand — dải trên màn xem và file xuất', () => {
  it('nêu "BẢN TRÌNH BÀY" và phiên bản chính thức đã chép', () => {
    expect(presentationBand({ kind: 'presentation', source: { seq: 4 } })).toEqual({
      title: PRESENTATION_BAND,
      basedOn: 'Dựa trên bản chính thức phiên bản 4',
    });
    expect(PRESENTATION_BAND).toBe('BẢN TRÌNH BÀY — không phải sơ đồ chính thức');
  });
  it('nguồn không còn → chỉ dải, không dòng "dựa trên"', () => {
    expect(presentationBand({ kind: 'presentation', source: null })).toEqual({ title: PRESENTATION_BAND, basedOn: null });
  });
  it('bản chính thức → không dải', () => {
    expect(presentationBand({ kind: 'official', source: null })).toBeNull();
  });
});

describe('presentationName — tên mặc định không đụng tên đã có', () => {
  it('lần đầu: "<tên gốc> — trình bày"', () => {
    expect(presentationName('Tầng 1', 1)).toBe('Tầng 1 — trình bày');
  });
  it('lần sau thêm số', () => {
    expect(presentationName('Tầng 1', 3)).toBe('Tầng 1 — trình bày (3)');
  });
  it('tên gốc dài vẫn không vượt 120 ký tự', () => {
    const name = presentationName('X'.repeat(120), 12);
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith('— trình bày (12)')).toBe(true);
  });
});
