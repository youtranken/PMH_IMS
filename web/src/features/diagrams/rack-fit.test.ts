import { describe, expect, it } from 'vitest';
import { cellBox, cellPlacement, columnPlacement, outsidePlacement, rackFit, type RackFitDevice } from './rack-fit';

const CAB_01 = 'cab-01';
const CAB_04 = 'cab-04';
const SIDE = 'labelPosition=right;verticalLabelPosition=middle;align=left;verticalAlign=middle;spacingLeft=14;';
/** Khung tủ 42U IMS dựng: lề 33/9/21/22, 1U = 14.8 — cao 21 + 22 + 42 × 14.8 = 664.6. */
const RACK_STYLE =
  'shape=mxgraph.rackGeneral.rackCabinet3;rackUnitSize=14.8;container=1;collapsible=0;childLayout=rack;allowGaps=1;marginLeft=33;marginRight=9;marginTop=21;marginBottom=22;numDisp=descend;';

function model(body: string): string {
  return `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel>`;
}
const frame = (id: string, cabinetId: string, label = 'Tủ TU-TOWER-04 · Mặt trước') =>
  `<UserObject label="${label}" ims_cabinet_id="${cabinetId}" id="${id}"><mxCell style="${RACK_STYLE}" vertex="1" parent="1"><mxGeometry x="250" y="20" width="204" height="664.6" as="geometry"/></mxCell></UserObject>`;
const device = (id: string, deviceId: string, parent: string, geo: { y: number; h: number; x?: number; w?: number }, style = 'align=center;shape=image;verticalLabelPosition=bottom;verticalAlign=top;') =>
  `<UserObject label="${deviceId}" ims_device_id="${deviceId}" ims_device_code="${deviceId}" id="${id}"><mxCell style="${style}" vertex="1" parent="${parent}"><mxGeometry x="${geo.x ?? 33}" y="${geo.y}" width="${geo.w ?? 162}" height="${geo.h}" as="geometry"/></mxCell></UserObject>`;

const INFO = new Map<string, RackFitDevice>([
  ['UPS-03', { code: 'UPS-03', cabinetId: CAB_01, cabinetCode: 'TU-TOWER-01', u: 30, uSize: 1 }],
  ['SW-01', { code: 'SW-01', cabinetId: CAB_04, cabinetCode: 'TU-TOWER-04', u: 30, uSize: 1 }],
  ['SRV-02', { code: 'SRV-02', cabinetId: CAB_04, cabinetCode: 'TU-TOWER-04', u: 5, uSize: 2 }],
  ['PC-09', { code: 'PC-09', cabinetId: CAB_04, cabinetCode: 'TU-TOWER-04', u: null, uSize: null }],
]);

