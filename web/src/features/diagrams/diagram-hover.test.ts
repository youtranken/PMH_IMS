import { describe, expect, it } from 'vitest';
import type { DiagramContent, DiagramDeviceInfo, DiagramLink } from './diagram-api';
import { cableHoverData, deviceHoverData, focusCells, hoverCardOf, hoverHighlight, hoverTarget, selectedTarget } from './diagram-hover';

function device(over: Partial<DiagramDeviceInfo> = {}): DiagramDeviceInfo {
  return {
    id: 'dev-sw',
    found: true,
    code: 'SW-01',
    name: 'Switch tầng 3',
    deviceTypeName: 'Switch',
    model: 'C9200-24T',
    serial: null,
    status: 'in_use',
    ips: ['10.0.0.2', '10.0.1.2'],
    siteCode: 'HQ',
    cabinetCode: 'TU-01',
    u: 30,
    uSize: 2,
    vendorName: null,
    vendorPhone: null,
    warrantyEnd: null,
    ports: { used: 12, declared: 24 },
    cell: { style: '', label: '', width: 1, height: 1 },
    ...over,
  };
}

const LINK: DiagramLink = {
  id: 'link-1',
  deviceId: 'dev-sw',
  deviceCode: 'SW-01',
  portLabel: 'Gi1/0/1',
  peerDeviceId: 'dev-srv',
  peerDeviceCode: 'SRV-01',
  peerPort: 'eth0',
  cableTypeId: 'ct-fiber',
  vlan: null,
  note: null,
  colorSlot: 2,
  labelFromA: 'Gi1/0/1 ↔ eth0',
  labelFromB: 'eth0 ↔ Gi1/0/1',
  edgeStyle: '',
  endLabel: { style: '', offset: 0.75 },
};

const CONTENT = {
  deviceCells: [
    { cellId: 'a', deviceId: 'dev-sw', code: 'SW-01' },
    { cellId: 'b', deviceId: 'dev-srv', code: 'SRV-01' },
    { cellId: 'c', deviceId: 'dev-ap', code: 'AP-01' },
  ],
  cableEdges: [
    { cellId: 'e1', linkId: 'link-1', state: 'linked', sourceDeviceId: 'dev-sw', targetDeviceId: 'dev-srv' },
    { cellId: 'e2', linkId: null, state: 'undeclared', sourceDeviceId: 'dev-sw', targetDeviceId: 'dev-ap' },
  ],
  links: [LINK],
  devices: [device()],
  cableTypes: [{ id: 'ct-fiber', name: 'Fiber', colorSlot: 2, active: true }],
} as unknown as DiagramContent;

describe('deviceHoverData — thẻ rê chuột của máy (Q-23 06/10)', () => {
  it('đủ dòng: IP, model, vị trí (site · tủ · U), cổng đang dùng / đã khai, trạng thái', () => {
    expect(deviceHoverData(device(), 'SW-01')).toEqual({
      kind: 'device',
      title: 'SW-01',
      deviceId: 'dev-sw',
      rows: [
        { key: 'ip', value: '10.0.0.2, 10.0.1.2' },
        { key: 'model', value: 'C9200-24T' },
        { key: 'location', value: 'HQ · TU-01 · U30–U31' },
        { key: 'ports', value: '12/24' },
        { key: 'status', value: 'in_use' },
      ],
    });
  });

  it.each([
    ['máy chưa có IP / model / vị trí → bỏ dòng trống', device({ ips: [], model: null, siteCode: null, cabinetCode: null, u: null }), ['ports', 'status']],
    ['chưa khai cổng nào → vẫn nói 0/0', device({ ports: { used: 0, declared: 0 }, ips: [], model: null, siteCode: null, cabinetCode: null, u: null }), ['ports', 'status']],
  ])('%s', (_name, info, keys) => {
    expect(deviceHoverData(info, 'SW-01').rows.map((r) => r.key)).toEqual(keys);
  });

  it('máy không còn trong kho → thẻ báo thiếu, theo mã ghi trên ô', () => {
    expect(deviceHoverData(null, 'PC-CU')).toEqual({ kind: 'device', title: 'PC-CU', deviceId: null, missing: true, rows: [] });
    expect(deviceHoverData(device({ found: false }), 'PC-CU')).toMatchObject({ missing: true, title: 'PC-CU' });
  });
});

