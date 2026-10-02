import { describe, expect, it } from 'vitest';
import {
  deviceCellJson,
  deviceIdFromLink,
  deviceShape,
  driftReasons,
  drawioUrl,
  insertPatch,
  isCompressed,
  growBounds,
  lastChildId,
  layerIdOf,
  nextInsertPosition,
  pageIds,
  parseDeviceRefs,
  parseDrawioMessage,
  withViewerMarks,
} from './drawio-bridge';

const DEV = {
  id: '11111111-2222-3333-4444-555555555555',
  code: 'SW-CORE-01',
  name: 'Switch lõi',
  deviceTypeName: 'Switch',
  ip: '10.0.0.2',
};

const fileWith = (cells: string, extraPage = '') =>
  `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram>${extraPage}</mxfile>`;

describe('drawioUrl', () => {
  it('chế độ sửa: nhúng JSON, tiếng Việt, tắt mọi dịch vụ ngoài, không nút thoát', () => {
    const url = new URL(drawioUrl('edit'), 'https://ims.local');
    expect(url.pathname).toBe('/drawio/');
    const p = url.searchParams;
    expect([p.get('embed'), p.get('proto'), p.get('lang'), p.get('stealth')]).toEqual(['1', 'json', 'vi', '1']);
    for (const service of ['gapi', 'od', 'db', 'gh', 'tr', 'gl', 'plugins']) expect(p.get(service)).toBe('0');
    expect(p.get('noExitBtn')).toBe('1');
    expect(p.get('chrome')).toBeNull();
  });

  it('chế độ xem: không khung sửa (chrome=0)', () => {
    expect(new URL(drawioUrl('view'), 'https://ims.local').searchParams.get('chrome')).toBe('0');
  });
});

describe('parseDrawioMessage', () => {
  it.each([
    ['{"event":"init"}', 'init'],
    ['{"event":"save","xml":"<mxfile/>"}', 'save'],
  ])('%s → event %s', (raw, event) => {
    expect(parseDrawioMessage(raw)?.event).toBe(event);
  });

  it.each([['không phải JSON'], ['{"action":"load"}'], ['[1,2]'], [42], [null], ['{"event":5}']])(
    'bỏ qua tin lạ: %s',
    (raw) => {
      expect(parseDrawioMessage(raw)).toBeNull();
    },
  );
});

describe('deviceShape — loại thiết bị → hình mạng có sẵn của draw.io', () => {
  it.each([
    ['Firewall', 'mxgraph.networks.firewall'],
    ['Router biên', 'mxgraph.networks.router'],
    ['Switch', 'mxgraph.networks.switch'],
    ['Server', 'mxgraph.networks.server'],
    ['Máy chủ ảo', 'mxgraph.networks.server'],
    ['Access Point', 'mxgraph.networks.wireless_hub'],
    ['Điểm phát WiFi', 'mxgraph.networks.wireless_hub'],
    ['NAS', 'mxgraph.networks.nas_filer'],
    ['UPS', 'mxgraph.networks.ups_small'],
    ['PC', 'mxgraph.networks.pc'],
    ['Laptop', 'mxgraph.networks.laptop'],
    ['Printer', 'mxgraph.networks.printer'],
    ['Camera', 'mxgraph.networks.security_camera'],
    ['Thiết bị khác', null],
    ['', null],
  ])('%s → %s', (typeName, shape) => {
    expect(deviceShape(typeName)).toBe(shape);
  });

  it('"Firewall" thắng "router" khi tên chứa cả hai — tường lửa là thứ người đọc cần nhận ra', () => {
    expect(deviceShape('Router/Firewall biên')).toBe('mxgraph.networks.firewall');
  });
});