describe('rackFit — máy trong khung tủ cao đúng số U, nằm đúng U (Q-23 05/10)', () => {
  it('máy 1U ở U30 bị draw.io bắt thành 4U (ảnh cao 60) → đặt lại đúng 1U ở U30, nhãn bên phải', () => {
    // Bản vẽ "PMH Tower" #8: ô cao 59.2 = 4U ở y 228.2 (U25–U28).
    const result = rackFit(model(frame('f4', CAB_04) + device('d1', 'SW-01', 'f4', { y: 228.2, h: 59.2 })), INFO);
    expect(result.updates.d1).toEqual({
      geometry: '<mxGeometry x="33" y="198.6" width="162" height="14.8" as="geometry"/>',
      style: `shape=image;${SIDE}`,
    });
    expect(result.cabinetMismatch).toEqual([]);
  });

  it('máy 2U ở U5: cao 2U, đáy ở U5', () => {
    const result = rackFit(model(frame('f4', CAB_04) + device('d1', 'SRV-02', 'f4', { y: 10, h: 133.2 })), INFO);
    // 42U: hàng trên cùng của máy là U6 → cách đỉnh 42 − 6 = 36U.
    expect(result.updates.d1.geometry).toBe('<mxGeometry x="33" y="553.8" width="162" height="29.6" as="geometry"/>');
  });

  it('đã đúng chỗ, đúng nhãn → không sửa gì (không vòng lặp autosave)', () => {
    const ok = device('d1', 'SW-01', 'f4', { y: 198.6, h: 14.8 }, `shape=image;${SIDE}`);
    expect(rackFit(model(frame('f4', CAB_04) + ok), INFO).updates).toEqual({});
  });

  it('kho ghi TỦ KHÁC (máy TU-TOWER-01 thả vào khung TU-TOWER-04) → không đổi kho, báo lại; ô vẫn cao đúng n U ở U nơi thả (Q-23 06/10 C)', () => {
    const result = rackFit(model(frame('f4', CAB_04) + device('d1', 'UPS-03', 'f4', { y: 228.2, h: 59.2 })), INFO);
    // Không bao giờ nằm trong khung với cỡ cũ (ảnh 4U chiếm U25–U28): 1U ở U28, rộng hết lòng tủ.
    expect(result.updates.d1.geometry).toBe('<mxGeometry x="33" y="228.2" width="162" height="14.8" as="geometry"/>');
    expect(result.cabinetMismatch).toEqual([
      {
        cellId: 'd1',
        deviceId: 'UPS-03',
        code: 'UPS-03',
        deviceCabinet: 'TU-TOWER-01',
        frameId: 'f4',
        frameCabinetId: CAB_04,
        frameLabel: 'Tủ TU-TOWER-04 · Mặt trước',
        // Đỉnh ô ở y 228.2 = cách đỉnh lòng tủ 14U → hàng trên cùng là U28; máy 1U bắt đầu ở U28.
        dropU: 28,
        rackU: 42,
        uSize: 1,
      },
    ]);
  });

  it('U nơi thả của máy nhiều U: hàng trên cùng ở chỗ thả, U bắt đầu = hàng đó − (Số U − 1); chạm đáy thì kẹp về U1', () => {
    const info = new Map([...INFO, ['BIG-01', { code: 'BIG-01', cabinetId: CAB_01, cabinetCode: 'TU-TOWER-01', u: 9, uSize: 3 }]]);
    const top = rackFit(model(frame('f4', CAB_04) + device('d1', 'BIG-01', 'f4', { y: 21, h: 44.4 })), info);
    expect(top.cabinetMismatch[0]).toMatchObject({ dropU: 40, uSize: 3 });
    const bottom = rackFit(model(frame('f4', CAB_04) + device('d1', 'BIG-01', 'f4', { y: 21 + 41 * 14.8, h: 14.8 })), info);
    expect(bottom.cabinetMismatch[0]).toMatchObject({ dropU: 1 });
  });

  it('khung MẶT SAU của bản vẽ cũ (tủ nay chỉ vẽ mặt trước): không đặt theo U, không báo lệch tủ', () => {
    const rear = frame('f5', CAB_04, 'Tủ TU-TOWER-04 · Mặt sau');
    const result = rackFit(model(rear + device('d1', 'UPS-03', 'f5', { y: 228.2, h: 59.2 }) + device('d2', 'SW-01', 'f5', { y: 10, h: 59.2 })), INFO);
    expect(result.cabinetMismatch).toEqual([]);
    expect(result.updates).toEqual({});
    expect(result.noU).toEqual([]);
  });

  it('máy cùng tủ nhưng chưa khai U → cao 1U ở chỗ thả (draw.io đã bắt vạch), báo chưa khai U', () => {
    const result = rackFit(model(frame('f4', CAB_04) + device('d1', 'PC-09', 'f4', { y: 287.4, h: 59.2 })), INFO);
    expect(result.updates.d1.geometry).toBe('<mxGeometry x="33" y="287.4" width="162" height="14.8" as="geometry"/>');
    expect(result.noU).toEqual([expect.objectContaining({ cellId: 'd1', code: 'PC-09', deviceId: 'PC-09', frameCabinetId: CAB_04, dropU: 24 })]);
  });

  it('kéo máy RA khỏi khung tủ → nhãn về dưới hình (bỏ nhãn bên phải), không đụng cỡ', () => {
    const out = device('d1', 'SW-01', '1', { y: 500, h: 14.8, x: 700 }, `shape=image;${SIDE}`);
    expect(rackFit(model(frame('f4', CAB_04) + out), INFO).updates).toEqual({ d1: { style: 'shape=image;verticalLabelPosition=bottom;verticalAlign=top;' } });
  });

  it('máy trong tủ người vẽ lấy từ thư viện rack (không gắn tủ kho): không đặt theo U, nhưng KHÔNG bị đổi nhãn về dưới hình (hydrate đặt nhãn bên phải cho mọi khung rack)', () => {
    const plain = `<mxCell id="f9" style="${RACK_STYLE}" vertex="1" parent="1"><mxGeometry x="0" y="0" width="204" height="664.6" as="geometry"/></mxCell>`;
    expect(rackFit(model(plain + device('d1', 'SW-01', 'f9', { y: 10, h: 14.8 }, `shape=image;${SIDE}`)), INFO).updates).toEqual({});
  });

  it('máy kho chưa biết (vừa chèn, chưa có thông tin) → hỏi thêm, không sửa', () => {
    const result = rackFit(model(frame('f4', CAB_04) + device('d1', 'MOI-01', 'f4', { y: 10, h: 40 })), INFO);
    expect(result.updates).toEqual({});
    expect(result.unknown).toEqual(['MOI-01']);
  });

  it('khung không phải tủ IMS (không ims_cabinet_id) hay khung "Chưa khai U" (stackLayout) → không đụng', () => {
    const plain = `<mxCell id="f9" style="${RACK_STYLE}" vertex="1" parent="1"><mxGeometry x="0" y="0" width="204" height="664.6" as="geometry"/></mxCell>`;
    const column = `<UserObject label="Tủ · Chưa khai U" ims_cabinet_id="${CAB_04}" id="col"><mxCell style="swimlane;container=1;childLayout=stackLayout;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="200" height="300" as="geometry"/></mxCell></UserObject>`;
    const xml = model(plain + column + device('d1', 'SW-01', 'f9', { y: 10, h: 59.2 }) + device('d2', 'SRV-02', 'col', { y: 38, h: 60 }));
    expect(rackFit(xml, INFO).updates).toEqual({});
  });
});