describe('cableHoverData — thẻ rê chuột của dây', () => {
  it('dây đã khai: "A máy:cổng ↔ B máy:cổng", loại dây, trạng thái', () => {
    expect(cableHoverData(CONTENT.cableEdges![0], LINK, CONTENT.cableTypes ?? [])).toEqual({
      kind: 'cable',
      title: 'SW-01:Gi1/0/1 ↔ SRV-01:eth0',
      deviceId: null,
      rows: [
        { key: 'cableType', value: 'Fiber' },
        { key: 'state', value: 'linked' },
      ],
    });
  });

  it('nét chưa khai: không có tiêu đề cổng, chỉ trạng thái', () => {
    expect(cableHoverData(CONTENT.cableEdges![1], null, [])).toEqual({ kind: 'cable', title: null, deviceId: null, rows: [{ key: 'state', value: 'undeclared' }] });
  });
});

describe('hoverTarget / hoverHighlight — rê lên ô nào thì sáng gì', () => {
  it.each([
    ['ô máy', 'a', { kind: 'device', deviceId: 'dev-sw', code: 'SW-01' }],
    ['nét dây', 'e1', { kind: 'cable', edgeId: 'e1' }],
    ['nhãn cổng ở đầu dây = chính dây đó', 'e1-ims-pt', { kind: 'cable', edgeId: 'e1' }],
    ['hình tự do', 'zz', null],
  ])('%s', (_name, cellId, expected) => {
    expect(hoverTarget(CONTENT, cellId)).toEqual(expected);
  });

  it('rê lên dây: cả dây (kể cả hai nhãn đầu) + hai máy hai đầu sáng', () => {
    expect(hoverHighlight(CONTENT, 'e1')).toEqual(['e1', 'e1-ims-ps', 'e1-ims-pt', 'a', 'b']);
  });

  it('rê lên máy: như bấm máy — máy, mọi dây của nó, máy đầu kia', () => {
    expect(hoverHighlight(CONTENT, 'a')).toEqual(focusCells(CONTENT, 'dev-sw'));
    expect(focusCells(CONTENT, 'dev-sw')).toEqual(['a', 'e1', 'e1-ims-ps', 'e1-ims-pt', 'e2', 'e2-ims-ps', 'e2-ims-pt', 'b', 'c']);
  });

  it('ô không phải máy / dây → không tô gì', () => {
    expect(hoverHighlight(CONTENT, 'zz')).toBeNull();
  });
});

describe('hoverCardOf — thẻ của ô đang rê trong tab Xem', () => {
  it.each([
    ['máy có trong kho', 'a', 'SW-01', 'device'],
    ['máy không còn trong kho (không có trong devices) → thẻ thiếu theo mã ô', 'b', 'SRV-01', 'device'],
    ['nhãn đầu dây → thẻ của dây', 'e1-ims-ps', 'SW-01:Gi1/0/1 ↔ SRV-01:eth0', 'cable'],
    ['nét chưa khai', 'e2', null, 'cable'],
  ])('%s', (_name, cellId, title, kind) => {
    expect(hoverCardOf(CONTENT, cellId)).toMatchObject({ title, kind });
  });

  it('hình tự do → không thẻ', () => {
    expect(hoverCardOf(CONTENT, 'zz')).toBeNull();
  });
});

describe('selectedTarget — ô đang chọn trong trình vẽ → thẻ của máy / dây nào', () => {
  it.each([
    ['một máy', [{ id: 'a', kind: 'node' as const, deviceId: 'dev-sw', code: 'SW-01' }], { kind: 'device', cellId: 'a', deviceId: 'dev-sw', code: 'SW-01' }],
    ['một dây đã khai', [{ id: 'e1', kind: 'edge' as const, linkId: 'link-1' }], { kind: 'cable', cellId: 'e1', linkId: 'link-1' }],
    ['không chọn gì', [], null],
    ['chọn nhiều ô', [{ id: 'a', kind: 'node' as const, deviceId: 'dev-sw' }, { id: 'b', kind: 'node' as const, deviceId: 'dev-srv' }], null],
    ['hình tự do', [{ id: 's', kind: 'node' as const }], null],
    ['nét tự do', [{ id: 'f', kind: 'edge' as const }], null],
  ])('%s', (_name, selection, expected) => {
    expect(selectedTarget(selection)).toEqual(expected);
  });
});