describe('deviceCellJson + insertPatch', () => {
  it('hình mang mã + IP hai dòng và thuộc tính ims_* để tra lại kho', () => {
    const cell = deviceCellJson(DEV, { cellId: 'ims-a', parent: '1', x: 40, y: 60 });
    expect(cell).toMatchObject({ id: 'ims-a', vertex: 1, parent: '1' });
    expect(cell.style).toContain('shape=mxgraph.networks.switch');
    // Nhãn chữ thường (html=0): mã thiết bị có ký tự lạ cũng không thành HTML trong bản vẽ.
    expect(cell.style).toContain('html=0');
    expect(cell.geometry).toMatch(/^<mxGeometry x="40" y="60" width="\d+" height="\d+" as="geometry"\/>$/);
    const value = new DOMParser().parseFromString(cell.xmlValue, 'application/xml').documentElement;
    expect(value.nodeName).toBe('UserObject');
    expect(value.getAttribute('label')).toBe('SW-CORE-01\n10.0.0.2');
    expect(value.getAttribute('ims_device_id')).toBe(DEV.id);
    expect(value.getAttribute('ims_device_code')).toBe('SW-CORE-01');
    expect(value.getAttribute('ims_device_ip')).toBe('10.0.0.2');
  });

  it('ký tự đặc biệt trong mã được thoát — không phá được XML của bản vẽ', () => {
    const cell = deviceCellJson({ ...DEV, code: 'A"<b>&\'x', ip: null }, { cellId: 'c', parent: '1', x: 0, y: 0 });
    const value = new DOMParser().parseFromString(cell.xmlValue, 'application/xml').documentElement;
    expect(value.getAttribute('ims_device_code')).toBe('A"<b>&\'x');
    expect(value.getAttribute('label')).toBe('A"<b>&\'x');
    expect(value.getAttribute('ims_device_ip')).toBe('');
  });

  it('loại không có hình riêng → khối chữ nhật bo góc', () => {
    expect(deviceCellJson({ ...DEV, deviceTypeName: 'Thiết bị khác' }, { cellId: 'c', parent: '1', x: 0, y: 0 }).style).toContain(
      'rounded=1',
    );
  });

  it('previous chỉ có mặt khi biết ô đứng trước', () => {
    expect(deviceCellJson(DEV, { cellId: 'c', parent: '1', x: 0, y: 0 })).not.toHaveProperty('previous');
    expect(deviceCellJson(DEV, { cellId: 'c', parent: '1', previous: 'x9', x: 0, y: 0 }).previous).toBe('x9');
  });

  it('patch theo đúng khuôn draw.io: u → trang → cells → i', () => {
    const cell = deviceCellJson(DEV, { cellId: 'c', parent: '1', x: 0, y: 0 });
    expect(insertPatch('p1', cell)).toEqual({ u: { p1: { cells: { i: [cell] } } } });
  });
});

describe('đọc tệp draw.io', () => {
  const two = fileWith(
    '<UserObject label="a" ims_device_id="d1" ims_device_code="SW-1" ims_device_ip="10.0.0.1" id="c1"><mxCell vertex="1" parent="1"/></UserObject>' +
      '<object label="b" ims_device_id="d2" ims_device_code="FW-1" ims_device_ip="" id="c2"><mxCell vertex="1" parent="1"/></object>' +
      '<mxCell id="t" value="chữ tự do" vertex="1" parent="1"/>',
    '<diagram id="p2" name="Trang 2"><mxGraphModel><root><mxCell id="r"/><mxCell id="L" parent="r"/></root></mxGraphModel></diagram>',
  );

  it('pageIds theo thứ tự trang', () => {
    expect(pageIds(two)).toEqual(['p1', 'p2']);
  });

  it('layerIdOf: lớp đầu tiên của trang (con trực tiếp của gốc), kể cả khi id không phải "1"', () => {
    expect(layerIdOf(two, 'p1')).toBe('1');
    expect(layerIdOf(two, 'p2')).toBe('L');
    expect(layerIdOf(two, 'không-có')).toBeNull();
  });

  it('lastChildId: con cuối của lớp (để hình mới nằm trên cùng); lớp rỗng → null', () => {
    expect(lastChildId(two, 'p1', '1')).toBe('t');
    expect(lastChildId(two, 'p2', 'L')).toBeNull();
  });

  it('parseDeviceRefs lấy mọi hình mang ims_device_id, bỏ qua hình vẽ tự do', () => {
    expect(parseDeviceRefs(two)).toEqual([
      { cellId: 'c1', deviceId: 'd1', code: 'SW-1', ip: '10.0.0.1', pageId: 'p1' },
      { cellId: 'c2', deviceId: 'd2', code: 'FW-1', ip: '', pageId: 'p1' },
    ]);
  });

  it('XML hỏng hoặc rỗng → không có hình nào, không ném', () => {
    expect(parseDeviceRefs('<mxfile><diagram')).toEqual([]);
    expect(parseDeviceRefs('')).toEqual([]);
    expect(pageIds('')).toEqual([]);
  });

  it('isCompressed: trang nén (chuỗi base64 thay cho mxGraphModel) thì không đọc được', () => {
    expect(isCompressed(two)).toBe(false);
    expect(isCompressed('<mxfile><diagram id="p" name="x">7VhNj9owEP01OWaV</diagram></mxfile>')).toBe(true);
  });
});

