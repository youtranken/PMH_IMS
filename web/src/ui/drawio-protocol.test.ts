import { describe, expect, it } from 'vitest';
import {
  DRAWIO_SANDBOX,
  buildDrawioConfig,
  cssColorToDrawio,
  drawioUrl,
  exportedSvgText,
  paintImsStyle,
  paintImsXml,
  parseDrawioEvent,
  serializeDrawioCommand,
  watermarkText,
} from './drawio-protocol';

describe('drawioUrl — tham số nhúng (AD-17)', () => {
  it('màn sửa: đủ cờ nhúng/offline/tắt dịch vụ ngoài, tiếng Việt', () => {
    const url = new URL(drawioUrl('edit'), 'https://ims.local');
    expect(url.pathname).toBe('/drawio/');
    for (const [k, v] of [
      ['embed', '1'],
      ['proto', 'json'],
      ['offline', '1'],
      ['stealth', '1'],
      ['plugins', '0'],
      ['pages', '0'],
      ['configure', '1'],
      ['lang', 'vi'],
      ['gapi', '0'],
      ['od', '0'],
      ['db', '0'],
      ['gh', '0'],
      ['gl', '0'],
      ['tr', '0'],
    ]) {
      expect([k, url.searchParams.get(k)]).toEqual([k, v]);
    }
  });

  it('màn xem: tắt khung công cụ', () => {
    expect(new URL(drawioUrl('view'), 'https://ims.local').searchParams.get('chrome')).toBe('0');
  });

  it('sandbox chỉ allow-scripts — không same-origin, downloads, modals, popups, top-navigation', () => {
    expect(DRAWIO_SANDBOX).toBe('allow-scripts');
  });
});

describe('parseDrawioEvent — ô đang chọn (export định dạng json, Q-23 06/10)', () => {
  const message = (data: unknown) => JSON.stringify({ event: 'export', format: 'json', message: { action: 'export' }, scale: 1, data });

  it('chỉ giữ id, loại ô và thuộc tính ims_* cần cho thẻ — bỏ mọi thứ khác', () => {
    const event = parseDrawioEvent(
      message({
        version: '31.6.1',
        pages: [
          {
            id: 'p1',
            cells: [
              { id: 'd1', type: 'node', parent: '1', label: 'SW-01', metadata: { ims_device_id: 'dev-1', ims_device_code: 'SW-01', ghi_chu: 'mật khẩu' } },
              { id: 'e1', type: 'edge', source: 'd1', target: 'd2', metadata: { ims_link_id: 'link-1' } },
              { id: 't1', type: 'node' },
              { id: 7, type: 'node' },
              'rác',
            ],
          },
        ],
      }),
    );
    expect(event).toEqual({
      event: 'export',
      format: 'json',
      selection: [
        { id: 'd1', kind: 'node', deviceId: 'dev-1', code: 'SW-01' },
        { id: 'e1', kind: 'edge', linkId: 'link-1' },
        { id: 't1', kind: 'node' },
      ],
    });
  });

  it.each([
    ['không có trang', { version: 'x' }],
    ['data là chuỗi', 'data'],
    ['cells không phải mảng', { pages: [{ cells: 'x' }] }],
  ])('%s → chọn rỗng, không vỡ', (_name, data) => {
    expect(parseDrawioEvent(message(data))?.selection).toEqual([]);
  });

  it('thuộc tính ims_* không phải chuỗi bị bỏ', () => {
    const event = parseDrawioEvent(message({ pages: [{ cells: [{ id: 'd1', type: 'node', metadata: { ims_device_id: { x: 1 } } }] }] }));
    expect(event?.selection).toEqual([{ id: 'd1', kind: 'node' }]);
  });
});