describe('rackFit — U kho là sự thật của khung tủ (Q-23 06/10 C)', () => {
  const PHOTO = 'align=center;shape=image;image=data:image/png,AAAA;imageAspect=1;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;';
  const LABELED = new Map<string, RackFitDevice>([
    ...INFO,
    ['UPS-03', { ...INFO.get('UPS-03')!, rackLabel: 'UPS-03 · 172.16.10.5', freeLabel: 'UPS-03\n172.16.10.5\nTower · TU-TOWER-01 · U30', freeSize: { width: 160, height: 40 } }],
    ['SW-01', { ...INFO.get('SW-01')!, rackLabel: 'SW-01 · 172.16.10.1', freeLabel: 'SW-01\n172.16.10.1\nTower · TU-TOWER-04 · U30', freeSize: { width: 160, height: 15 } }],
  ]);

  it('hai máy không bao giờ chung một U: máy tủ khác thả đè lên U30 của SW-01 → dời về U trống gần nhất', () => {
    // UPS-03 (tủ khác) thả đúng U30 nơi SW-01 (kho ghi U30) đang nằm.
    const result = rackFit(model(frame('f4', CAB_04) + device('d0', 'SW-01', 'f4', { y: 198.6, h: 14.8 }, `shape=image;${SIDE}`) + device('d1', 'UPS-03', 'f4', { y: 198.6, h: 59.2 })), INFO);
    // U trống gần nhất của U30 (cách đều hai phía thì lấy phía dưới): U29 → y = 21 + (42 − 29) × 14.8.
    expect(result.updates.d1.geometry).toBe('<mxGeometry x="33" y="213.4" width="162" height="14.8" as="geometry"/>');
    expect(result.cabinetMismatch[0]).toMatchObject({ cellId: 'd1', dropU: 29 });
  });

  it('nhãn MỘT dòng bên phải ngay khi máy vào khung (không chờ mở lại bản vẽ)', () => {
    const three = device('d1', 'SW-01', 'f4', { y: 198.6, h: 14.8 }, `shape=image;${SIDE}`).replace('label="SW-01"', 'label="SW-01&#xa;172.16.10.1&#xa;Tower · TU-TOWER-04 · U30"');
    const update = rackFit(model(frame('f4', CAB_04) + three), LABELED).updates.d1;
    expect(update.xmlValue).toContain('label="SW-01 · 172.16.10.1"');
    expect(update.xmlValue).toContain('ims_device_id="SW-01"');
  });

  it('kéo ra khỏi khung → nhãn ba dòng dưới hình trở lại', () => {
    const out = device('d1', 'SW-01', '1', { y: 500, h: 14.8, x: 700 }, `shape=image;${SIDE}`).replace('label="SW-01"', 'label="SW-01 · 172.16.10.1"');
    const update = rackFit(model(frame('f4', CAB_04) + out), LABELED).updates.d1;
    expect(update.xmlValue).toContain('label="SW-01&#xa;172.16.10.1&#xa;Tower · TU-TOWER-04 · U30"');
  });

  it('ảnh thật trong khung lấp đầy ô U (imageAspect=0, bỏ aspect=fixed); ra ngoài khung thì giữ tỉ lệ lại', () => {
    const inside = rackFit(model(frame('f4', CAB_04) + device('d1', 'SW-01', 'f4', { y: 198.6, h: 14.8 }, PHOTO)), INFO).updates.d1.style!;
    expect(inside).toContain('imageAspect=0;');
    expect(inside).not.toContain('aspect=fixed');
    expect(inside).toContain(SIDE);
    const out = rackFit(model(frame('f4', CAB_04) + device('d2', 'SW-01', '1', { y: 500, h: 15, x: 700 }, inside)), INFO).updates.d2.style!;
    expect(out).toContain('imageAspect=1;');
    expect(out).toContain('aspect=fixed;');
    expect(out).not.toContain('labelPosition=right');
  });

  it('nhãn hai máy sát nhau chồng lên nhau (khung U nhỏ) → nhãn sau sang làn bên', () => {
    const small = frame('f4', CAB_04).replace('rackUnitSize=14.8', 'rackUnitSize=8');
    // Khung 8px/U: cao 664.6 − 43 = 621.6 → 78U. SW-01 ở U30, máy 1U kế bên (U31).
    const info = new Map([...INFO, ['SW-02', { code: 'SW-02', cabinetId: CAB_04, cabinetCode: 'TU-TOWER-04', u: 31, uSize: 1 }]]);
    const result = rackFit(model(small + device('d0', 'SW-01', 'f4', { y: 0, h: 8 }) + device('d1', 'SW-02', 'f4', { y: 0, h: 8 })), info);
    const spacing = (id: string) => /spacingLeft=(\d+)/.exec(result.updates[id].style ?? '')?.[1];
    expect(spacing('d0')).not.toBe(spacing('d1'));
  });
});