describe('driftReasons — lệch kho so với lúc chèn (Q-23: cảnh báo, không ép sửa)', () => {
  const ref = { cellId: 'c', deviceId: 'd', code: 'SW-1', ip: '10.0.0.1', pageId: 'p1' };
  it.each([
    ['khớp', { code: 'SW-1', status: 'in_use', ips: ['10.0.0.1'] }, []],
    ['đã thanh lý', { code: 'SW-1', status: 'retired', ips: ['10.0.0.1'] }, ['retired']],
    ['đổi IP', { code: 'SW-1', status: 'in_use', ips: ['10.0.0.9'] }, ['ip_changed']],
    ['mất IP', { code: 'SW-1', status: 'in_use', ips: [] }, ['ip_changed']],
    ['đổi mã', { code: 'SW-01', status: 'spare', ips: ['10.0.0.1'] }, ['code_changed']],
    ['không còn trong kho', null, ['missing']],
  ])('%s', (_label, live, reasons) => {
    expect(driftReasons(ref, live)).toEqual(reasons);
  });

  it('lúc chèn chưa có IP thì máy có IP về sau KHÔNG tính là lệch', () => {
    expect(driftReasons({ ...ref, ip: '' }, { code: 'SW-1', status: 'in_use', ips: ['10.0.0.5'] })).toEqual([]);
  });
});

describe('withViewerMarks — chỉ sửa bản đem đi XEM, không đụng bản đã lưu', () => {
  const xml = fileWith(
    '<UserObject label="SW-1&#xa;10.0.0.1" link="javascript:alert(1)" ims_device_id="d1" ims_device_code="SW-1" id="c1"><mxCell vertex="1" parent="1"/></UserObject>' +
      '<UserObject label="FW-1" ims_device_id="d2" ims_device_code="FW-1" id="c2"><mxCell vertex="1" parent="1"/></UserObject>',
  );

  it('mỗi hình thiết bị có link /devices/<id> (bấm thì IMS mở thẻ), hình lệch kho có dấu ⚠ ở nhãn', () => {
    const out = withViewerMarks(xml, 'https://ims.local', new Set(['d2']));
    const doc = new DOMParser().parseFromString(out, 'application/xml');
    const c1 = doc.querySelector('[id="c1"]')!;
    const c2 = doc.querySelector('[id="c2"]')!;
    // Link người vẽ tự gắn (kể cả javascript:) bị thay: ở chế độ xem, bấm hình thiết bị chỉ mở thẻ.
    expect(c1.getAttribute('link')).toBe('https://ims.local/devices/d1');
    expect(c1.getAttribute('label')).toBe('SW-1\n10.0.0.1');
    expect(c2.getAttribute('label')).toBe('⚠ FW-1');
  });

  it('XML không đọc được → trả nguyên văn (draw.io tự báo lỗi tệp)', () => {
    expect(withViewerMarks('<mxfile', 'https://ims.local', new Set())).toBe('<mxfile');
  });
});

describe('deviceIdFromLink', () => {
  it.each([
    ['https://ims.local/devices/abc-123', 'https://ims.local', 'abc-123'],
    ['https://ims.local/devices/abc-123?x=1', 'https://ims.local', 'abc-123'],
    ['https://khac.example/devices/abc-123', 'https://ims.local', null],
    ['https://ims.local/software/abc', 'https://ims.local', null],
    ['javascript:alert(1)', 'https://ims.local', null],
    ['', 'https://ims.local', null],
  ])('%s → %s', (href, origin, id) => {
    expect(deviceIdFromLink(href, origin)).toBe(id);
  });
});

describe('nextInsertPosition + growBounds', () => {
  it('trang trống → góc trên trái', () => {
    expect(nextInsertPosition(null)).toEqual({ x: 40, y: 40 });
    expect(nextInsertPosition({ x: 0, y: 0, width: 0, height: 0 })).toEqual({ x: 40, y: 40 });
  });

  it('đã có hình → đặt bên phải khối hình hiện có, không đè lên', () => {
    expect(nextInsertPosition({ x: 100, y: 50, width: 300, height: 200 })).toEqual({ x: 440, y: 50 });
  });

  it('chèn liên tiếp: khối hình lớn dần nên hình sau đứng bên phải hình trước', () => {
    const first = { ...nextInsertPosition(null), width: 60, height: 60 };
    const bounds = growBounds(null, first);
    expect(bounds).toEqual({ x: 40, y: 40, width: 60, height: 60 });
    expect(nextInsertPosition(bounds)).toEqual({ x: 140, y: 40 });
    expect(growBounds(bounds, { x: 140, y: 30, width: 100, height: 30 })).toEqual({ x: 40, y: 30, width: 200, height: 70 });
  });
});