describe('parseDrawioEvent — chỉ nhận đúng hình dạng giao thức', () => {
  const ok: [string, unknown, Record<string, unknown>][] = [
    ['init', '{"event":"init"}', { event: 'init' }],
    ['configure', '{"event":"configure"}', { event: 'configure' }],
    ['load', '{"event":"load","currentPage":0}', { event: 'load', currentPage: 0 }],
    ['autosave', '{"event":"autosave","xml":"<mxfile/>"}', { event: 'autosave', xml: '<mxfile/>' }],
    ['save', '{"event":"save","xml":"<mxfile/>","exit":false}', { event: 'save', xml: '<mxfile/>', exit: false }],
    ['export', '{"event":"export","format":"xmlsvg","data":"data:image/svg+xml;base64,AA","xml":"<mxfile/>"}', { event: 'export', format: 'xmlsvg', data: 'data:image/svg+xml;base64,AA', xml: '<mxfile/>' }],
    ['exit', '{"event":"exit","modified":true}', { event: 'exit', modified: true }],
    ['openLink', '{"event":"openLink","href":"https://ims.local/devices/1"}', { event: 'openLink', href: 'https://ims.local/devices/1' }],
    // Xuất định dạng `xml` trả cả tệp (có `<diagram id>`) ở `xml`, không có `data`.
    ['export xml mang xml', '{"event":"export","format":"xml","xml":"<mxfile/>"}', { event: 'export', format: 'xml', xml: '<mxfile/>' }],
    // Bản vẽ trống: draw.io trả `load` với `xml: null` — vẫn là tin `load` (màn mới biết trình vẽ đã nạp).
    ['load của bản vẽ trống (xml null)', '{"event":"load","xml":null,"currentPage":0}', { event: 'load', currentPage: 0 }],
    [
      'giữ khung hình + trang',
      '{"event":"autosave","xml":"<x/>","currentPage":1,"modelBounds":{"x":1,"y":2,"width":3,"height":4}}',
      { event: 'autosave', xml: '<x/>', currentPage: 1, modelBounds: { x: 1, y: 2, width: 3, height: 4 } },
    ],
  ];
  it.each(ok)('nhận %s', (_name, data, expected) => {
    expect(parseDrawioEvent(data)).toEqual(expected);
  });

  const bad: [string, unknown][] = [
    ['không phải chuỗi', { event: 'init' }],
    ['JSON hỏng', '{event'],
    ['mảng', '["init"]'],
    ['thiếu event', '{"xml":"<x/>"}'],
    ['event lạ', '{"event":"eval","code":"alert(1)"}'],
    ['autosave thiếu xml', '{"event":"autosave"}'],
    ['autosave xml null', '{"event":"autosave","xml":null}'],
    ['save xml sai kiểu', '{"event":"save","xml":42}'],
    ['export thiếu data', '{"event":"export","format":"svg"}'],
    ['export xml thiếu xml', '{"event":"export","format":"xml"}'],
    ['getDiff (không dùng: một trang thì draw.io trả mô hình trần, mất id trang)', '{"event":"getDiff","xml":"<mxGraphModel/>"}'],
    ['openLink thiếu href', '{"event":"openLink"}'],
    ['modelBounds sai hình', '{"event":"load","modelBounds":{"x":"1"}}'],
  ];
  it.each(bad)('bỏ qua %s', (_name, data) => {
    expect(parseDrawioEvent(data)).toBeNull();
  });

  it('thuộc tính lạ không đi qua cầu nối', () => {
    expect(parseDrawioEvent('{"event":"init","__proto__":{"x":1},"foo":"bar"}')).toEqual({ event: 'init' });
  });
});

