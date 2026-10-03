import {
  cableLegend,
  composeExportSvg,
  exportBand,
  exportFileName,
  exportFooterLines,
  exportScale,
  exportWatermark,
  type ExportMeta,
} from './diagram-export';
import type { CellIndex } from './diagram-cells';

const TZ = 'Asia/Ho_Chi_Minh';

function meta(over: Partial<ExportMeta> = {}): ExportMeta {
  return {
    path: ['Công ty E2E', 'Lầu 3', 'Phòng máy chủ'],
    kind: 'official',
    seq: 7,
    versionLabel: 'Sau khi thay core',
    status: 'official',
    approvedAt: new Date('2026-09-30T03:15:00Z'),
    approvedBy: 'Trần Duyệt',
    drawnBy: 'Lê Vẽ',
    savedAt: new Date('2026-09-29T09:00:00Z'),
    exporter: { fullName: 'Nguyễn Xuất', email: 'xuat@pmh.com.vn' },
    exportedAt: new Date('2026-10-03T07:05:00Z'),
    timeZone: TZ,
    presentationBaseSeq: null,
    ...over,
  };
}

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300px" height="120px" viewBox="-0.5 -0.5 300 120" style="background-color: white;"><g data-cell-id="d1"><rect x="10" y="10" width="100" height="40"/></g></svg>';

describe('exportBand — dải trên đầu file xuất', () => {
  it.each([
    ['bản chính thức hiện hành: không dải', meta(), null],
    ['bản nháp: "BẢN NHÁP — chưa duyệt"', meta({ status: 'draft' }), { title: 'BẢN NHÁP — chưa duyệt', sub: null }],
    [
      'bản chính thức đã bị thay: nói rõ không còn hiệu lực',
      meta({ status: 'superseded', supersededBySeq: 9 }),
      { title: 'BẢN CŨ — không còn hiệu lực', sub: 'Bản chính thức hiện hành là phiên bản #9' },
    ],
    [
      'bản trình bày: dải trình bày + phiên bản gốc',
      meta({ kind: 'presentation', status: 'draft', presentationBaseSeq: 4 }),
      { title: 'BẢN TRÌNH BÀY — không phải sơ đồ chính thức', sub: 'Dựa trên bản chính thức phiên bản 4' },
    ],
    [
      'bản trình bày chưa biết bản gốc: chỉ dải trình bày',
      meta({ kind: 'presentation', status: 'draft' }),
      { title: 'BẢN TRÌNH BÀY — không phải sơ đồ chính thức', sub: null },
    ],
  ])('%s', (_name, input, expected) => {
    expect(exportBand(input)).toEqual(expected);
  });
});

describe('exportFooterLines — chân trang do server ghép (FR-044)', () => {
  it('bản chính thức: đường dẫn cây, phiên bản số + tên, trạng thái, ngày duyệt, người vẽ, người duyệt, giờ xuất', () => {
    expect(exportFooterLines(meta())).toEqual([
      'Công ty E2E / Lầu 3 / Phòng máy chủ',
      'Phiên bản #7 · Sau khi thay core · Chính thức · Duyệt 30/09/2026 10:15 bởi Trần Duyệt',
      'Người vẽ: Lê Vẽ (lưu 29/09/2026 16:00) · Xuất bởi Nguyễn Xuất <xuat@pmh.com.vn> lúc 03/10/2026 14:05',
    ]);
  });

  it('bản nháp: không có dòng duyệt, nói rõ "chưa duyệt"', () => {
    const lines = exportFooterLines(meta({ status: 'draft', approvedAt: null, approvedBy: null, versionLabel: null }));
    expect(lines[1]).toBe('Phiên bản #7 · Bản nháp — chưa duyệt');
  });
});

describe('exportWatermark', () => {
  it('"tên · email · giờ:phút" theo múi giờ ứng dụng', () => {
    expect(exportWatermark(meta())).toBe('Nguyễn Xuất · xuat@pmh.com.vn · 14:05');
  });
});

