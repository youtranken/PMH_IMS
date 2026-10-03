import { buildCellIndex } from './diagram-cells';
import { checkDevices, runDiagramChecks, type CheckDevice } from './diagram-selfcheck';

const DEV_A = '7b0c1c1e-0000-4000-8000-00000000000a';
const DEV_B = '7b0c1c1e-0000-4000-8000-00000000000b';
const CAB_1 = '7b0c1c1e-0000-4000-8000-0000000000c1';
const CAB_2 = '7b0c1c1e-0000-4000-8000-0000000000c2';

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function device(id: string, deviceId: string, code: string, opts: { x?: number; y?: number; parent?: string } = {}): string {
  return `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="${id}"><mxCell style="shape=mxgraph.cisco.switches.workgroup_switch;" vertex="1" parent="${opts.parent ?? '1'}"><mxGeometry x="${opts.x ?? 0}" y="${opts.y ?? 0}" width="100" height="40" as="geometry"/></mxCell></UserObject>`;
}

function cabinetFrame(id: string, cabinetId: string, label: string, box = { x: 0, y: 0, width: 400, height: 600 }): string {
  return `<UserObject label="${label}" ims_cabinet_id="${cabinetId}" id="${id}"><mxCell style="shape=mxgraph.rackGeneral.container;container=1;" vertex="1" parent="1"><mxGeometry x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" as="geometry"/></mxCell></UserObject>`;
}

function dev(id: string, code: string, extra: Partial<CheckDevice> = {}): [string, CheckDevice] {
  return [id, { id, code, status: 'in_use', cabinetId: null, ...extra }];
}