describe('serializeDrawioCommand — lệnh có kiểu → tin draw.io', () => {
  const cases: [string, Parameters<typeof serializeDrawioCommand>[0], Record<string, unknown>][] = [
    ['load', { action: 'load', xml: '<mxfile/>', autosave: true, title: 'E2E' }, { action: 'load', xml: '<mxfile/>', autosave: 1, title: 'E2E' }],
    ['load không autosave', { action: 'load', xml: '<mxfile/>' }, { action: 'load', xml: '<mxfile/>', autosave: 0 }],
    ['merge', { action: 'merge', xml: '<mxfile/>' }, { action: 'merge', xml: '<mxfile/>' }],
    ['export', { action: 'export', format: 'xmlsvg' }, { action: 'export', format: 'xmlsvg' }],
    ['configure', { action: 'configure', config: { compressXml: false } }, { action: 'configure', config: { compressXml: false } }],
    ['save', { action: 'save' }, { action: 'invokeAction', actionName: 'save' }],
    ['export xml', { action: 'export', format: 'xml' }, { action: 'export', format: 'xml' }],
    ['patch', { action: 'patch', patch: { u: {} } }, { action: 'patch', patch: { u: {} } }],
    // Hỏi ô đang chọn bằng `export` json sẵn có của draw.io — không plugin (Q-23).
    ['selectionQuery', { action: 'selectionQuery' }, { action: 'export', format: 'json', selection: 1, allPages: 0, includeData: 0 }],
  ];
  it.each(cases)('%s', (_name, command, expected) => {
    expect(JSON.parse(serializeDrawioCommand(command))).toEqual(expected);
  });
});

describe('cssColorToDrawio — màu token lúc chạy → mã draw.io (không #)', () => {
  it.each([
    ['#0e9f6e', '0E9F6E'],
    [' #ABC ', 'AABBCC'],
    ['rgb(14, 159, 110)', '0E9F6E'],
    ['rgba(255,0,0,0.5)', 'FF0000'],
    ['', null],
    ['var(--x)', null],
    ['url(x)', null],
  ])('%s → %s', (input, expected) => {
    expect(cssColorToDrawio(input)).toBe(expected);
  });
});

describe('buildDrawioConfig — cấu hình đẩy qua sự kiện configure', () => {
  it('không nén XML, tắt thư viện tự thêm/URL xuất, bảng màu dây từ token', () => {
    const config = buildDrawioConfig(['#0e9f6e', 'rgb(192, 57, 43)', '', 'không phải màu']);
    expect(config).toMatchObject({
      compressXml: false,
      enableCustomLibraries: false,
      enableExportUrl: false,
      suppressNewWindows: true,
      presetColors: ['0E9F6E', 'C0392B'],
    });
    expect(JSON.stringify(config)).not.toMatch(/https?:/);
  });

  it('nét mới vẽ mặc định không có mũi tên (cáp mạng hai chiều), vẫn đi dây vuông góc', () => {
    expect(buildDrawioConfig([]).defaultEdgeStyle).toMatchObject({ edgeStyle: 'orthogonalEdgeStyle', endArrow: 'none', startArrow: 'none' });
  });

  it('thư viện hình mở sẵn: Chung, Mạng, Rack — đúng id của draw.io 31.6.1 ("network", không phải "networks")', () => {
    expect(buildDrawioConfig([]).defaultLibraries).toBe('general;network;rack');
    // Gửi cả qua URL: configure chỉ đổi giá trị mặc định, còn lựa chọn cũ trong cài đặt draw.io thì thắng nó.
    expect(new URL(drawioUrl('edit'), 'https://ims.local').searchParams.get('libs')).toBe('general;network;rack');
  });
});

describe('watermarkText', () => {
  it('tên · email · giờ phút theo giờ VN', () => {
    expect(watermarkText({ fullName: 'Nguyễn Văn A', email: 'a@pmh.com.vn' }, new Date('2026-10-03T02:05:00Z'))).toBe(
      'Nguyễn Văn A · a@pmh.com.vn · 09:05',
    );
  });
});

