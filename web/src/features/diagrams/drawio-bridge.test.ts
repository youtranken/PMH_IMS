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
  const ids = () => {
    let n = 0;
    return () => `ims-${(n += 1)}`;
  };
  const xy = (cells: { geometry: string }[]) => cells.map((c) => /x="(-?\d+)" y="(-?\d+)"/.exec(c.geometry)!.slice(1).map(Number));
  const many = (count: number, width = 60) => Array.from({ length: count }, (_, i) => ({ ...DEV, id: `x${i}`, code: `SW-${i}`, cell: { ...DEV.cell, width, height: 60 } }));

  it('ô sau bên phải ô trước, cách nhau đủ bề ngang nhãn 3 dòng (≥ 180px tâm-tâm); previous nối chuỗi', () => {
    const placed = placeCells([DEV, { ...DEV, id: 'x2', code: 'SW-2' }], { bounds: { x: 0, y: 0, width: 100, height: 50 }, parent: '1', previous: 'last', newId: ids() });
    expect(placed.cells.map((c) => [c.id, c.previous])).toEqual([
      ['ims-1', 'last'],
      ['ims-2', 'ims-1'],
    ]);
    // Nhãn "mã / IP / site · tủ · U" rộng hơn hình: cách 40px như trước thì nhãn hai máy dính nhau.
    expect(xy(placed.cells)).toEqual([
      [180, 0],
      [360, 0],
    ]);
  });

  it.each([
    // số máy, khối hình đang có, toạ độ mong đợi
    ['trang trống: lưới bắt đầu ở góc trên trái', 3, null, [[40, 40], [220, 40], [400, 40]]],
    ['quá 5 máy: xuống hàng, hàng sau dưới hàng trước đủ chỗ cho nhãn', 7, null, [[40, 40], [220, 40], [400, 40], [580, 40], [760, 40], [40, 180], [220, 180]]],
    ['khối hình đã rộng: lượt chèn xuống dưới khối, không kéo dài mãi sang phải', 2, { x: 0, y: 0, width: 1000, height: 100 }, [[0, 180], [180, 180]]],
  ] as const)('%s', (_name, count, bounds, expected) => {
    const placed = placeCells(many(count), { bounds, parent: '1', previous: null, newId: ids() });
    expect(xy(placed.cells)).toEqual(expected);
    // Không hai ô nào chồng nhau (kể cả phần nhãn ngang 180px).
    const points = xy(placed.cells);
    for (let i = 0; i < points.length; i += 1)
      for (let j = i + 1; j < points.length; j += 1) expect(Math.abs(points[i][0] - points[j][0]) >= 180 || Math.abs(points[i][1] - points[j][1]) >= 140).toBe(true);
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
