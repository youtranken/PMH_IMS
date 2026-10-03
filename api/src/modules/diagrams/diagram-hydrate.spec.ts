import { buildCellIndex } from './diagram-cells';
import { checkDiagramXml } from './diagram-gate';
import {
  IMS_STYLE_KEYS,
  deviceCellLabel,
  deviceInsertCell,
  deviceLookStyle,
  dehydrateDiagramXml,
  hydrateDiagramXml,
  linkEdgeCell,
  type CableHydration,
  type DeviceCellSource,
} from './diagram-hydrate';

const DEV = '7b0c1c1e-0000-4000-8000-000000000001';
const GONE = '7b0c1c1e-0000-4000-8000-0000000000ff';
const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>';

function page(body: string): string {
  return `<mxfile host="drawio"><diagram id="p1" name="Trang 1"><mxGraphModel dx="800"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function deviceCell(opts: { id?: string; deviceId?: string; code?: string; label?: string; style?: string; extra?: string } = {}): string {
  const { id = 'd1', deviceId = DEV, code = 'SW-E2E-01', label = code, style = 'rounded=1;fillColor=none;', extra = '' } = opts;
  return `<UserObject label="${label}" ims_device_id="${deviceId}" ims_device_code="${code}"${extra} id="${id}"><mxCell style="${style}" vertex="1" parent="1"><mxGeometry x="10" y="20" width="100" height="30" as="geometry"/></mxCell></UserObject>`;
}

function source(over: Partial<DeviceCellSource> = {}): DeviceCellSource {
  return {
    found: true,
    code: 'SW-E2E-01',
    status: 'in_use',
    ips: ['10.0.0.5'],
    siteCode: 'HQ',
    cabinetCode: 'R1',
    u: null,
    shape: 'mxgraph.networks.switch',
    iconSvg: null,
    ...over,
  };
}

function styleOf(xml: string, cellId: string): Record<string, string> {
  const index = buildCellIndex(xml);
  const cell = index.cells.find((c) => c.id === cellId);
  if (!cell) throw new Error(`không thấy ô ${cellId}`);
  const match = new RegExp(`id="${cellId}"[^>]*>\\s*<mxCell style="([^"]*)"`).exec(xml);
  const out: Record<string, string> = {};
  for (const token of (match?.[1] ?? '').split(';')) {
    const at = token.indexOf('=');
    if (at > 0) out[token.slice(0, at)] = token.slice(at + 1);
  }
  return out;
}

describe('deviceCellLabel — nhãn ô thiết bị hydrate từ kho', () => {
  it.each<[string, Partial<DeviceCellSource>, string]>([
    ['mã + IP + vị trí', {}, 'SW-E2E-01\n10.0.0.5\nHQ · R1'],
    ['nhiều IP thì ghi IP đầu + số còn lại', { ips: ['10.0.0.5', '10.0.0.6'] }, 'SW-E2E-01\n10.0.0.5 (+1)\nHQ · R1'],
    ['không IP, không tủ', { ips: [], cabinetCode: null }, 'SW-E2E-01\nHQ'],
    ['có U', { u: 12 }, 'SW-E2E-01\n10.0.0.5\nHQ · R1 · U12'],
    ['đã thanh lý → dấu cảnh báo', { status: 'retired' }, 'SW-E2E-01\n10.0.0.5\nHQ · R1\n⚠ Đã thanh lý'],
    ['không còn trong kho → dấu đỏ, giữ mã đọc được', { found: false, ips: [], siteCode: null, cabinetCode: null }, 'SW-E2E-01\n⚠ Không tìm thấy trong kho'],
  ])('%s', (_name, over, expected) => {
    expect(deviceCellLabel(source(over))).toBe(expected);
  });
});

