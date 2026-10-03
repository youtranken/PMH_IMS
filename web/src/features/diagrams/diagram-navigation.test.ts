import { describe, expect, it } from 'vitest';
import type { DiagramContent, PathResult } from './diagram-api';
import { buildLayers, matchOnDrawing, pathOnDrawing } from './diagram-navigation';

const LABELS = { baseLayer: 'Lớp nền', noDeviceType: 'Chưa rõ loại', noCableType: 'Chưa khai loại dây' };

function device(id: string, code: string, extra: Partial<{ name: string; deviceTypeName: string | null; ips: string[] }> = {}) {
  return {
    id,
    found: true,
    code,
    name: extra.name ?? null,
    deviceTypeName: extra.deviceTypeName === undefined ? 'Switch' : extra.deviceTypeName,
    model: null,
    serial: null,
    status: 'in_use',
    ips: extra.ips ?? [],
    siteCode: null,
    cabinetCode: null,
    u: null,
    vendorName: null,
    vendorPhone: null,
    warrantyEnd: null,
    cell: { style: '', label: code, width: 1, height: 1 },
  };
}

function link(id: string, a: string, b: string, cableTypeId: string | null) {
  return {
    id,
    deviceId: a,
    deviceCode: a,
    portLabel: 'p1',
    peerDeviceId: b,
    peerDeviceCode: b,
    peerPort: 'p2',
    cableTypeId,
    vlan: null,
    note: null,
    colorSlot: null,
    labelFromA: '',
    labelFromB: '',
    edgeStyle: '',
  };
}

const CONTENT = {
  diagram: { id: 'D1' },
  version: null,
  deviceCells: [
    { cellId: 'c-sw', deviceId: 'SW', code: 'SW-LOI-E2E' },
    { cellId: 'c-ap', deviceId: 'AP', code: 'AP-E2E-01' },
    { cellId: 'c-fw', deviceId: 'FW', code: 'FW-E2E' },
  ],
  devices: [
    device('SW', 'SW-LOI-E2E', { name: 'Switch lõi tầng 3', ips: ['10.0.0.1'] }),
    device('AP', 'AP-E2E-01', { name: 'Wi-Fi sảnh', deviceTypeName: 'Access point', ips: ['10.0.5.21'] }),
    device('FW', 'FW-E2E', { deviceTypeName: null }),
  ],
  cableEdges: [
    { cellId: 'e1', linkId: 'L1', state: 'linked', sourceDeviceId: 'SW', targetDeviceId: 'AP' },
    { cellId: 'e2', linkId: 'L2', state: 'linked', sourceDeviceId: 'SW', targetDeviceId: 'FW' },
    { cellId: 'e3', linkId: null, state: 'undeclared', sourceDeviceId: 'AP', targetDeviceId: 'FW' },
  ],
  links: [link('L1', 'SW', 'AP', 'CAT6'), link('L2', 'FW', 'SW', null)],
  cableTypes: [{ id: 'CAT6', name: 'Cat6', colorSlot: 1, active: true }],
  layers: [
    { id: '1', name: '' },
    { id: 'L-cam', name: 'Camera' },
  ],
  cells: [
    { id: 'c-sw', kind: 'device', layer: '1', bounds: { x: 0, y: 0, width: 10, height: 10 } },
    { id: 'c-ap', kind: 'device', layer: '1', bounds: null },
    { id: 'c-fw', kind: 'device', layer: '1', bounds: null },
    { id: 'cam1', kind: 'shape', layer: 'L-cam', bounds: null },
    { id: 'e1', kind: 'edge', layer: '1', bounds: null },
  ],
} as unknown as DiagramContent;

