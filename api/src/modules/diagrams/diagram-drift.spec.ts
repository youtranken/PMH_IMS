import { buildCellIndex } from './diagram-cells';
import { checkDrift, DRIFT_CODES, type DriftDevice, type DriftInput } from './diagram-drift';
import type { CheckLink } from './diagram-finding';
import type { DeviceSnapshotEntry } from './diagram.schema';

const DEV_A = '7b0c1c1e-0000-4000-8000-00000000000a';
const DEV_B = '7b0c1c1e-0000-4000-8000-00000000000b';
const DEV_C = '7b0c1c1e-0000-4000-8000-00000000000c';
const LINK_1 = '7b0c1c1e-0000-4000-8000-0000000000e1';
const LINK_2 = '7b0c1c1e-0000-4000-8000-0000000000e2';
const CAB_1 = '7b0c1c1e-0000-4000-8000-0000000000c1';

function page(body: string): string {
  return `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
}

function device(id: string, deviceId: string, code: string, parent = '1'): string {
  return `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="${id}"><mxCell vertex="1" parent="${parent}"><mxGeometry x="0" y="0" width="100" height="40" as="geometry"/></mxCell></UserObject>`;
}

function edge(id: string, source: string, target: string, linkId?: string): string {
  const cell = `<mxCell edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
  return linkId ? `<UserObject label="" ims_link_id="${linkId}" id="${id}">${cell}</UserObject>` : cell.replace('<mxCell ', `<mxCell id="${id}" `);
}

function cabinetFrame(id: string, cabinetId: string, label: string): string {
  return `<UserObject label="${label}" ims_cabinet_id="${cabinetId}" id="${id}"><mxCell style="container=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="400" height="600" as="geometry"/></mxCell></UserObject>`;
}

function now(id: string, code: string, extra: Partial<DriftDevice> = {}): [string, DriftDevice] {
  return [id, { id, code, status: 'in_use', cabinetId: null, ips: [], siteCode: 'HCM', cabinetCode: null, u: null, ...extra }];
}

function snap(id: string, code: string, extra: Partial<DeviceSnapshotEntry> = {}): DeviceSnapshotEntry {
  return { id, code, ips: [], site: 'HCM', cabinet: null, u: null, status: 'in_use', ...extra };
}

function link(id: string, a: string, b: string, portA: string, portB: string | null): CheckLink {
  return { id, deviceA: a, deviceB: b, cableTypeId: null, portA, portB };
}

function input(body: string, parts: Partial<Omit<DriftInput, 'index'>> = {}): DriftInput {
  return {
    index: buildCellIndex(page(body)),
    snapshot: parts.snapshot ?? [],
    devices: parts.devices ?? new Map(),
    links: parts.links ?? new Map(),
    touching: parts.touching ?? [],
    cabinetDevices: parts.cabinetDevices ?? new Map(),
  };
}

type Row = { code: string; cellId: string | null; level: 'error' | 'warning' };
const brief = (findings: ReturnType<typeof checkDrift>): Row[] => findings.map(({ code, cellId, level }) => ({ code, cellId, level }));

