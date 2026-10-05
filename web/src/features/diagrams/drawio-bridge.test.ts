import { describe, expect, it } from 'vitest';
import {
  deviceCellJson,
  deviceIdsInXml,
  insertPatch,
  growBounds,
  lastChildId,
  layerIdOf,
  nextInsertPosition,
  pageIds,
  placeCells,
} from './drawio-bridge';

/** Ô dựng sẵn do server trả (`GET /diagrams/device-info`) — style đã hydrate theo loại. */
const DEV = {
  id: '11111111-2222-3333-4444-555555555555',
  code: 'SW-CORE-01',
  cell: { style: 'align=center;shape=mxgraph.networks.switch;html=0;', label: 'SW-CORE-01\n10.0.0.2\nHQ · R1', width: 100, height: 30 },
};

const fileWith = (cells: string, extraPage = '') =>
  `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram>${extraPage}</mxfile>`;

describe('deviceCellJson + insertPatch', () => {
  it('ô UserObject mang đúng hợp đồng AD-18 (ims_device_id + ims_device_code), style + nhãn + cỡ của server', () => {
    const cell = deviceCellJson(DEV, { cellId: 'ims-a', parent: '1', x: 40, y: 60 });
    expect(cell).toMatchObject({ id: 'ims-a', vertex: 1, parent: '1', style: DEV.cell.style });
    expect(cell.geometry).toBe('<mxGeometry x="40" y="60" width="100" height="30" as="geometry"/>');
    const value = new DOMParser().parseFromString(cell.xmlValue, 'application/xml').documentElement;
    expect(value.nodeName).toBe('UserObject');
    expect(value.getAttribute('label')).toBe('SW-CORE-01\n10.0.0.2\nHQ · R1');
    expect(value.getAttribute('ims_device_id')).toBe(DEV.id);
    expect(value.getAttribute('ims_device_code')).toBe('SW-CORE-01');
    // Thuộc tính ngoài hợp đồng không còn ghi vào ô (IP, loại hydrate từ kho mỗi lần mở).
    expect(value.hasAttribute('ims_device_ip')).toBe(false);
    expect(value.hasAttribute('ims_device_type')).toBe(false);
  });

  it('ký tự đặc biệt trong mã được thoát — không phá được XML của bản vẽ', () => {
    const odd = 'A"<b>&\'x';
    const cell = deviceCellJson({ ...DEV, code: odd, cell: { ...DEV.cell, label: odd } }, { cellId: 'c', parent: '1', x: 0, y: 0 });
    const value = new DOMParser().parseFromString(cell.xmlValue, 'application/xml').documentElement;
    expect(value.getAttribute('ims_device_code')).toBe(odd);
    expect(value.getAttribute('label')).toBe(odd);
  });

  it('ô server dựng sẵn có ảnh thật (ims_photo + id ảnh) → thuộc tính đi vào UserObject; không ghi đè hợp đồng ims_device_*', () => {
    const cell = deviceCellJson(
      { ...DEV, cell: { ...DEV.cell, attrs: { ims_photo: 'front', ims_photo_file_id: 'f-1', ims_device_id: 'giả' } } },
      { cellId: 'c', parent: '1', x: 0, y: 0 },
    );
    const value = new DOMParser().parseFromString(cell.xmlValue, 'application/xml').documentElement;
    expect(value.getAttribute('ims_photo')).toBe('front');
    expect(value.getAttribute('ims_photo_file_id')).toBe('f-1');
    expect(value.getAttribute('ims_device_id')).toBe(DEV.id);
  });

  it('previous chỉ có mặt khi biết ô đứng trước', () => {
    expect(deviceCellJson(DEV, { cellId: 'c', parent: '1', x: 0, y: 0 })).not.toHaveProperty('previous');
    expect(deviceCellJson(DEV, { cellId: 'c', parent: '1', previous: 'x9', x: 0, y: 0 }).previous).toBe('x9');
  });

  it('patch theo đúng khuôn draw.io: u → trang → cells → i, nhiều ô một lượt', () => {
    const a = deviceCellJson(DEV, { cellId: 'a', parent: '1', x: 0, y: 0 });
    const b = deviceCellJson(DEV, { cellId: 'b', parent: '1', previous: 'a', x: 0, y: 0 });
    expect(insertPatch('p1', [a, b])).toEqual({ u: { p1: { cells: { i: [a, b] } } } });
  });
});

describe('deviceIdsInXml — máy đã có trên bản vẽ (hộp Thiết bị kho hiện "đã có")', () => {
  it('đọc ims_device_id của UserObject và object, bỏ hình tự do; XML hỏng → rỗng', () => {
    const xml = fileWith(
      '<UserObject label="a" ims_device_id="d1" ims_device_code="SW-1" id="c1"><mxCell vertex="1" parent="1"/></UserObject>' +
        '<object label="b" ims_device_id="d2" id="c2"><mxCell vertex="1" parent="1"/></object>' +
        '<UserObject label="khung" id="c3"><mxCell vertex="1" parent="1"/></UserObject>' +
        '<mxCell id="t" value="chữ" vertex="1" parent="1"/>',
    );
    expect([...deviceIdsInXml(xml)].sort()).toEqual(['d1', 'd2']);
    expect(deviceIdsInXml('<mxfile><diagram').size).toBe(0);
  });
});

describe('placeCells — chèn nhiều máy một lượt', () => {
  it('mỗi ô đứng bên phải ô trước, previous nối chuỗi để ô sau nằm trên', () => {
    let n = 0;
    const placed = placeCells([DEV, { ...DEV, id: 'x2', code: 'SW-2' }], {
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      parent: '1',
      previous: 'last',
      newId: () => `ims-${(n += 1)}`,
    });
    expect(placed.cells.map((c) => [c.id, c.previous, c.geometry])).toEqual([
      ['ims-1', 'last', '<mxGeometry x="140" y="0" width="100" height="30" as="geometry"/>'],
      ['ims-2', 'ims-1', '<mxGeometry x="280" y="0" width="100" height="30" as="geometry"/>'],
    ]);
    expect(placed.bounds).toEqual({ x: 0, y: 0, width: 380, height: 50 });
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