describe('deviceLookStyle — phần style IMS giữ (hình theo loại)', () => {
  it('hình draw.io của loại', () => {
    expect(deviceLookStyle({ shape: 'mxgraph.networks.switch', iconSvg: null, found: true })).toBe(
      'shape=mxgraph.networks.switch;outlineConnect=0;verticalLabelPosition=bottom;verticalAlign=top;html=0;',
    );
  });
  it('SVG riêng thắng hình: ảnh data: mã hoá URL (không base64, không dấu ; trong giá trị)', () => {
    const style = deviceLookStyle({ shape: 'mxgraph.networks.switch', iconSvg: ICON, found: true });
    expect(style).toMatch(/^shape=image;image=data:image\/svg\+xml,%3Csvg/);
    expect(style.split(';').filter((t) => t.startsWith('image=')).length).toBe(1);
    expect(style).toContain('aspect=fixed;');
  });
  it('loại chưa chọn hình → "Thiết bị khác" (khối chữ nhật, không khoá shape)', () => {
    expect(deviceLookStyle({ shape: null, iconSvg: null, found: true })).toBe('verticalLabelPosition=middle;verticalAlign=middle;html=0;');
  });
  it('máy không còn trong kho → "Thiết bị khác" dù XML từng mang hình gì', () => {
    expect(deviceLookStyle({ shape: 'mxgraph.networks.switch', iconSvg: null, found: false })).toBe(
      'verticalLabelPosition=middle;verticalAlign=middle;html=0;',
    );
  });
  it('mọi khoá nó đặt đều nằm trong IMS_STYLE_KEYS (dehydrate gỡ được hết)', () => {
    for (const look of [
      { shape: 'mxgraph.networks.switch', iconSvg: null, found: true },
      { shape: null, iconSvg: ICON, found: true },
      { shape: null, iconSvg: null, found: true },
    ]) {
      for (const token of deviceLookStyle(look).split(';').filter(Boolean)) {
        expect(IMS_STYLE_KEYS).toContain(token.split('=')[0]);
      }
    }
  });
});

describe('dehydrateDiagramXml — XML lưu "khô" (AD-18)', () => {
  it('ô thiết bị: bỏ phần style IMS + nhãn hydrate, nhãn khô là mã máy; giữ style người vẽ', () => {
    const wet = page(
      deviceCell({
        label: 'SW-E2E-01&#xa;10.0.0.5&#xa;HQ · R1',
        style: 'rounded=1;shape=image;image=data:image/svg+xml,%3Csvg%3E;imageAspect=0;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;html=0;fillColor=none;fontSize=14;',
      }),
    );
    const dry = dehydrateDiagramXml(wet);
    expect(dry).toContain('label="SW-E2E-01"');
    expect(styleOf(dry, 'd1')).toEqual({ rounded: '1', fillColor: 'none', fontSize: '14' });
    expect(dry).not.toContain('data:image/svg+xml');
  });

  it('bỏ thuộc tính dữ liệu cũ không thuộc hợp đồng (ims_device_ip, ims_device_type), giữ ims_device_id/code và dữ liệu tuỳ ý', () => {
    const dry = dehydrateDiagramXml(page(deviceCell({ extra: ' ims_device_ip="10.0.0.5" ims_device_type="Switch" owner="IT"' })));
    expect(dry).not.toContain('ims_device_ip');
    expect(dry).not.toContain('ims_device_type');
    expect(dry).toContain(`ims_device_id="${DEV}"`);
    expect(dry).toContain('ims_device_code="SW-E2E-01"');
    expect(dry).toContain('owner="IT"');
  });

  it('ảnh data: base64 kiểu cũ (`image=data:image/png;base64,...`) gỡ trọn, không để mẩu "base64,..." mồ côi', () => {
    const dry = dehydrateDiagramXml(page(deviceCell({ style: 'shape=image;image=data:image/png;base64,iVBOR==;fontSize=9;' })));
    expect(styleOf(dry, 'd1')).toEqual({ fontSize: '9' });
    expect(dry).not.toContain('base64');
  });

  it('không đụng hình tự do, dây, chữ — kể cả khi chúng có shape/html', () => {
    const free =
      '<mxCell id="s1" value="&lt;b&gt;Tầng 3&lt;/b&gt;" style="shape=mxgraph.networks.cloud;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>' +
      '<mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="d1" target="s1"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="5" y="6"/></Array></mxGeometry></mxCell>';
    const xml = page(deviceCell() + free);
    const dry = dehydrateDiagramXml(xml);
    expect(dry).toContain('style="shape=mxgraph.networks.cloud;html=1;"');
    expect(dry).toContain('value="&lt;b&gt;Tầng 3&lt;/b&gt;"');
    expect(dry).toContain('<mxPoint x="5" y="6"/>');
    expect(buildCellIndex(dry).cells.map((c) => c.id)).toEqual(['d1', 's1', 'e1']);
  });

  it('dehydrate hai lần = một lần; kết quả vẫn qua cổng kiểm', () => {
    const once = dehydrateDiagramXml(page(deviceCell({ style: 'shape=mxgraph.networks.switch;html=0;' })));
    expect(dehydrateDiagramXml(once)).toBe(once);
    expect(checkDiagramXml(once, { xmlMaxKb: 2048, maxCells: 5000 }).reason).toBeNull();
  });
});