describe('outsidePlacement / columnPlacement — Hủy đưa máy RA khỏi khung tủ (Q-23 06/10 C, D)', () => {
  const info: RackFitDevice = { code: 'UPS-03', cabinetId: CAB_01, cabinetCode: 'TU-TOWER-01', u: 30, uSize: 1, freeLabel: 'UPS-03\nTU-TOWER-01', freeSize: { width: 160, height: 40 } };
  const PHOTO_IN = `align=center;shape=image;image=data:image/png,AAAA;imageAspect=0;${SIDE}`;

  it('ra cạnh trái khung, cùng cha với khung, cỡ trang tự do, nhãn ba dòng dưới hình, ảnh giữ tỉ lệ', () => {
    const xml = model(frame('f4', CAB_04) + device('d1', 'UPS-03', 'f4', { y: 228.2, h: 14.8 }, PHOTO_IN));
    const placed = outsidePlacement(xml, 'd1', info)!;
    expect(placed.parent).toBe('1');
    // Khung ở x 250 → ô rộng 160 đặt cách mép trái khung 40: x = 250 − 40 − 160.
    expect(placed.geometry).toBe('<mxGeometry x="50" y="248.2" width="160" height="40" as="geometry"/>');
    expect(placed.style).not.toContain('labelPosition=right');
    expect(placed.style).toContain('imageAspect=1;');
    expect(placed.xmlValue).toContain('label="UPS-03&#xa;TU-TOWER-01"');
  });

  it('ô không nằm trong khung tủ → null (không có gì để đưa ra)', () => {
    expect(outsidePlacement(model(device('d1', 'UPS-03', '1', { y: 10, h: 14.8 })), 'd1', info)).toBeNull();
  });

  it('cột "Chưa khai U" của cùng tủ đã có → vào cuối cột', () => {
    const column = `<UserObject label="Tủ TU-TOWER-04 · Chưa khai U" ims_cabinet_id="${CAB_04}" id="col"><mxCell style="swimlane;container=1;childLayout=stackLayout;marginLeft=20;" vertex="1" parent="1"><mxGeometry x="654" y="20" width="200" height="300" as="geometry"/></mxCell></UserObject>`;
    const xml = model(frame('f4', CAB_04) + column + device('c0', 'SRV-02', 'col', { y: 38, h: 60, x: 20, w: 160 }) + device('d1', 'PC-09', 'f4', { y: 287.4, h: 14.8 }));
    const placed = columnPlacement(xml, 'd1', CAB_04, { ...info, code: 'PC-09' })!;
    expect(placed).toMatchObject({ parent: 'col', previous: 'c0' });
    expect(placed.geometry).toBe('<mxGeometry x="20" y="176" width="160" height="40" as="geometry"/>');
  });

  it('chưa có cột → null (nơi gọi dựng cột mới)', () => {
    expect(columnPlacement(model(frame('f4', CAB_04) + device('d1', 'PC-09', 'f4', { y: 287.4, h: 14.8 })), 'd1', CAB_04, info)).toBeNull();
  });
});