describe('composeExportSvg — ghép ảnh xem đã lưu với dải, chú giải, chân trang, watermark', () => {
  it('lồng nguyên SVG đã lưu, kích thước theo viewBox, thêm chân trang và watermark lặp', () => {
    const out = composeExportSvg(SVG, meta({ status: 'draft' }), []);
    expect(out.width).toBeGreaterThanOrEqual(300);
    expect(out.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(out.svg).toContain('data-cell-id="d1"');
    expect(out.svg).toContain('BẢN NHÁP — chưa duyệt');
    expect(out.svg).toContain('Phiên bản #7');
    // Watermark phủ toàn hình: nhiều hơn một lần.
    expect(out.svg.split('Nguyễn Xuất · xuat@pmh.com.vn · 14:05').length - 1).toBeGreaterThan(3);
    // SVG lồng giữ viewBox gốc, bỏ width/height kiểu "px" của draw.io.
    expect(out.svg).toMatch(/<svg x="\d+" y="\d+" width="300" height="120" viewBox="-0.5 -0.5 300 120"/);
  });

  it('chữ do người dùng đặt (tên bản vẽ, tên phiên bản) được thoát ký tự XML', () => {
    const out = composeExportSvg(SVG, meta({ path: ['A <b>&</b>'], versionLabel: 'x"<y>' }), []);
    expect(out.svg).toContain('A &lt;b&gt;&amp;&lt;/b&gt;');
    expect(out.svg).not.toContain('<b>');
    expect(out.svg).toContain('x"&lt;y&gt;');
  });

  it('chú giải màu dây khi có', () => {
    const out = composeExportSvg(SVG, meta(), [{ label: 'Cáp quang', color: '#1d5f9e' }]);
    expect(out.svg).toContain('Cáp quang');
    expect(out.svg).toContain('stroke="#1d5f9e"');
  });

  it('màu chú giải lạ (không phải #hex) bị bỏ — không chèn chuỗi tuỳ ý vào thuộc tính', () => {
    const out = composeExportSvg(SVG, meta(), [{ label: 'Lạ', color: 'red" onload="x' }]);
    expect(out.svg).not.toContain('onload');
  });

  it('SVG không có viewBox: lùi về width/height', () => {
    const out = composeExportSvg('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><g/></svg>', meta(), []);
    expect(out.svg).toMatch(/width="200" height="80" viewBox="0 0 200 80"/);
  });
});

describe('exportScale — trần điểm ảnh (`diagram.export_max_megapixels`)', () => {
  it.each([
    ['nhỏ: giữ độ nét mong muốn', 1000, 800, 40, 2, 2],
    ['vượt trần ở 2x: hạ độ nét cho vừa', 4000, 3000, 20, 2, Math.sqrt(20e6 / 12e6)],
    ['vượt trần cả ở 1x: từ chối', 8000, 6000, 20, 2, null],
  ])('%s', (_name, w, h, maxMp, preferred, expected) => {
    const result = exportScale(w, h, maxMp, preferred);
    if (expected === null) {
      expect(result.value).toBeNull();
      expect(result.reason).toMatch(/quá lớn/);
    } else {
      expect(result.value).toBeCloseTo(expected, 5);
      expect(result.reason).toBeNull();
    }
  });
});

describe('exportFileName', () => {
  it('tên bản vẽ + phiên bản + định dạng, bỏ ký tự cấm trong tên file', () => {
    expect(exportFileName(meta({ path: ['Gốc', 'Tủ A/B: lầu 3'] }), 'pdf')).toBe('Tủ A-B- lầu 3 - v7.pdf');
  });
});

describe('cableLegend — chú giải màu dây đọc từ ảnh xem đã lưu', () => {
  const CT_1 = '7b0c1c1e-0000-4000-8000-0000000000c1';
  const CT_2 = '7b0c1c1e-0000-4000-8000-0000000000c2';
  const index: CellIndex = {
    layers: ['1'],
    cells: [
      { id: 'e1', kind: 'edge', parent: '1', layer: '1', ims: { ims_link_id: 'l1', ims_cable_type_id: CT_1 }, label: '', fp: 'a' },
      { id: 'e2', kind: 'edge', parent: '1', layer: '1', ims: { ims_link_id: 'l2', ims_cable_type_id: CT_1 }, label: '', fp: 'b' },
      { id: 'e3', kind: 'edge', parent: '1', layer: '1', ims: { ims_link_id: 'l3', ims_cable_type_id: CT_2 }, label: '', fp: 'c' },
      { id: 'e4', kind: 'edge', parent: '1', layer: '1', ims: {}, label: '', fp: 'd' },
    ],
  };
  const svg =
    '<svg><g data-cell-id="e1"><g><path d="M0 0" fill="none" stroke="#1D5F9E"/></g></g>' +
    '<g data-cell-id="e2"><path stroke="#1d5f9e"/></g>' +
    '<g data-cell-id="e3"><path stroke="none"/></g><g data-cell-id="e4"><path stroke="#000000"/></g></svg>';

  it('một mục mỗi loại dây có tên và màu đọc được; dây chưa khai và loại không màu bị bỏ', () => {
    expect(
      cableLegend(
        index,
        svg,
        new Map([
          [CT_1, 'Cáp quang'],
          [CT_2, 'Cat6'],
        ]),
      ),
    ).toEqual([{ label: 'Cáp quang', color: '#1d5f9e' }]);
  });

  it('chưa biết tên loại dây nào: không chú giải', () => {
    expect(cableLegend(index, svg, new Map())).toEqual([]);
  });
});