describe('checkDrift — lệch kho của một phiên bản (Q-23, AD-18)', () => {
  const twoDevices = device('d1', DEV_A, 'SW-01') + device('d2', DEV_B, 'SRV-01');

  const cases: { name: string; input: DriftInput; expected: Row[] }[] = [
    {
      name: 'kho y như lúc vẽ → không lệch',
      input: input(twoDevices, {
        snapshot: [snap(DEV_A, 'SW-01', { ips: ['10.0.1.5'] }), snap(DEV_B, 'SRV-01')],
        devices: new Map([now(DEV_A, 'SW-01', { ips: ['10.0.1.5'] }), now(DEV_B, 'SRV-01')]),
      }),
      expected: [],
    },
    {
      name: 'máy thanh lý sau khi vẽ → đỏ, dùng luật tự kiểm (DEVICE_RETIRED)',
      input: input(device('d1', DEV_A, 'SW-01'), {
        snapshot: [snap(DEV_A, 'SW-01')],
        devices: new Map([now(DEV_A, 'SW-01', { status: 'retired' })]),
      }),
      expected: [{ code: 'DEVICE_RETIRED', cellId: 'd1', level: 'error' }],
    },
    {
      name: 'máy không còn trong kho → đỏ (DEVICE_MISSING), không báo thêm IP/vị trí',
      input: input(device('d1', DEV_A, 'SW-01'), { snapshot: [snap(DEV_A, 'SW-01', { ips: ['10.0.1.5'] })] }),
      expected: [{ code: 'DEVICE_MISSING', cellId: 'd1', level: 'error' }],
    },
    {
      name: 'đổi IP → vàng trên ô máy',
      input: input(device('d1', DEV_A, 'SW-01'), {
        snapshot: [snap(DEV_A, 'SW-01', { ips: ['10.0.1.5'] })],
        devices: new Map([now(DEV_A, 'SW-01', { ips: ['10.0.1.9'] })]),
      }),
      expected: [{ code: 'DRIFT_IP', cellId: 'd1', level: 'warning' }],
    },
    {
      name: 'cùng bộ IP, khác thứ tự → không lệch',
      input: input(device('d1', DEV_A, 'SW-01'), {
        snapshot: [snap(DEV_A, 'SW-01', { ips: ['10.0.1.5', '10.0.2.5'] })],
        devices: new Map([now(DEV_A, 'SW-01', { ips: ['10.0.2.5', '10.0.1.5'] })]),
      }),
      expected: [],
    },
    {
      name: 'đổi tủ → vàng (DRIFT_LOCATION)',
      input: input(device('d1', DEV_A, 'SW-01'), {
        snapshot: [snap(DEV_A, 'SW-01', { cabinet: 'R1' })],
        devices: new Map([now(DEV_A, 'SW-01', { cabinetCode: 'R2' })]),
      }),
      expected: [{ code: 'DRIFT_LOCATION', cellId: 'd1', level: 'warning' }],
    },
    {
      name: 'đổi site và U cũng là đổi vị trí — một lời báo',
      input: input(device('d1', DEV_A, 'SW-01'), {
        snapshot: [snap(DEV_A, 'SW-01', { site: 'HCM', u: 10 })],
        devices: new Map([now(DEV_A, 'SW-01', { siteCode: 'HN', u: 12 })]),
      }),
      expected: [{ code: 'DRIFT_LOCATION', cellId: 'd1', level: 'warning' }],
    },
    {
      name: 'phiên bản không có bản chụp của máy (bản cũ) → không đoán IP/vị trí',
      input: input(device('d1', DEV_A, 'SW-01'), { devices: new Map([now(DEV_A, 'SW-01', { ips: ['10.0.1.9'] })]) }),
      expected: [],
    },
    {
      name: 'bản chụp ghi máy đã mất lúc lưu → không so IP/vị trí',
      input: input(device('d1', DEV_A, 'SW-01'), {
        snapshot: [{ id: DEV_A, missing: true }],
        devices: new Map([now(DEV_A, 'SW-01', { ips: ['10.0.1.9'] })]),
      }),
      expected: [],
    },
    {
      name: 'dây gắn kết nối đã bị gỡ → đỏ (luật dây CABLE_LINK_MISSING)',
      input: input(twoDevices + edge('e1', 'd1', 'd2', LINK_1), {
        snapshot: [snap(DEV_A, 'SW-01'), snap(DEV_B, 'SRV-01')],
        devices: new Map([now(DEV_A, 'SW-01'), now(DEV_B, 'SRV-01')]),
      }),
      expected: [{ code: 'CABLE_LINK_MISSING', cellId: 'e1', level: 'error' }],
    },
    {
      name: 'dây gắn kết nối đã đổi đầu sang máy khác → đỏ (CABLE_LINK_ENDS_MISMATCH)',
      input: input(twoDevices + edge('e1', 'd1', 'd2', LINK_1), {
        snapshot: [snap(DEV_A, 'SW-01'), snap(DEV_B, 'SRV-01')],
        devices: new Map([now(DEV_A, 'SW-01'), now(DEV_B, 'SRV-01')]),
        links: new Map([[LINK_1, link(LINK_1, DEV_A, DEV_C, 'Gi0/1', 'eth0')]]),
      }),
      expected: [{ code: 'CABLE_LINK_ENDS_MISMATCH', cellId: 'e1', level: 'error' }],
    },
    {
      name: 'dây chưa khai (Chỉ vẽ) là lựa chọn của người vẽ, không phải lệch kho',
      input: input(twoDevices + edge('e1', 'd1', 'd2'), {
        snapshot: [snap(DEV_A, 'SW-01'), snap(DEV_B, 'SRV-01')],
        devices: new Map([now(DEV_A, 'SW-01'), now(DEV_B, 'SRV-01')]),
      }),
      expected: [],
    },
    {
      name: 'đổi cổng một đầu dây → vàng trên nét (DRIFT_PORT)',
      input: input(twoDevices + edge('e1', 'd1', 'd2', LINK_1), {
        snapshot: [snap(DEV_A, 'SW-01', { ports: { [LINK_1]: 'Gi0/1' } }), snap(DEV_B, 'SRV-01', { ports: { [LINK_1]: 'eth0' } })],
        devices: new Map([now(DEV_A, 'SW-01'), now(DEV_B, 'SRV-01')]),
        links: new Map([[LINK_1, link(LINK_1, DEV_A, DEV_B, 'Gi0/2', 'eth0')]]),
      }),
      expected: [{ code: 'DRIFT_PORT', cellId: 'e1', level: 'warning' }],
    },
    {
      name: 'cổng như lúc vẽ → không lệch; dây vẽ ngược chiều bản ghi vẫn đúng',
      input: input(twoDevices + edge('e1', 'd2', 'd1', LINK_1), {
        snapshot: [snap(DEV_A, 'SW-01', { ports: { [LINK_1]: 'Gi0/1' } }), snap(DEV_B, 'SRV-01', { ports: { [LINK_1]: '' } })],
        devices: new Map([now(DEV_A, 'SW-01'), now(DEV_B, 'SRV-01')]),
        links: new Map([[LINK_1, link(LINK_1, DEV_A, DEV_B, 'Gi0/1', null)]]),
      }),
      expected: [],
    },
    {
      name: 'bản chụp chưa có cổng của dây (bản cũ) → không đoán đổi cổng',
      input: input(twoDevices + edge('e1', 'd1', 'd2', LINK_1), {
        snapshot: [snap(DEV_A, 'SW-01'), snap(DEV_B, 'SRV-01')],
        devices: new Map([now(DEV_A, 'SW-01'), now(DEV_B, 'SRV-01')]),
        links: new Map([[LINK_1, link(LINK_1, DEV_A, DEV_B, 'Gi0/2', 'eth0')]]),
      }),
      expected: [],
    },
    {
      name: 'kết nối giữa hai máy cùng trên bản vẽ mà chưa vẽ → vàng trên ô máy đầu A (DRIFT_UNDRAWN_LINK)',
      input: input(twoDevices, {
        snapshot: [snap(DEV_A, 'SW-01'), snap(DEV_B, 'SRV-01')],
        devices: new Map([now(DEV_A, 'SW-01'), now(DEV_B, 'SRV-01')]),
        touching: [link(LINK_2, DEV_B, DEV_A, 'eth1', 'Gi0/9')],
      }),
      expected: [{ code: 'DRIFT_UNDRAWN_LINK', cellId: 'd2', level: 'warning' }],
    },
    {
      name: 'kết nối có một đầu ngoài bản vẽ → không phải lệch (mũi tên sang bản vẽ khác)',
      input: input(device('d1', DEV_A, 'SW-01'), {
        snapshot: [snap(DEV_A, 'SW-01')],
        devices: new Map([now(DEV_A, 'SW-01')]),
        touching: [link(LINK_2, DEV_A, DEV_C, 'Gi0/9', 'eth0')],
      }),
      expected: [],
    },
    {
      name: 'máy mới gắn vào tủ có khung trên bản vẽ → vàng trên khung (DRIFT_CABINET_NEW_DEVICE)',
      input: input(cabinetFrame('f1', CAB_1, 'Tủ R1') + device('d1', DEV_A, 'SW-01', 'f1'), {
        snapshot: [snap(DEV_A, 'SW-01')],
        devices: new Map([now(DEV_A, 'SW-01', { cabinetId: CAB_1 })]),
        cabinetDevices: new Map([[CAB_1, [{ id: DEV_A, code: 'SW-01' }, { id: DEV_C, code: 'SRV-09' }]]]),
      }),
      expected: [{ code: 'DRIFT_CABINET_NEW_DEVICE', cellId: 'f1', level: 'warning' }],
    },
  ];

  it.each(cases)('$name', ({ input: given, expected }) => {
    expect(brief(checkDrift(given))).toEqual(expected);
  });

  it('lời báo nói rõ cái gì đổi: "IP 10.0.1.5 → 10.0.1.9"', () => {
    const [finding] = checkDrift(
      input(device('d1', DEV_A, 'SW-01'), {
        snapshot: [snap(DEV_A, 'SW-01', { ips: ['10.0.1.5'] })],
        devices: new Map([now(DEV_A, 'SW-01', { ips: ['10.0.1.9'] })]),
      }),
    );
    expect(finding.message).toBe('Thiết bị SW-01: IP 10.0.1.5 → 10.0.1.9');
  });

  it('lời báo vị trí và cổng đọc được cả hai phía', () => {
    const [location] = checkDrift(
      input(device('d1', DEV_A, 'SW-01'), {
        snapshot: [snap(DEV_A, 'SW-01', { cabinet: 'R1' })],
        devices: new Map([now(DEV_A, 'SW-01', { cabinetCode: 'R2' })]),
      }),
    );
    expect(location.message).toBe('Thiết bị SW-01: vị trí HCM · R1 → HCM · R2');
    const [port] = checkDrift(
      input(twoDevices + edge('e1', 'd1', 'd2', LINK_1), {
        snapshot: [snap(DEV_A, 'SW-01', { ports: { [LINK_1]: 'Gi0/1' } }), snap(DEV_B, 'SRV-01', { ports: { [LINK_1]: 'eth0' } })],
        devices: new Map([now(DEV_A, 'SW-01'), now(DEV_B, 'SRV-01')]),
        links: new Map([[LINK_1, link(LINK_1, DEV_A, DEV_B, 'Gi0/2', 'eth0')]]),
      }),
    );
    expect(port.message).toBe('Dây SW-01 ↔ SRV-01: cổng Gi0/1 ↔ eth0 → Gi0/2 ↔ eth0');
  });

  it('IP rỗng hai phía đọc thành "(không có)"', () => {
    const [finding] = checkDrift(
      input(device('d1', DEV_A, 'SW-01'), {
        snapshot: [snap(DEV_A, 'SW-01', { ips: ['10.0.1.5'] })],
        devices: new Map([now(DEV_A, 'SW-01', { ips: [] })]),
      }),
    );
    expect(finding.message).toBe('Thiết bị SW-01: IP 10.0.1.5 → (không có)');
  });

  it('một máy có hai ô trên bản vẽ → mỗi ô một dấu', () => {
    const found = checkDrift(
      input(device('d1', DEV_A, 'SW-01') + device('d9', DEV_A, 'SW-01'), {
        snapshot: [snap(DEV_A, 'SW-01', { ips: ['10.0.1.5'] })],
        devices: new Map([now(DEV_A, 'SW-01', { ips: ['10.0.1.9'] })]),
      }),
    );
    expect(found.map((f) => f.cellId)).toEqual(['d1', 'd9']);
  });

  it('mọi mã trả về nằm trong DRIFT_CODES (danh sách web dịch/lọc theo)', () => {
    const all = cases.flatMap((c) => checkDrift(c.input).map((f) => f.code));
    for (const code of all) expect(DRIFT_CODES).toContain(code);
  });
});
