import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, pickMenuItem, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import type { DiagramFrame, DiagramNode, SubnetSummary } from './diagram-api';
import { DiagramScreen } from './diagram-screen';
import { CabinetPicker } from './cabinet-picker';
import { FrameBindDialog } from './frame-bind-dialog';
import type { FrameCandidate } from './frame-bridge';

/**
 * Khung bản vẽ con, khung VLAN, khung tủ (FR-039, AD-18): bấm khung xuống bản vẽ con, thanh đường
 * dẫn bấm lên, thẻ VLAN, hộp "Gắn khung" chỉ mời bản vẽ nằm dưới, "Chèn tủ" dựng khung từ kho.
 */

const ME = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;

function node(id: string, parentId: string | null, name: string, extra: Partial<DiagramNode> = {}): DiagramNode {
  return {
    id,
    parentId,
    name,
    nodeType: 'floor',
    siteId: null,
    cabinetId: null,
    ownerEmail: null,
    kind: 'official',
    archivedAt: null,
    status: 'draft',
    latestVersion: null,
    ...extra,
  };
}

const ROOT = node('d1', null, 'Tổng E2E');
const TOWER = node('d2', 'd1', 'Tower E2E');
const FLOOR = node('d3', 'd2', 'Tầng 3 E2E');
const TREE = [ROOT, TOWER, FLOOR];
const VERSION = { id: 'v1', seq: 1, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><g data-cell-id="0"><g data-cell-id="1">' +
  '<g data-cell-id="f-child"><rect width="10" height="10"/><text>Tower</text></g>' +
  '<g data-cell-id="f-old"><rect width="10" height="10"/><text>Kho cũ</text></g>' +
  '<g data-cell-id="f-vlan"><rect width="10" height="10"/><text>VLAN 10</text></g>' +
  '</g></g></svg>';

const frame = (cellId: string, label: string, extra: Partial<DiagramFrame>): DiagramFrame => ({
  cellId,
  label,
  childDiagramId: null,
  subnetId: null,
  cabinetId: null,
  child: null,
  ...extra,
});

const FRAMES: DiagramFrame[] = [
  frame('f-child', 'Tower', { childDiagramId: 'd2', child: { id: 'd2', name: 'Tower E2E', archived: false, kind: 'official' } }),
  frame('f-old', 'Kho cũ', { childDiagramId: 'd9', child: { id: 'd9', name: 'Kho cũ E2E', archived: true, kind: 'official' } }),
  frame('f-vlan', 'VLAN 10', { subnetId: 'sn-1' }),
];

const SUBNET: SubnetSummary = {
  id: 'sn-1',
  name: 'VLAN 10 E2E',
  cidr: '10.99.0.0/29',
  vlan: 10,
  siteCode: 'E2E-KH',
  gateway: '10.99.0.1',
  voided: true,
  total: 6,
  used: 2,
  free: 4,
  firstFree: ['10.99.0.2', '10.99.0.4'],
};

/** Khớp ĐÚNG đường dẫn (bỏ query): `/api/v1/diagrams` (cây) không được nuốt `/api/v1/diagrams/d1`. */
function routeFetch(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://ims.test').pathname;
    const hit = routes[path];
    return Promise.resolve(hit ? hit() : jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function viewRoutes(id: string, diagram: DiagramNode, frames: DiagramFrame[] = []): Record<string, () => Response> {
  return {
    [`/api/v1/diagrams/${id}/content`]: () => jsonResponse(200, { diagram, version: { ...VERSION, xml: '<mxfile/>', svg: SVG }, frames }),
    [`/api/v1/diagrams/${id}`]: () => jsonResponse(200, diagram),
  };
}

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '/diagrams/:id', element: <DiagramScreen me={ME} /> }], { initialEntries: [path] });
  renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </ToastProvider>,
  );
  return router;
}