describe('hydrateDiagramXml — nạp hình/nhãn từ kho trước khi mở', () => {
  it('đổi hình của loại ở Danh mục → lần mở sau ô hiện hình mới (XML khô không giữ hình)', () => {
    const dry = dehydrateDiagramXml(page(deviceCell({ style: 'shape=mxgraph.networks.switch;rounded=1;' })));
    const before = hydrateDiagramXml(dry, new Map([[DEV, source()]]));
    const after = hydrateDiagramXml(dry, new Map([[DEV, source({ shape: 'mxgraph.cisco.switches.workgroup_switch' })]]));
    expect(styleOf(before, 'd1').shape).toBe('mxgraph.networks.switch');
    expect(styleOf(after, 'd1').shape).toBe('mxgraph.cisco.switches.workgroup_switch');
    expect(styleOf(after, 'd1').rounded).toBe('1');
  });

  it('nhãn = mã + IP + vị trí hiện tại; đổi IP trong kho thì nhãn đổi theo', () => {
    const dry = page(deviceCell());
    expect(hydrateDiagramXml(dry, new Map([[DEV, source({ ips: ['10.9.9.9'] })]]))).toContain('label="SW-E2E-01&#xa;10.9.9.9&#xa;HQ · R1"');
  });

  it('ims_device_id không còn trong kho (hoặc không phải UUID) → nhãn dấu đỏ, không lỗi', () => {
    const xml = page(deviceCell({ deviceId: GONE, code: 'SW-E2E-OLD' }) + deviceCell({ id: 'd2', deviceId: 'không-phải-uuid', code: 'X' }));
    const out = hydrateDiagramXml(xml, new Map());
    expect(out).toContain('label="SW-E2E-OLD&#xa;⚠ Không tìm thấy trong kho"');
    expect(out).toContain('label="X&#xa;⚠ Không tìm thấy trong kho"');
  });

  it('khứ hồi: hydrate rồi dehydrate trả lại đúng XML khô', () => {
    const dry = dehydrateDiagramXml(page(deviceCell({ style: 'fontSize=14;' }) + '<mxCell id="s1" value="x" vertex="1" parent="1"/>'));
    const wet = hydrateDiagramXml(dry, new Map([[DEV, source({ iconSvg: ICON })]]));
    expect(wet).toContain('data:image/svg+xml');
    expect(dehydrateDiagramXml(wet)).toBe(dry);
  });

  it('XML đã hydrate (kể cả biểu tượng SVG riêng) vẫn qua cổng kiểm — lưu được', () => {
    const wet = hydrateDiagramXml(page(deviceCell()), new Map([[DEV, source({ iconSvg: ICON, status: 'retired' })]]));
    expect(checkDiagramXml(wet, { xmlMaxKb: 2048, maxCells: 5000 }).reason).toBeNull();
  });
});

