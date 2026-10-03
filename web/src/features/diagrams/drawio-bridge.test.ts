import { describe, expect, it } from 'vitest';
import {
  deviceCellJson,
  deviceShape,
  insertPatch,
  growBounds,
  lastChildId,
  layerIdOf,
  nextInsertPosition,
  pageIds,
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

  it('XML hỏng hoặc rỗng → không có trang nào, không ném', () => {
    expect(pageIds('<mxfile><diagram')).toEqual([]);
    expect(pageIds('')).toEqual([]);
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