beforeEach(() => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
afterEach(() => vi.unstubAllGlobals());

describe('Chế độ xem — khung bản vẽ con, thanh đường dẫn, khung VLAN', () => {
  const routes = {
    '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
    '/api/v1/diagrams': () => jsonResponse(200, TREE),
    ...viewRoutes('d1', ROOT, FRAMES),
    ...viewRoutes('d2', TOWER),
    '/api/v1/diagrams/subnet-info/sn-1': () => jsonResponse(200, SUBNET),
  };

  it('bấm khung bản vẽ con → mở bản vẽ con; thanh đường dẫn của nó bấm lên được bản vẽ cha', async () => {
    routeFetch(routes);
    const router = renderAt('/diagrams/d1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Mở bản vẽ con "Tower E2E"' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tower E2E' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/diagrams/d2');

    const crumbs = await screen.findByRole('navigation', { name: 'Đường dẫn bản vẽ' });
    expect(within(crumbs).getByRole('link', { name: 'Cây bản vẽ' })).toHaveAttribute('href', '/diagrams');
    await user.click(await within(crumbs).findByRole('link', { name: 'Tổng E2E' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Tổng E2E' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/diagrams/d1');
  });

  it('bản vẽ con đã lưu trữ: khung mang dấu vàng, bấm chỉ báo — không rời trang', async () => {
    routeFetch(routes);
    const router = renderAt('/diagrams/d1');
    const archived = await screen.findByRole('button', { name: 'Kho cũ E2E (đã lưu trữ)' });
    expect(archived).toHaveAttribute('data-ims-mark', 'warn');
    await userEvent.setup().click(archived);
    expect(await screen.findByText(/Bản vẽ con "Kho cũ E2E" đã lưu trữ/)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/diagrams/d1');
  });

  it('bấm khung VLAN → thẻ dải: CIDR + "(ngừng dùng)", VLAN, site, đã cấp / còn trống, IP trống đầu', async () => {
    routeFetch(routes);
    renderAt('/diagrams/d1');
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Khung VLAN VLAN 10' }));
    const card = await screen.findByRole('dialog', { name: 'Dải 10.99.0.0/29 (ngừng dùng)' });
    expect(card).toHaveTextContent('VLAN 10 E2E');
    expect(card).toHaveTextContent('E2E-KH');
    expect(card).toHaveTextContent('2 đã cấp / 4 còn trống (tổng 6)');
    expect(card).toHaveTextContent('10.99.0.2, 10.99.0.4');
    expect(within(card).getByRole('link', { name: 'Mở dải IP' })).toHaveAttribute('href', '/ip-addresses/sn-1');
  });
});

describe('Hộp "Gắn khung"', () => {
  const frames: FrameCandidate[] = [
    { id: 's1', label: 'Tầng 3', childDiagramId: null, subnetId: null, cabinetId: null, attrs: { label: 'Tầng 3' } },
    { id: 's2', label: '', childDiagramId: 'd3', subnetId: null, cabinetId: null, attrs: { ims_child_diagram_id: 'd3' } },
  ];
  const tree = [
    ROOT,
    TOWER,
    FLOOR,
    node('d4', 'd2', 'Trình bày E2E', { kind: 'presentation' }),
    node('d5', null, 'Nhánh khác E2E'),
  ];

  function renderDialog(onBind = vi.fn()) {
    routeFetch({ '/api/v1/diagrams': () => jsonResponse(200, tree), '/api/v1/ipam/subnets': () => jsonResponse(200, [{ id: 'sn-1', name: 'LAN E2E', cidr: '10.1.0.0/24', vlan: 20 }]) });
    renderWithI18n(<FrameBindDialog diagramId="d2" frames={frames} onBind={onBind} onClose={() => undefined} />);
    return onBind;
  }

  it('chỉ mời bản vẽ nằm DƯỚI bản vẽ này (bỏ chính nó, nhánh khác, bản trình bày); Gắn gửi ims_child_diagram_id', async () => {
    const onBind = renderDialog();
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Gắn khung với bản vẽ con hoặc dải IP' });
    await user.click(within(dialog).getByRole('button', { name: 'Bản vẽ con' }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['Tầng 3 E2E']);
    await user.click(screen.getByRole('option', { name: 'Tầng 3 E2E' }));
    await user.click(within(dialog).getByRole('button', { name: 'Gắn' }));
    expect(onBind).toHaveBeenCalledWith(frames[0], 'ims_child_diagram_id', 'd3');
  });

  it('khung đã gắn hiện đang gắn gì + nút Bỏ gắn; kiểu Dải IP gửi ims_subnet_id', async () => {
    const onBind = renderDialog();
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Gắn khung với bản vẽ con hoặc dải IP' });
    await user.click(within(dialog).getByRole('button', { name: 'Khung' }));
    await user.click(await screen.findByRole('option', { name: '(hình không chữ · s2)' }));
    expect(await within(dialog).findByText('Đang gắn: bản vẽ con "Tầng 3 E2E"')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Bỏ gắn' }));
    expect(onBind).toHaveBeenLastCalledWith(frames[1], 'ims_child_diagram_id', null);

    await user.click(within(dialog).getByRole('radio', { name: 'Dải IP (khung VLAN)' }));
    await user.click(within(dialog).getByRole('button', { name: 'Dải IP' }));
    await user.click(await screen.findByRole('option', { name: '10.1.0.0/24 · VLAN 20 · LAN E2E' }));
    await user.click(within(dialog).getByRole('button', { name: 'Gắn' }));
    expect(onBind).toHaveBeenLastCalledWith(frames[1], 'ims_subnet_id', 'sn-1');
  });

  it('khung tủ gắn nhầm tủ: "Đổi tủ của khung này" gửi ims_cabinet_id mới + nhãn đổi mã tủ (khung thường không có lựa chọn này)', async () => {
    const rack: FrameCandidate = { id: 'f4', label: 'Tủ TU-04 · Mặt trước', childDiagramId: null, subnetId: null, cabinetId: 'cab-4', attrs: { label: 'Tủ TU-04 · Mặt trước', ims_cabinet_id: 'cab-4' } };
    const catalog = {
      sites: [],
      cabinets: [
        { id: 'cab-1', siteId: 's1', siteCode: 'T', code: 'TU-01', description: null, uHeight: 42, active: true },
        { id: 'cab-4', siteId: 's1', siteCode: 'T', code: 'TU-04', description: null, uHeight: 42, active: true },
      ],
      deviceTypes: [],
      vendors: [],
      departments: [],
      ispProviders: [],
      servicePorts: [],
    };
    routeFetch({ '/api/v1/diagrams': () => jsonResponse(200, tree), '/api/v1/catalog': () => jsonResponse(200, catalog) });
    const onBind = vi.fn();
    renderWithI18n(<FrameBindDialog diagramId="d2" frames={[frames[0], rack]} onBind={onBind} onClose={() => undefined} />);
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Gắn khung với bản vẽ con hoặc dải IP' });
    expect(within(dialog).queryByRole('radio', { name: 'Tủ mạng của khung' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Khung' }));
    await user.click(await screen.findByRole('option', { name: 'Tủ TU-04 · Mặt trước' }));
    await user.click(within(dialog).getByRole('radio', { name: 'Tủ mạng của khung' }));
    await user.click(within(dialog).getByRole('button', { name: 'Tủ mạng mới' }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toEqual(['T · TU-01']);
    await user.click(screen.getByRole('option', { name: 'T · TU-01' }));
    await user.click(within(dialog).getByRole('button', { name: 'Đổi tủ của khung này' }));
    expect(onBind).toHaveBeenLastCalledWith(rack, 'ims_cabinet_id', 'cab-1', 'Tủ TU-01 · Mặt trước');
  });

  it('bản vẽ chưa có hình nào → nói rõ cần vẽ khung trước, không có nút Gắn', async () => {
    routeFetch({ '/api/v1/diagrams': () => jsonResponse(200, tree) });
    renderWithI18n(<FrameBindDialog diagramId="d2" frames={[]} onBind={vi.fn()} onClose={() => undefined} />);
    expect(await screen.findByText(/Bản vẽ chưa có hình nào để gắn/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gắn' })).toBeNull();
  });
});

describe('Hộp "Chèn tủ"', () => {
  const catalog = {
    sites: [{ id: 'st-1', code: 'E2E-KH', name: 'Site', active: true }],
    cabinets: [
      { id: 'cab-1', siteId: 'st-1', siteCode: 'E2E-KH', code: 'R1', active: true },
      { id: 'cab-2', siteId: 'st-1', siteCode: 'E2E-KH', code: 'R2', active: true },
    ],
    deviceTypes: [],
    vendors: [],
    departments: [],
    ispProviders: [],
    servicePorts: [],
    cableTypes: [],
  };

  it('tủ đã có khung trên bản vẽ: nút Chèn tắt kèm lý do; tủ khác thì Chèn tủ gửi id + mã', async () => {
    routeFetch({ '/api/v1/catalog': () => jsonResponse(200, catalog) });
    const onInsert = vi.fn();
    renderWithI18n(<CabinetPicker present={new Set(['cab-1'])} busy={false} onInsert={onInsert} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Tủ mạng' }));
    await user.click(await screen.findByRole('option', { name: 'E2E-KH · R1' }));
    expect(await screen.findByText('Tủ này đã có khung trên bản vẽ.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chèn tủ mạng' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Tủ mạng' }));
    await user.click(await screen.findByRole('option', { name: 'E2E-KH · R2' }));
    await user.click(screen.getByRole('button', { name: 'Chèn tủ mạng' }));
    expect(onInsert).toHaveBeenCalledWith('cab-2', 'R2');
  });
});

describe('Màn sửa — Chèn tủ dựng khung bằng patch', () => {
  it('khung tủ + máy là ô con, chèn MỘT lệnh patch vào trang đang mở', async () => {
    const layout = {
      uHeight: 12,
      frames: [
        { key: 'rack', label: 'Tủ R1', style: 'shape=mxgraph.rackGeneral.rackCabinet3;container=1;', attrs: { ims_cabinet_id: 'cab-1' }, x: 0, y: 0, width: 204, height: 220 },
        { key: 'unplaced', label: 'Tủ R1 · Chưa khai U', style: 'swimlane;', attrs: { ims_cabinet_id: 'cab-1' }, x: 244, y: 0, width: 160, height: 140 },
      ],
      devices: [{ frame: 'unplaced', id: 'dev-1', code: 'SW-E2E-01', style: 'shape=x;', label: 'SW-E2E-01', x: 50, y: 38, width: 60, height: 40 }],
    };
    routeFetch({
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: ROOT, version: { ...VERSION, xml: '<mxfile><diagram id="p1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>', svg: null } }),
      '/api/v1/diagrams/d1/presence': () => jsonResponse(200, { others: [] }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
      '/api/v1/diagrams': () => jsonResponse(200, TREE),
      '/api/v1/catalog': () => jsonResponse(200, { ...{ sites: [], deviceTypes: [], vendors: [], departments: [], ispProviders: [], servicePorts: [], cableTypes: [] }, cabinets: [{ id: 'cab-1', siteId: 'st-1', siteCode: 'E2E-KH', code: 'R1', active: true }] }),
      '/api/v1/diagrams/cabinet-frame/cab-1': () => jsonResponse(200, { cabinet: { id: 'cab-1', code: 'R1' }, layout }),
      '/api/v1/diagrams/cable-status': () => jsonResponse(200, { edges: [], undrawn: [] }),
    });
    renderAt('/diagrams/d1?mode=edit');
    const frameEl = (await screen.findByTitle('Khung vẽ draw.io')) as HTMLIFrameElement;
    const posted = vi.spyOn(frameEl.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    const fromDrawio = (data: Record<string, unknown>) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data), source: frameEl.contentWindow }));
      });
    fromDrawio({ event: 'init' });
    const messages = () => posted.mock.calls.map(([data]) => JSON.parse(String(data)) as Record<string, unknown>);
    const user = userEvent.setup();
    await pickMenuItem(user, /^Thao tác với/, 'Chèn tủ mạng');
    await user.click(await screen.findByRole('button', { name: 'Tủ mạng' }));
    await user.click(await screen.findByRole('option', { name: 'E2E-KH · R1' }));
    const popover = screen.getByRole('dialog', { name: 'Chèn khung tủ có sẵn máy' });
    await user.click(within(popover).getByRole('button', { name: 'Chèn tủ mạng' }));
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'export' && m.format === 'xml')).toBe(true));
    fromDrawio({
      event: 'export',
      format: 'xml',
      currentPage: 0,
      xml: '<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>',
    });
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'patch')).toBe(true));
    const patch = messages().find((m) => m.action === 'patch') as { patch: { u: { p1: { cells: { i: { id: string; parent: string; xmlValue: string }[] } } } } };
    const cells = patch.patch.u.p1.cells.i;
    expect(cells).toHaveLength(3);
    expect(cells[0].xmlValue).toContain('ims_cabinet_id="cab-1"');
    expect(cells[0].parent).toBe('1');
    expect(cells[2].parent).toBe(cells[1].id);
    expect(cells[2].xmlValue).toContain('ims_device_id="dev-1"');
    expect(await screen.findByText('Đã chèn khung tủ R1 (1 thiết bị).')).toBeInTheDocument();
  });
});

describe('Màn sửa — máy kéo vào khung tủ được đặt lại đúng U (Q-23 05/10)', () => {
  const RACK =
    'shape=mxgraph.rackGeneral.rackCabinet3;rackUnitSize=14.8;container=1;childLayout=rack;marginLeft=33;marginRight=9;marginTop=21;marginBottom=22;';
  const body = (deviceId: string, code: string) =>
    `<UserObject label="Tủ TU-04 · Mặt trước" ims_cabinet_id="cab-4" id="f4"><mxCell style="${RACK}" vertex="1" parent="1"><mxGeometry x="250" y="20" width="204" height="664.6" as="geometry"/></mxCell></UserObject>` +
    `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="d1"><mxCell style="shape=image;verticalLabelPosition=bottom;verticalAlign=top;" vertex="1" parent="f4"><mxGeometry x="33" y="228.2" width="162" height="59.2" as="geometry"/></mxCell></UserObject>`;
  const wrap = (inner: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${inner}</root></mxGraphModel>`;
  const info = (id: string, code: string, cabinetId: string, cabinetCode: string) => ({
    id,
    found: true,
    code,
    name: code,
    deviceTypeName: 'UPS',
    model: null,
    serial: null,
    status: 'in_use',
    ips: [],
    siteCode: 'T',
    cabinetId,
    cabinetCode,
    u: 30,
    uSize: 1,
    vendorName: null,
    vendorPhone: null,
    warrantyEnd: null,
    photos: { front: false, back: false },
    cell: { style: '', label: code, width: 60, height: 60, attrs: {} },
  });

  async function open(devices: unknown[], saved = '', extra: Record<string, () => Response> = {}) {
    routeFetch({
      ...extra,
      '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
      '/api/v1/diagrams/d1/content': () =>
        jsonResponse(200, { diagram: ROOT, version: { ...VERSION, xml: `<mxfile><diagram id="p1">${wrap(saved)}</diagram></mxfile>`, svg: '<svg/>' }, devices }),
      '/api/v1/diagrams/d1/presence': () => jsonResponse(200, { others: [] }),
      '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
      '/api/v1/diagrams': () => jsonResponse(200, TREE),
    });
    renderAt('/diagrams/d1?mode=edit');
    const frameEl = (await screen.findByTitle('Khung vẽ draw.io')) as HTMLIFrameElement;
    const posted = vi.spyOn(frameEl.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    const fromDrawio = (data: Record<string, unknown>) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data), source: frameEl.contentWindow }));
      });
    fromDrawio({ event: 'init' });
    const messages = () => posted.mock.calls.map(([data]) => JSON.parse(String(data)) as Record<string, unknown>);
    return { fromDrawio, messages };
  }

  it('máy cùng tủ ở U30, draw.io bắt thành 4U → patch đặt lại 1U đúng U30, nhãn bên phải', async () => {
    const { fromDrawio, messages } = await open([info('dev-ups', 'UPS-E2E-03', 'cab-4', 'TU-04')]);
    fromDrawio({ event: 'autosave', xml: wrap(body('dev-ups', 'UPS-E2E-03')) });
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'export' && m.format === 'xml')).toBe(true));
    fromDrawio({ event: 'export', format: 'xml', currentPage: 0, xml: `<mxfile><diagram id="p1">${wrap(body('dev-ups', 'UPS-E2E-03'))}</diagram></mxfile>` });
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'patch')).toBe(true));
    const patch = messages().find((m) => m.action === 'patch') as { patch: { u: { p1: { cells: { u: Record<string, { geometry: string; style: string }> } } } } };
    expect(patch.patch.u.p1.cells.u.d1.geometry).toBe('<mxGeometry x="33" y="198.6" width="162" height="14.8" as="geometry"/>');
    expect(patch.patch.u.p1.cells.u.d1.style).toContain('labelPosition=right');
    // Người vẽ biết vì sao ô "nhảy": U lấy từ kho, muốn dời thì sửa ở trang thiết bị.
    expect(await screen.findByText(/IMS đặt máy trong khung tủ theo U của kho/)).toBeInTheDocument();
  });

  it('máy kho ghi tủ KHÁC (TU-01 thả vào khung TU-04) → không đặt theo U, hỏi MỘT lần (hai lượt autosave), không gọi API ghi nào', async () => {
    const { fromDrawio, messages } = await open([info('dev-ups', 'UPS-E2E-03', 'cab-1', 'TU-01')], '', {
      '/api/v1/catalog': () => jsonResponse(200, CATALOG),
      '/api/v1/devices': () => jsonResponse(200, { items: [], total: 0 }),
    });
    fromDrawio({ event: 'autosave', xml: wrap(body('dev-ups', 'UPS-E2E-03')) });
    fromDrawio({ event: 'autosave', xml: wrap(body('dev-ups', 'UPS-E2E-03')) });
    expect(await screen.findAllByRole('dialog', { name: 'Chuyển máy sang tủ này?' })).toHaveLength(1);
    expect(messages().some((m) => m.action === 'patch')).toBe(false);
    const writes = (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][]).filter(([, init]) => init?.method && init.method !== 'GET' && !String(init.method).includes('GET'));
    expect(writes.every(([url]) => String(url).includes('/presence'))).toBe(true);
  });

  it('mở bản vẽ đã lưu có máy nằm sai khung tủ → báo ngay khi mở (chưa cần sửa gì), không tự sửa bản vẽ lúc mở', async () => {
    const { messages } = await open([info('dev-ups', 'UPS-E2E-03', 'cab-1', 'TU-01')], body('dev-ups', 'UPS-E2E-03'));
    expect(await screen.findByText(/Máy UPS-E2E-03 trong kho thuộc tủ TU-01/)).toBeInTheDocument();
    expect(messages().some((m) => m.action === 'patch')).toBe(false);
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeDisabled();
  });

  it('nhiều máy tủ khác cùng lúc (mở bản vẽ cũ) → MỘT lời báo liệt kê, không một chuỗi lời báo', async () => {
    const second = `<UserObject label="FW-E2E-01" ims_device_id="dev-fw" ims_device_code="FW-E2E-01" id="d2"><mxCell style="" vertex="1" parent="f4"><mxGeometry x="33" y="35.8" width="162" height="133.2" as="geometry"/></mxCell></UserObject>`;
    await open([info('dev-ups', 'UPS-E2E-03', 'cab-1', 'TU-01'), info('dev-fw', 'FW-E2E-01', 'cab-1', 'TU-01')], body('dev-ups', 'UPS-E2E-03') + second, {
      '/api/v1/catalog': () => jsonResponse(200, CATALOG),
      '/api/v1/devices': () => jsonResponse(200, { items: [], total: 0 }),
    });
    expect(await screen.findByText(/2 Máy trong kho thuộc tủ khác khung tủ chúng nằm: UPS-E2E-03 \(TU-01\), FW-E2E-01 \(TU-01\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Máy UPS-E2E-03 trong kho thuộc tủ TU-01/)).toBeNull();
    // Nút trên lời báo mở danh sách; chọn một máy là mở hộp chuyển của máy đó.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Chuyển máy sang tủ…' }));
    const list = await screen.findByRole('dialog', { name: 'Máy nằm trong khung tủ khác tủ trong kho' });
    await user.click(within(list).getByRole('button', { name: 'Chuyển máy sang tủ này — FW-E2E-01' }));
    expect(await screen.findByText(/Chuyển FW-E2E-01 từ TU-01 sang TU-04/)).toBeInTheDocument();
  });

  /* Q-23 06/10: kéo máy vào khung tủ KHÁC tủ trong kho → hỏi trước "Chuyển máy sang tủ này", không ghi ngầm. */
  const CATALOG = {
    sites: [],
    cabinets: [
      { id: 'cab-1', siteId: 's1', siteCode: 'T', code: 'TU-01', description: null, uHeight: 42, active: true },
      { id: 'cab-4', siteId: 's1', siteCode: 'T', code: 'TU-04', description: null, uHeight: 42, active: true },
    ],
    deviceTypes: [],
    vendors: [],
    departments: [],
    ispProviders: [],
    servicePorts: [],
  };
  const outside = (deviceId: string, code: string) =>
    `<UserObject label="Tủ TU-04 · Mặt trước" ims_cabinet_id="cab-4" id="f4"><mxCell style="${RACK}" vertex="1" parent="1"><mxGeometry x="250" y="20" width="204" height="664.6" as="geometry"/></mxCell></UserObject>` +
    `<mxCell id="note" value="Ghi chú" style="text;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="20" as="geometry"/></mxCell>` +
    `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="d1"><mxCell style="shape=image;" vertex="1" parent="1"><mxGeometry x="700" y="300" width="60" height="60" as="geometry"/></mxCell></UserObject>`;
  const moveRoutes = (patched: { body: unknown }[], occupants: unknown[] = [{ id: 'dev-sw', code: 'SW-E2E-28', rackUStart: 28, rackUSize: 1 }]) => ({
    '/api/v1/catalog': () => jsonResponse(200, CATALOG),
    '/api/v1/devices': () => jsonResponse(200, { items: occupants, total: occupants.length }),
    '/api/v1/devices/dev-ups': () => {
      patched.push({ body: null });
      return jsonResponse(200, { device: { id: 'dev-ups' }, warnings: [] });
    },
  });
  const deviceWrites = () =>
    (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][]).filter(([url, init]) => String(url).includes('/api/v1/devices/') && init?.method === 'PATCH');

  it('kéo máy tủ TU-01 vào khung TU-04 → hộp xác nhận nêu đủ tủ cũ, tủ mới, U (U trống gần chỗ thả), Số U; Huỷ → ô về chỗ cũ, không ghi kho', async () => {
    const patched: { body: unknown }[] = [];
    const { fromDrawio, messages } = await open([info('dev-ups', 'UPS-E2E-03', 'cab-1', 'TU-01')], outside('dev-ups', 'UPS-E2E-03'), moveRoutes(patched));
    fromDrawio({ event: 'autosave', xml: wrap(body('dev-ups', 'UPS-E2E-03')) });
    const dialog = await screen.findByRole('dialog', { name: 'Chuyển máy sang tủ này?' });
    // Thả ở U28 nhưng U28 đã có SW-E2E-28 → đề xuất U trống gần nhất.
    expect(await within(dialog).findByText('Chuyển UPS-E2E-03 từ TU-01 sang TU-04, U bắt đầu = 27, Số U = 1.')).toBeInTheDocument();
    expect(deviceWrites()).toHaveLength(0);
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole('button', { name: 'Huỷ, đưa máy về chỗ cũ' }));
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'export' && m.format === 'xml')).toBe(true));
    fromDrawio({ event: 'export', format: 'xml', currentPage: 0, xml: `<mxfile><diagram id="p1">${wrap(body('dev-ups', 'UPS-E2E-03'))}</diagram></mxfile>` });
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'patch')).toBe(true));
    const patch = messages().find((m) => m.action === 'patch') as { patch: { u: { p1: { cells: { u: Record<string, { parent: string; previous: string; geometry: string }> } } } } };
    expect(patch.patch.u.p1.cells.u.d1).toEqual({ parent: '1', previous: 'note', geometry: '<mxGeometry x="700" y="300" width="60" height="60" as="geometry"/>' });
    expect(deviceWrites()).toHaveLength(0);
  });

  it('U nhập đã có máy → báo tại ô, nút Chuyển tắt; đổi U trống → Chuyển gọi PATCH thiết bị (tủ + site + U) rồi đặt lại ô đúng U mới', async () => {
    const patched: { body: unknown }[] = [];
    const { fromDrawio, messages } = await open([info('dev-ups', 'UPS-E2E-03', 'cab-1', 'TU-01')], outside('dev-ups', 'UPS-E2E-03'), moveRoutes(patched));
    fromDrawio({ event: 'autosave', xml: wrap(body('dev-ups', 'UPS-E2E-03')) });
    const dialog = await screen.findByRole('dialog', { name: 'Chuyển máy sang tủ này?' });
    const field = await within(dialog).findByRole('textbox', { name: 'U bắt đầu' });
    const user = userEvent.setup();
    await user.clear(field);
    await user.type(field, '28');
    expect(await within(dialog).findByText(/Chỗ U28 đang có SW-E2E-28/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Chuyển máy' })).toBeDisabled();
    await user.clear(field);
    await user.type(field, '30');
    expect(within(dialog).getByText('Chuyển UPS-E2E-03 từ TU-01 sang TU-04, U bắt đầu = 30, Số U = 1.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Chuyển máy' }));
    await vi.waitFor(() => expect(deviceWrites()).toHaveLength(1));
    const [, init] = deviceWrites()[0];
    expect(JSON.parse(String(init!.body))).toEqual({ siteId: 's1', cabinetId: 'cab-4', rackUStart: 30, rackUSize: 1 });
    expect(await screen.findByText('Đã chuyển UPS-E2E-03 sang tủ TU-04 ở U30 trong kho.')).toBeInTheDocument();
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'export' && m.format === 'xml')).toBe(true));
    fromDrawio({ event: 'export', format: 'xml', currentPage: 0, xml: `<mxfile><diagram id="p1">${wrap(body('dev-ups', 'UPS-E2E-03'))}</diagram></mxfile>` });
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'patch')).toBe(true));
    const patch = messages().find((m) => m.action === 'patch') as { patch: { u: { p1: { cells: { u: Record<string, { geometry: string }> } } } } };
    // U30 của tủ 42U: cách đỉnh lòng tủ 12U.
    expect(patch.patch.u.p1.cells.u.d1.geometry).toBe('<mxGeometry x="33" y="198.6" width="162" height="14.8" as="geometry"/>');
  });

  it('mở bản vẽ có máy nằm sai khung → lời báo có nút "Chuyển máy sang tủ này" mở cùng hộp (Huỷ thì không dời ô)', async () => {
    const patched: { body: unknown }[] = [];
    const { messages } = await open([info('dev-ups', 'UPS-E2E-03', 'cab-1', 'TU-01')], body('dev-ups', 'UPS-E2E-03'), moveRoutes(patched));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Chuyển máy sang tủ này' }));
    const dialog = await screen.findByRole('dialog', { name: 'Chuyển máy sang tủ này?' });
    await user.click(within(dialog).getByRole('button', { name: 'Huỷ' }));
    expect(messages().some((m) => m.action === 'patch')).toBe(false);
    expect(deviceWrites()).toHaveLength(0);
  });

  it('máy đã thanh lý trong khung tủ khác → không mời chuyển', async () => {
    const retired = { ...info('dev-ups', 'UPS-E2E-03', 'cab-1', 'TU-01'), status: 'retired' };
    const { fromDrawio } = await open([retired], outside('dev-ups', 'UPS-E2E-03'), moveRoutes([]));
    fromDrawio({ event: 'autosave', xml: wrap(body('dev-ups', 'UPS-E2E-03')) });
    expect(await screen.findByText('UPS-E2E-03 đã thanh lý — không chuyển tủ được.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Chuyển máy sang tủ này?' })).toBeNull();
  });
});