describe('deviceInsertCell — ô mới khi chèn từ hộp "Thiết bị kho"', () => {
  it('cỡ theo hình của loại, style = mặc định người vẽ + phần IMS', () => {
    const cell = deviceInsertCell(source());
    expect(cell).toMatchObject({ width: 100, height: 30, label: 'SW-E2E-01\n10.0.0.5\nHQ · R1' });
    expect(cell.style).toContain('shape=mxgraph.networks.switch;');
  });
  it('biểu tượng riêng → ô vuông; loại chưa chọn hình → khối "Thiết bị khác" bo góc', () => {
    expect(deviceInsertCell(source({ iconSvg: ICON }))).toMatchObject({ width: 60, height: 60 });
    const other = deviceInsertCell(source({ shape: null }));
    expect(other).toMatchObject({ width: 120, height: 50 });
    expect(other.style).toContain('rounded=1;');
  });
});

describe('dây của kho — nhãn cổng + màu hydrate từ sơ đồ cổng, lưu khô (AD-18)', () => {
  const DEV_B = '7b0c1c1e-0000-4000-8000-000000000002';
  const LINK = '11111111-0000-4000-8000-000000000001';
  const GONE_LINK = '11111111-0000-4000-8000-0000000000ff';
  const CAT6 = '22222222-0000-4000-8000-000000000001';
  const FIBER = '22222222-0000-4000-8000-000000000002';
  const devices = new Map([
    [DEV, source()],
    [DEV_B, source({ code: 'SRV-E2E-01' })],
  ]);
  const two = deviceCell() + deviceCell({ id: 'd2', deviceId: DEV_B, code: 'SRV-E2E-01' });
  const cables: CableHydration = {
    links: new Map([[LINK, { id: LINK, deviceA: DEV, portA: 'Gi1/0/24', deviceB: DEV_B, portB: 'eth0', cableTypeId: FIBER }]]),
    slots: new Map([
      [CAT6, 1],
      [FIBER, 2],
    ]),
  };

  function linkedEdge(opts: { id?: string; source?: string; target?: string; link?: string; label?: string; style?: string; cable?: string } = {}): string {
    const { id = 'e1', source: from = 'd1', target: to = 'd2', link = LINK, label = '', style = 'edgeStyle=orthogonalEdgeStyle;', cable = CAT6 } = opts;
    return `<UserObject label="${label}" ims_link_id="${link}" ims_cable_type_id="${cable}" id="${id}"><mxCell style="${style}" edge="1" parent="1" source="${from}" target="${to}"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="5" y="6"/></Array></mxGeometry></mxCell></UserObject>`;
  }

  function bareEdge(id = 'e2', style = 'edgeStyle=orthogonalEdgeStyle;strokeColor=#FF0000;', value = 'tạm'): string {
    return `<mxCell id="${id}" value="${value}" style="${style}" edge="1" parent="1" source="d1" target="d2"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  }

  it('dây đã khai: nhãn "cổng đầu nguồn ↔ cổng đầu đích", màu theo loại dây HIỆN TẠI của dòng sơ đồ cổng', () => {
    const wet = hydrateDiagramXml(page(two + linkedEdge()), devices, cables);
    expect(wet).toContain('label="Gi1/0/24 ↔ eth0"');
    expect(styleOf(wet, 'e1')).toMatchObject({ edgeStyle: 'orthogonalEdgeStyle', imsPaint: 'cable-2', html: '0' });
    // Loại dây đổi ở trang thiết bị (Cat6 → Fiber): thuộc tính trên nét theo kho.
    expect(wet).toContain(`ims_cable_type_id="${FIBER}"`);
  });

  it('nét vẽ ngược chiều (từ máy kia sang) thì nhãn cũng đọc ngược', () => {
    const wet = hydrateDiagramXml(page(two + linkedEdge({ source: 'd2', target: 'd1' })), devices, cables);
    expect(wet).toContain('label="eth0 ↔ Gi1/0/24"');
  });

  it('màu KHÔNG lấy từ strokeColor trong XML', () => {
    const wet = hydrateDiagramXml(page(two + linkedEdge({ style: 'strokeColor=#00FF00;dashed=1;' })), devices, cables);
    expect(styleOf(wet, 'e1').strokeColor).toBeUndefined();
    expect(styleOf(wet, 'e1').dashed).toBeUndefined();
    expect(styleOf(wet, 'e1').imsPaint).toBe('cable-2');
  });

  it('kết nối đã bị gỡ khỏi sơ đồ cổng → nét đỏ + chú thích, KHÔNG tự xoá nét', () => {
    const wet = hydrateDiagramXml(page(two + linkedEdge({ link: GONE_LINK })), devices, cables);
    expect(wet).toContain('label="⚠ Kết nối đã bị gỡ khỏi sơ đồ cổng"');
    expect(styleOf(wet, 'e1')).toMatchObject({ imsPaint: 'danger', dashed: '1' });
  });

  it('nét giữa hai máy kho chưa khai → vàng + "Chưa khai vào sơ đồ cổng"', () => {
    const wet = hydrateDiagramXml(page(two + bareEdge()), devices, cables);
    expect(wet).toContain('value="⚠ Chưa khai vào sơ đồ cổng"');
    expect(bareStyleOf(wet, 'e2')).toMatchObject({ imsPaint: 'warn', dashed: '1' });
    expect(bareStyleOf(wet, 'e2').strokeColor).toBeUndefined();
  });

  it('dehydrate: dây của kho về khô (nhãn rỗng, bỏ khoá màu IMS), giữ đường đi; khứ hồi ổn định', () => {
    const dry = dehydrateDiagramXml(
      page(two + linkedEdge({ label: 'Gi1/0/24 ↔ eth0', cable: FIBER, style: 'edgeStyle=orthogonalEdgeStyle;imsPaint=cable-2;html=0;strokeColor=#123456;' }) + bareEdge()),
    );
    expect(dry).toContain('label=""');
    expect(dry).toContain('value=""');
    expect(dry).not.toContain('imsPaint');
    expect(dry).not.toContain('strokeColor');
    expect(dry).toContain('<mxPoint x="5" y="6"/>');
    expect(dehydrateDiagramXml(hydrateDiagramXml(dry, devices, cables))).toBe(dry);
  });

  it('XML có dây đã hydrate vẫn qua cổng kiểm', () => {
    const wet = hydrateDiagramXml(page(two + linkedEdge() + bareEdge()), devices, cables);
    expect(checkDiagramXml(wet, { xmlMaxKb: 2048, maxCells: 5000 }).reason).toBeNull();
  });

  it('ô dây mới cho "Vẽ vào": gắn sẵn link + loại dây, nhãn + màu như lúc hydrate', () => {
    const cell = linkEdgeCell(cables.links.get(LINK)!, { sourceDeviceId: DEV_B, slot: 2 });
    expect(cell).toEqual({
      label: 'eth0 ↔ Gi1/0/24',
      style: 'edgeStyle=orthogonalEdgeStyle;rounded=0;endArrow=none;imsPaint=cable-2;html=0;',
      attrs: { ims_link_id: LINK, ims_cable_type_id: FIBER },
    });
  });
});

/*
 * Ảnh thật (Story 10.11, AD-18): ô thiết bị mang `ims_photo="front|back"` là lựa chọn của người
 * vẽ; ảnh (data URI đã thu nhỏ) và `ims_photo_file_id` chỉ có ở XML ướt — XML lưu không chứa ảnh.
 */
describe('ảnh thật trên ô thiết bị — hydrate nhúng, dehydrate gỡ', () => {
  const FILE = '7b0c1c1e-0000-4000-8000-0000000000aa';
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const photo = { fileId: FILE, uri: `data:image/png,${PNG}` };
  const withPhoto = source({ photos: { front: photo } });

  it('deviceLookStyle mặt có ảnh → shape=image, ảnh dạng data:image/png,<base64> (không dấu ; trong giá trị), giữ tỉ lệ ảnh', () => {
    const style = deviceLookStyle(withPhoto, 'front');
    expect(style).toBe(`shape=image;image=data:image/png,${PNG};imageAspect=1;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;html=0;`);
  });

  it('mặt không có ảnh → rơi về biểu tượng loại', () => {
    expect(deviceLookStyle(withPhoto, 'back')).toBe(deviceLookStyle(withPhoto));
  });

  it('hydrate: ô chọn ảnh mặt trước nhận ảnh + ims_photo_file_id; ô không chọn ảnh vẫn là biểu tượng', () => {
    const dry = page(deviceCell({ id: 'a', extra: ' ims_photo="front"' }) + deviceCell({ id: 'b' }));
    const wet = hydrateDiagramXml(dry, new Map([[DEV, withPhoto]]));
    expect(styleOf(wet, 'a')).toMatchObject({ shape: 'image', image: `data:image/png,${PNG}`, imageAspect: '1' });
    expect(wet).toMatch(new RegExp(`ims_photo="front"[^>]*ims_photo_file_id="${FILE}"|ims_photo_file_id="${FILE}"[^>]*ims_photo="front"`));
    expect(styleOf(wet, 'b')).toMatchObject({ shape: 'mxgraph.networks.switch' });
    expect(checkDiagramXml(wet, { xmlMaxKb: 2048, maxCells: 5000 }).reason).toBeNull();
  });

  it('ảnh đã bị gỡ khỏi máy/model → ô về biểu tượng, giữ lựa chọn ims_photo để ảnh quay lại khi có', () => {
    const dry = page(deviceCell({ id: 'a', extra: ` ims_photo="front" ims_photo_file_id="${FILE}"` }));
    const wet = hydrateDiagramXml(dry, new Map([[DEV, source()]]));
    expect(styleOf(wet, 'a')).toMatchObject({ shape: 'mxgraph.networks.switch' });
    expect(wet).toContain('ims_photo="front"');
    expect(wet).not.toContain('ims_photo_file_id');
  });

  it('dehydrate gỡ ảnh nhúng và ims_photo_file_id, giữ ims_photo; hydrate lại ra đúng bản ướt', () => {
    const dry = page(deviceCell({ id: 'a', extra: ' ims_photo="front"' }));
    const wet = hydrateDiagramXml(dry, new Map([[DEV, withPhoto]]));
    const again = dehydrateDiagramXml(wet);
    expect(again).not.toContain('data:image/png');
    expect(again).not.toContain('ims_photo_file_id');
    expect(again).toContain('ims_photo="front"');
    expect(hydrateDiagramXml(again, new Map([[DEV, withPhoto]]))).toBe(wet);
  });

  it('nhãn có vị trí nhiều U và cảnh báo U vượt tủ', () => {
    expect(deviceCellLabel(source({ u: 5, uSize: 2 }))).toBe('SW-E2E-01\n10.0.0.5\nHQ · R1 · U5–U6');
    expect(deviceCellLabel(source({ u: 41, uSize: 2, rackWarning: '⚠ U41–U42 vượt tủ R1 (40U)' }))).toBe(
      'SW-E2E-01\n10.0.0.5\nHQ · R1 · U41–U42\n⚠ U41–U42 vượt tủ R1 (40U)',
    );
  });
});

/** Style của một `<mxCell>` trần (không bọc `UserObject`). */
function bareStyleOf(xml: string, cellId: string): Record<string, string> {
  const match = new RegExp(`<mxCell id="${cellId}"[^>]*style="([^"]*)"`).exec(xml);
  const out: Record<string, string> = {};
  for (const token of (match?.[1] ?? '').split(';')) {
    const at = token.indexOf('=');
    if (at > 0) out[token.slice(0, at)] = token.slice(at + 1);
  }
  return out;
}