describe('buildLayers — mô hình lớp của trình xem', () => {
  it('lớp draw.io (lớp mặc định không tên → "Lớp nền"), nhóm loại thiết bị, nhóm loại dây', () => {
    expect(buildLayers(CONTENT, LABELS)).toEqual([
      { key: 'drawio:1', label: 'Lớp nền', group: 'drawio', cellIds: ['c-sw', 'c-ap', 'c-fw', 'e1'] },
      { key: 'drawio:L-cam', label: 'Camera', group: 'drawio', cellIds: ['cam1'] },
      { key: 'type:Access point', label: 'Access point', group: 'deviceType', cellIds: ['c-ap'] },
      { key: 'type:', label: 'Chưa rõ loại', group: 'deviceType', cellIds: ['c-fw'] },
      { key: 'type:Switch', label: 'Switch', group: 'deviceType', cellIds: ['c-sw'] },
      { key: 'cable:CAT6', label: 'Cat6', group: 'cableType', cellIds: ['e1'] },
      { key: 'cable:', label: 'Chưa khai loại dây', group: 'cableType', cellIds: ['e2', 'e3'] },
    ]);
  });

  it('chỉ một lớp draw.io: không bày nhóm lớp bản vẽ (không có gì để tắt bớt)', () => {
    const single = { ...CONTENT, layers: [{ id: '1', name: '' }] } as DiagramContent;
    expect(buildLayers(single, LABELS).some((l) => l.group === 'drawio')).toBe(false);
  });

  it('nội dung cũ thiếu layers/cells: không lỗi, chỉ còn nhóm theo kho', () => {
    const legacy = { ...CONTENT, layers: undefined, cells: undefined } as DiagramContent;
    expect(buildLayers(legacy, LABELS).map((l) => l.group)).toEqual(['deviceType', 'deviceType', 'deviceType', 'cableType', 'cableType']);
  });
});

describe('matchOnDrawing — ô tìm của trình xem', () => {
  it.each([
    ['mã, không phân biệt hoa thường', 'sw-loi', ['SW']],
    ['tên, gõ không dấu', 'wi-fi sanh', ['AP']],
    ['tên, gõ có dấu', 'lõi', ['SW']],
    ['IP (một phần)', '10.0.5', ['AP']],
    ['khớp nhiều máy', 'e2e', ['SW', 'AP', 'FW']],
    ['không khớp', 'core-xyz', []],
    ['chuỗi trắng', '   ', []],
  ])('%s', (_name, q, expected) => {
    expect(matchOnDrawing(CONTENT, q).map((m) => m.deviceId)).toEqual(expected);
  });

  it('mỗi kết quả mang ô để bay tới', () => {
    expect(matchOnDrawing(CONTENT, '10.0.0.1')).toEqual([{ deviceId: 'SW', cellId: 'c-sw', code: 'SW-LOI-E2E', name: 'Switch lõi tầng 3' }]);
  });
});

describe('pathOnDrawing — đoạn nằm trên bản vẽ đang xem và đoạn ở bản vẽ khác', () => {
  const hop = (deviceId: string, code: string, diagrams: { id: string; name: string }[] = []) => ({ deviceId, code, diagrams });

  it('máy + nét dây trên bản vẽ sáng; máy ngoài bản vẽ thành mũi tên nhảy sang bản vẽ khác', () => {
    const result: PathResult = {
      from: { id: 'AP', code: 'AP-E2E-01' },
      to: { id: 'ISP', code: 'ISP-E2E' },
      path: {
        hops: [hop('AP', 'AP-E2E-01'), hop('SW', 'SW-LOI-E2E'), hop('FW', 'FW-E2E'), hop('ISP', 'ISP-E2E', [{ id: 'D1', name: 'Đây' }, { id: 'D9', name: 'Tổng' }])],
        linkIds: ['L1', 'L2', 'L3'],
      },
    };
    expect(pathOnDrawing(CONTENT, result, 'D1')).toEqual({
      cellIds: ['c-ap', 'c-sw', 'c-fw', 'e1', 'e2'],
      elsewhere: [{ deviceId: 'ISP', code: 'ISP-E2E', diagrams: [{ id: 'D9', name: 'Tổng' }] }],
    });
  });

  it('nét chưa khai giữa hai máy kề nhau trên đường cũng sáng (đường đi theo sơ đồ cổng, nét chỉ là hình)', () => {
    const result: PathResult = {
      from: { id: 'AP', code: 'AP-E2E-01' },
      to: { id: 'FW', code: 'FW-E2E' },
      path: { hops: [hop('AP', 'AP-E2E-01'), hop('FW', 'FW-E2E')], linkIds: ['L-khac'] },
    };
    expect(pathOnDrawing(CONTENT, result, 'D1').cellIds).toEqual(['c-ap', 'c-fw', 'e3']);
  });

  it('không có đường → rỗng', () => {
    expect(pathOnDrawing(CONTENT, { from: { id: 'AP', code: 'A' }, to: { id: 'X', code: 'X' }, path: null }, 'D1')).toEqual({ cellIds: [], elsewhere: [] });
  });
});