describe('exportedSvgText — dữ liệu sự kiện export → chữ SVG gửi server', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Tầng 3 · Core</text></svg>';
  const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

  it.each([
    ['data URI base64 (có chữ có dấu)', `data:image/svg+xml;base64,${b64(svg)}`, svg],
    ['data URI mã hoá URL', `data:image/svg+xml,${encodeURIComponent(svg)}`, svg],
    ['chữ SVG trần', svg, svg],
    [
      'bỏ khai báo XML và DOCTYPE SVG chuẩn mà draw.io gắn đầu tệp',
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n${svg}`,
      svg,
    ],
  ])('%s', (_name, data, expected) => {
    expect(exportedSvgText(data)).toEqual({ value: expected, reason: null });
  });

  it.each([
    ['ảnh PNG thay vì SVG', 'data:image/png;base64,iVBORw0KGgo='],
    ['base64 hỏng', 'data:image/svg+xml;base64,@@@'],
    ['rỗng', ''],
  ])('từ chối: %s', (_name, data) => {
    const result = exportedSvgText(data);
    expect(result.value).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it('DOCTYPE có khai báo thực thể KHÔNG bị bỏ — để cổng server từ chối', () => {
    const evil = `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>${svg}`;
    expect(exportedSvgText(evil).value).toContain('<!DOCTYPE');
  });
});

/**
 * Màu dây của kho (AD-18): server chỉ ghi ô màu `imsPaint=cable-<n>|warn|danger`, web đổi thành
 * `strokeColor` đọc từ token theo theme hiện tại lúc nạp trình vẽ — mã nguồn không chứa mã màu.
 */
describe('paintImsStyle / paintImsXml — ô màu IMS → strokeColor theo token', () => {
  const palette = { 'cable-0': '5F665F', 'cable-2': '1D5F9E', warn: 'D97706', danger: 'C0392B' };

  it.each([
    ['ô màu loại dây', 'edgeStyle=orthogonalEdgeStyle;imsPaint=cable-2;html=0;', 'edgeStyle=orthogonalEdgeStyle;imsPaint=cable-2;html=0;endArrow=none;startArrow=none;strokeColor=#1D5F9E;fontColor=#1D5F9E;'],
    ['màu cũ trong style bị thay, không cộng dồn', 'imsPaint=warn;strokeColor=#000000;fontColor=#111111;dashed=1;', 'imsPaint=warn;dashed=1;endArrow=none;startArrow=none;strokeColor=#D97706;fontColor=#D97706;'],
    // Cáp mạng hai chiều: mũi tên (mặc định "Mũi tên liên kết" của draw.io) bị đọc thành chiều dữ liệu.
    ['dây có mũi tên → bỏ cả hai đầu', 'endArrow=classic;startArrow=classic;rounded=0;imsPaint=cable-0;', 'rounded=0;imsPaint=cable-0;endArrow=none;startArrow=none;strokeColor=#5F665F;fontColor=#5F665F;'],
    ['không có ô màu IMS → giữ nguyên', 'rounded=1;strokeColor=#000000;', 'rounded=1;strokeColor=#000000;'],
    ['ô màu lạ (không có trong bảng) → giữ nguyên, không đoán', 'imsPaint=cable-9;', 'imsPaint=cable-9;'],
    // Nhãn đầu dây là ô chữ: chỉ tô chữ — tô `strokeColor` là vẽ khung quanh nhãn.
    ['nhãn đầu dây → chỉ màu chữ', 'edgeLabel;imsPortEnd=1;imsPaint=cable-2;html=0;fontColor=#000000;', 'edgeLabel;imsPortEnd=1;imsPaint=cable-2;html=0;fontColor=#1D5F9E;'],
  ])('%s', (_name, style, expected) => {
    expect(paintImsStyle(style, palette)).toBe(expected);
  });

  it('cả tệp: chỉ đụng thuộc tính style có ô màu IMS', () => {
    const xml = '<root><mxCell id="e1" style="imsPaint=danger;" edge="1"/><mxCell id="s1" style="fillColor=#fff;"/></root>';
    expect(paintImsXml(xml, palette)).toBe(
      '<root><mxCell id="e1" style="imsPaint=danger;endArrow=none;startArrow=none;strokeColor=#C0392B;fontColor=#C0392B;" edge="1"/><mxCell id="s1" style="fillColor=#fff;"/></root>',
    );
  });
});