describe('checkDevices — luật thiết bị của tự kiểm (AD-18, Q-23)', () => {
  const cases: {
    name: string;
    body: string;
    devices: [string, CheckDevice][];
    expected: { level: 'error' | 'warning'; code: string; cellId: string | null }[];
  }[] = [
    {
      name: 'máy còn trong kho, không khung tủ → không gì',
      body: device('d1', DEV_A, 'SW-01'),
      devices: [dev(DEV_A, 'SW-01')],
      expected: [],
    },
    {
      name: 'ims_device_id không còn trong kho → ĐỎ',
      body: device('d1', DEV_A, 'SW-01'),
      devices: [],
      expected: [{ level: 'error', code: 'DEVICE_MISSING', cellId: 'd1' }],
    },
    {
      name: 'ims_device_id không phải UUID → ĐỎ (dữ liệu không tin cậy)',
      body: device('d1', 'not-a-uuid', 'SW-01'),
      devices: [],
      expected: [{ level: 'error', code: 'DEVICE_MISSING', cellId: 'd1' }],
    },
    {
      name: 'máy đã thanh lý → ĐỎ (Q-23)',
      body: device('d1', DEV_A, 'SW-01'),
      devices: [dev(DEV_A, 'SW-01', { status: 'retired' })],
      expected: [{ level: 'error', code: 'DEVICE_RETIRED', cellId: 'd1' }],
    },
    {
      name: 'máy hỏng chờ sửa vẫn qua',
      body: device('d1', DEV_A, 'SW-01'),
      devices: [dev(DEV_A, 'SW-01', { status: 'broken' })],
      expected: [],
    },
    {
      name: 'ô con của khung tủ khác tủ trong kho → VÀNG',
      body: cabinetFrame('f1', CAB_1, 'Tủ R1') + device('d1', DEV_A, 'SW-01', { parent: 'f1' }),
      devices: [dev(DEV_A, 'SW-01', { cabinetId: CAB_2 })],
      expected: [{ level: 'warning', code: 'DEVICE_CABINET_MISMATCH', cellId: 'd1' }],
    },
    {
      name: 'ô con của khung tủ đúng tủ trong kho → không gì',
      body: cabinetFrame('f1', CAB_1, 'Tủ R1') + device('d1', DEV_A, 'SW-01', { parent: 'f1' }),
      devices: [dev(DEV_A, 'SW-01', { cabinetId: CAB_1 })],
      expected: [],
    },
    {
      name: 'máy nằm gọn trong khung tủ (cùng lớp, không là ô con) mà kho chưa gắn tủ → VÀNG',
      body: cabinetFrame('f1', CAB_1, 'Tủ R1') + device('d1', DEV_A, 'SW-01', { x: 50, y: 50 }),
      devices: [dev(DEV_A, 'SW-01')],
      expected: [{ level: 'warning', code: 'DEVICE_CABINET_MISMATCH', cellId: 'd1' }],
    },
    {
      name: 'máy nằm ngoài khung tủ → không gì',
      body: cabinetFrame('f1', CAB_1, 'Tủ R1') + device('d1', DEV_A, 'SW-01', { x: 900, y: 50 }),
      devices: [dev(DEV_A, 'SW-01', { cabinetId: CAB_2 })],
      expected: [],
    },
    {
      name: 'máy thanh lý trong khung sai tủ: chỉ báo đỏ, không chồng thêm vàng',
      body: cabinetFrame('f1', CAB_1, 'Tủ R1') + device('d1', DEV_A, 'SW-01', { parent: 'f1' }),
      devices: [dev(DEV_A, 'SW-01', { status: 'retired', cabinetId: CAB_2 })],
      expected: [{ level: 'error', code: 'DEVICE_RETIRED', cellId: 'd1' }],
    },
    {
      name: 'hai máy, một thiếu một thanh lý → hai lỗi theo thứ tự ô',
      body: device('d1', DEV_A, 'SW-01') + device('d2', DEV_B, 'SW-02', { x: 300 }),
      devices: [dev(DEV_B, 'SW-02', { status: 'retired' })],
      expected: [
        { level: 'error', code: 'DEVICE_MISSING', cellId: 'd1' },
        { level: 'error', code: 'DEVICE_RETIRED', cellId: 'd2' },
      ],
    },
  ];

  it.each(cases)('$name', ({ body, devices, expected }) => {
    const findings = checkDevices(buildCellIndex(page(body)).cells, new Map(devices));
    expect(findings.map(({ level, code, cellId }) => ({ level, code, cellId }))).toEqual(expected);
    for (const finding of findings) expect(finding.message).toMatch(/[ạảãáàâăêôơưđ]/i);
  });

  it('câu báo nêu mã thiết bị ghi trên ô (người sửa tìm được hình)', () => {
    const [finding] = checkDevices(buildCellIndex(page(device('d1', DEV_A, 'SW-01'))).cells, new Map());
    expect(finding.message).toContain('SW-01');
  });
});

describe('runDiagramChecks — tách đỏ chặn / vàng cho qua', () => {
  it('gom lỗi và cảnh báo của mọi bộ luật', () => {
    const index = buildCellIndex(
      page(cabinetFrame('f1', CAB_1, 'Tủ R1') + device('d1', DEV_A, 'SW-01', { parent: 'f1' }) + device('d2', DEV_B, 'SW-02', { x: 900 })),
    );
    const result = runDiagramChecks({
      index,
      devices: new Map([dev(DEV_A, 'SW-01', { cabinetId: CAB_2 }), dev(DEV_B, 'SW-02', { status: 'retired' })]),
      links: new Map(),
    });
    expect(result.errors.map((f) => f.code)).toEqual(['DEVICE_RETIRED']);
    expect(result.warnings.map((f) => f.code)).toEqual(['DEVICE_CABINET_MISMATCH']);
  });

  it('bản vẽ sạch → không lỗi, không cảnh báo', () => {
    const result = runDiagramChecks({ index: buildCellIndex(page(device('d1', DEV_A, 'SW-01'))), devices: new Map([dev(DEV_A, 'SW-01')]), links: new Map() });
    expect(result).toEqual({ errors: [], warnings: [] });
  });
});
