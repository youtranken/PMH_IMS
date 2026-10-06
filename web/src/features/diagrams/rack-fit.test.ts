import { describe, expect, it } from 'vitest';
import { cellPlacement, rackFit, type RackFitDevice } from './rack-fit';

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

  it('kho ghi TỦ KHÁC (máy TU-TOWER-01 thả vào khung TU-TOWER-04) → không đặt theo U, không đổi kho, báo lại', () => {
    const result = rackFit(model(frame('f4', CAB_04) + device('d1', 'UPS-03', 'f4', { y: 228.2, h: 59.2 })), INFO);
    expect(result.updates).toEqual({});
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
    expect(result.noU).toEqual([{ cellId: 'd1', code: 'PC-09' }]);
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