describe('cellPlacement — chỗ cũ của một ô để đưa về khi người vẽ huỷ chuyển tủ', () => {
  it('cha, ô đứng trước trong cùng cha, hình học nguyên chuỗi', () => {
    const xml = model(frame('f4', CAB_04) + device('d0', 'SW-01', 'f4', { y: 10, h: 14.8 }) + device('d1', 'SRV-02', 'f4', { y: 40, h: 29.6 }));
    expect(cellPlacement(xml, 'd1')).toEqual({
      parent: 'f4',
      previous: 'd0',
      geometry: '<mxGeometry x="33" y="40" width="162" height="29.6" as="geometry"/>',
    });
    expect(cellPlacement(xml, 'd0')).toMatchObject({ parent: 'f4', previous: '' });
    expect(cellPlacement(xml, 'khong-co')).toBeNull();
  });
});

describe('cellBox — vị trí + bề rộng một ô (khung tủ khi đưa máy ra / vào cột)', () => {
  it('ô trần, ô bọc UserObject; x/y vắng = 0; không có ô / không có hình học → null', () => {
    const xml = model(
      '<mxCell id="f1" vertex="1" parent="1"><mxGeometry x="10" y="20" width="160" height="600" as="geometry"/></mxCell>' +
        '<UserObject id="u1" label="A"><mxCell vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell></UserObject>' +
        '<mxCell id="n1" vertex="1" parent="1"/>',
    );
    expect(cellBox(xml, 'f1')).toEqual({ x: 10, y: 20, width: 160 });
    expect(cellBox(xml, 'u1')).toEqual({ x: 0, y: 0, width: 80 });
    expect(cellBox(xml, 'n1')).toBeNull();
    expect(cellBox(xml, 'khong-co')).toBeNull();
  });

  it('XML hỏng → null, không đọc nửa tài liệu trình duyệt kịp dựng trước chỗ lỗi', () => {
    const broken = model('<mxCell id="f1" vertex="1" parent="1"><mxGeometry x="10" y="20" width="160" as="geometry"/></mxCell>').replace('</root>', '<mxCell id="x">');
    expect(cellBox(broken, 'f1')).toBeNull();
  });
});
