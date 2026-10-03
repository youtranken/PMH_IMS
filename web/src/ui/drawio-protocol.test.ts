import { describe, expect, it } from 'vitest';
import {
  DRAWIO_SANDBOX,
  buildDrawioConfig,
  cssColorToDrawio,
  drawioUrl,
  exportedSvgText,
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
    ['getDiff mang xml', '{"event":"getDiff","xml":"<mxfile/>"}', { event: 'getDiff', xml: '<mxfile/>' }],
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
    ['getDiff', { action: 'getDiff' }, { action: 'getDiff' }],
    ['patch', { action: 'patch', patch: { u: {} } }, { action: 'patch', patch: { u: {} } }],
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
