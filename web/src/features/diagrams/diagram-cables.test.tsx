import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { MemoryRouter, Route, RouterProvider, Routes, createMemoryRouter } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within, pickMenuItem } from '@/test/test-utils';
import type { DiagramLink, DiagramNode } from './diagram-api';
import { DiagramScreen } from './diagram-screen';

/**
 * Dây gắn sơ đồ cổng trên màn sơ đồ (Q-23 "vẽ là khai, có hỏi", AD-18): web chỉ GHI sơ đồ cổng
 * (endpoint của `devices`) sau một nút bấm trong hộp IMS; chiều ngược lại đọc từ nội dung server.
 */

const ME = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;
const ROOT: DiagramNode = {
  id: 'd1',
  parentId: null,
  name: 'Phòng E2E',
  nodeType: 'room',
  siteId: null,
  cabinetId: null,
  ownerEmail: null,
  kind: 'official',
  archivedAt: null,
  status: 'draft',
  latestVersion: null,
};
const VERSION = { id: 'v1', seq: 1, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };
const CABLES = [
  { id: 'ct-cat6', name: 'Cat6', colorSlot: 1, active: true },
  { id: 'ct-fiber', name: 'Fiber', colorSlot: 2, active: true },
];
const CATALOG = { sites: [], cabinets: [], deviceTypes: [], vendors: [], departments: [], ispProviders: [], servicePorts: [], cableTypes: CABLES };

const dev = (id: string, deviceId: string, code: string) =>
  `<UserObject label="${code}" ims_device_id="${deviceId}" ims_device_code="${code}" id="${id}"><mxCell style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="60" height="60" as="geometry"/></mxCell></UserObject>`;
const edge = (id: string, s: string, t: string) =>
  `<mxCell id="${id}" value="" style="endArrow=none;" edge="1" parent="1" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
const linked = (id: string, s: string, t: string, link: string) =>
  `<UserObject label="Gi1 ↔ eth0" ims_link_id="${link}" ims_cable_type_id="ct-fiber" id="${id}"><mxCell style="endArrow=none;imsPaint=cable-2;html=0;" edge="1" parent="1" source="${s}" target="${t}"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject>`;
const DEVICES = dev('a', 'dev-sw', 'SW-E2E-01') + dev('b', 'dev-srv', 'SRV-E2E-01');
const file = (body: string) =>
  `<mxfile><diagram id="p1" name="Trang 1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel></diagram></mxfile>`;
const model = (body: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${body}</root></mxGraphModel>`;

const LINK: DiagramLink = {
  id: 'link-1',
  deviceId: 'dev-sw',
  deviceCode: 'SW-E2E-01',
  portLabel: 'Gi1/0/24',
  peerDeviceId: 'dev-srv',
  peerDeviceCode: 'SRV-E2E-01',
  peerPort: 'eth0',
  cableTypeId: 'ct-fiber',
  vlan: '20',
  note: null,
  colorSlot: 2,
  labelFromA: 'Gi1/0/24 ↔ eth0',
  labelFromB: 'eth0 ↔ Gi1/0/24',
  edgeStyle: 'edgeStyle=orthogonalEdgeStyle;rounded=0;endArrow=none;imsPaint=cable-2;html=0;',
  endLabel: { style: 'edgeLabel;imsPortEnd=1;imsPaint=cable-2;html=0;fontSize=10;resizable=0;', offset: 0.75 },
};

const PORTS_SW = {
  ports: [
    { id: 'p1', portLabel: 'Gi1/0/23', connectedDeviceId: null, connectedDeviceCode: null, connectedDeviceName: null, connectedLabel: null, connectedPort: null, usedBy: null, vlan: '20', note: null },
  ],
  incoming: [],
};

type Routes = Record<string, (init?: RequestInit) => Response>;

function routeFetch(routes: Routes) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const hit = Object.keys(routes).find((path) => url.includes(path));
    return Promise.resolve(hit ? routes[hit](init) : jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function base(content: Record<string, unknown>, extra: Routes = {}): Routes {
  return {
    ...extra,
    '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
    '/api/v1/diagrams/d1/content': () => jsonResponse(200, { diagram: ROOT, cableTypes: CABLES, ...content }),
    '/api/v1/diagrams/d1/presence': () => jsonResponse(200, { others: [] }),
    '/api/v1/diagrams/d1': () => jsonResponse(200, ROOT),
    '/api/v1/catalog': () => jsonResponse(200, CATALOG),
  };
}

async function openEditor(xml: string, content: Record<string, unknown>, extra: Routes = {}) {
  const fetchMock = routeFetch(base({ version: { ...VERSION, xml, svg: null }, ...content }, extra));
  const router = createMemoryRouter([{ path: '/diagrams/:id', element: <DiagramScreen me={ME} /> }], { initialEntries: ['/diagrams/d1?mode=edit'] });
  renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </ToastProvider>,
  );
  const frame = (await screen.findByTitle('Khung vẽ draw.io')) as HTMLIFrameElement;
  const posted = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
  const fromDrawio = (data: Record<string, unknown>) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data), source: frame.contentWindow }));
    });
  fromDrawio({ event: 'init' });
  const messages = () => posted.mock.calls.map(([data]) => JSON.parse(String(data)) as Record<string, unknown>);
  /** Trả lời lượt `export` xml đang chờ bằng cả tệp. */
  const answerFile = async (body: string) => {
    await vi.waitFor(() => expect(messages().filter((m) => m.action === 'export' && m.format === 'xml').length).toBeGreaterThan(0));
    fromDrawio({ event: 'export', format: 'xml', xml: file(body), currentPage: 0 });
  };
  return { fetchMock, fromDrawio, messages, answerFile };
}

const calls = (fetchMock: ReturnType<typeof routeFetch>, path: string) =>
  (fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]).filter(([url]) => String(url).includes(path));

beforeEach(() => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
afterEach(() => vi.unstubAllGlobals());

describe('Vẽ là khai, có hỏi — màn sửa', () => {
  it('nét mới nối hai máy kho → hộp "Khai"; Khai gọi endpoint của devices rồi gắn ims_link_id + nhãn cổng vào nét', async () => {
    const { fetchMock, fromDrawio, messages, answerFile } = await openEditor(file(DEVICES), {}, {
      '/api/v1/devices/dev-sw/ports/link': () => jsonResponse(201, { ...LINK }),
      '/api/v1/devices/dev-sw/ports': () => jsonResponse(200, PORTS_SW),
      '/api/v1/devices/dev-srv/ports': () => jsonResponse(200, { ports: [], incoming: [] }),
      '/api/v1/diagrams/links': () => jsonResponse(200, [LINK]),
    });
    const user = userEvent.setup();
    fromDrawio({ event: 'autosave', xml: model(DEVICES + edge('e1', 'a', 'b')) });
    const dialog = await screen.findByRole('dialog', { name: 'Khai kết nối này vào sơ đồ cổng?' });
    // Không có window.confirm: hộp IMS, gợi ý chỉ cổng còn trống.
    const swPort = within(dialog).getByRole('combobox', { name: 'Cổng của SW-E2E-01' });
    await user.type(swPort, 'Gi1/0/24');
    await user.type(within(dialog).getByRole('combobox', { name: 'Cổng của SRV-E2E-01' }), 'eth0');
    await user.click(within(dialog).getByRole('button', { name: 'Loại dây' }));
    await user.click(await screen.findByRole('option', { name: 'Fiber' }));
    await user.click(within(dialog).getByRole('button', { name: 'Khai' }));

    await vi.waitFor(() => expect(calls(fetchMock, '/ports/link')).toHaveLength(1));
    const [, init] = calls(fetchMock, '/ports/link')[0];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ portLabel: 'Gi1/0/24', connectedDeviceId: 'dev-srv', connectedPort: 'eth0', cableTypeId: 'ct-fiber' });
    await answerFile(DEVICES + edge('e1', 'a', 'b'));
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'patch')).toBe(true));
    const patch = messages().find((m) => m.action === 'patch') as {
      patch: { u: { p1: { cells: { u: Record<string, { xmlValue: string; style: string }>; i: { id: string; parent: string; value: string }[] } } } };
    };
    const update = patch.patch.u.p1.cells.u.e1;
    expect(update.xmlValue).toContain('ims_link_id="link-1"');
    expect(update.xmlValue).toContain('ims_cable_type_id="ct-fiber"');
    // Nhãn cổng ở HAI ĐẦU dây (Q-23): nhãn giữa rỗng, hai ô nhãn con của nét chèn cùng lệnh.
    expect(update.xmlValue).toContain('label=""');
    expect(update.xmlValue).toContain('ims_port_labels="ends"');
    expect(patch.patch.u.p1.cells.i.map((c) => [c.id, c.parent, c.value])).toEqual([
      ['e1-ims-ps', 'e1', 'Gi1/0/24'],
      ['e1-ims-pt', 'e1', 'eth0'],
    ]);
    expect(update.style).toContain('imsPaint=cable-2');
    // Nét vẽ bằng công cụ nét thẳng cũng thành dây vuông góc khi khai (Q-23).
    expect(update.style).toContain('edgeStyle=orthogonalEdgeStyle');
    expect(screen.queryByRole('dialog', { name: 'Khai kết nối này vào sơ đồ cổng?' })).toBeNull();
    // Lời báo chỉ chỗ kết nối nằm: sơ đồ cổng của máy giữ dòng, mở tab mới (không bỏ bản vẽ dở).
    const opened = vi.fn();
    vi.stubGlobal('open', opened);
    await user.click(screen.getByRole('button', { name: 'Xem ở sơ đồ cổng của SW-E2E-01' }));
    expect(opened).toHaveBeenCalledWith('/devices/dev-sw?tab=ports', '_blank', 'noopener');
  });

  it('cổng vừa bị chiếm → 409 hiện đỏ TRONG hộp, không gắn gì vào nét; "Chỉ vẽ" để nét vàng', async () => {
    const { fetchMock, fromDrawio, messages, answerFile } = await openEditor(file(DEVICES), {}, {
      '/api/v1/devices/dev-sw/ports/link': () => jsonResponse(409, { statusCode: 409, code: 'PORT_ALREADY_LINKED', message: 'Cổng "Gi1/0/24" của SW-E2E-01 đã có cáp.' }),
      '/api/v1/devices/dev-sw/ports': () => jsonResponse(200, PORTS_SW),
      '/api/v1/devices/dev-srv/ports': () => jsonResponse(200, { ports: [], incoming: [] }),
    });
    const user = userEvent.setup();
    fromDrawio({ event: 'autosave', xml: model(DEVICES + edge('e1', 'a', 'b')) });
    const dialog = await screen.findByRole('dialog', { name: 'Khai kết nối này vào sơ đồ cổng?' });
    await user.type(within(dialog).getByRole('combobox', { name: 'Cổng của SW-E2E-01' }), 'Gi1/0/24');
    await user.click(within(dialog).getByRole('button', { name: 'Khai' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('đã có cáp');
    // Danh sách cổng trống nạp lại.
    await vi.waitFor(() => expect(calls(fetchMock, '/api/v1/devices/dev-sw/ports').filter(([u]) => !String(u).includes('link')).length).toBeGreaterThan(1));
    expect(messages().some((m) => m.action === 'patch')).toBe(false);

    await user.click(within(dialog).getByRole('button', { name: 'Chỉ vẽ' }));
    await answerFile(DEVICES + edge('e1', 'a', 'b'));
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'patch')).toBe(true));
    const patch = messages().find((m) => m.action === 'patch') as { patch: { u: { p1: { cells: { u: Record<string, { value: string; style: string }> } } } } };
    expect(patch.patch.u.p1.cells.u.e1).toMatchObject({ value: '⚠ Chưa khai vào sơ đồ cổng' });
    expect(patch.patch.u.p1.cells.u.e1.style).toContain('imsPaint=warn');
    expect(JSON.stringify(patch)).not.toContain('ims_link_id');
  });

  it('đóng hộp (Esc) = Chỉ vẽ', async () => {
    const { fromDrawio, messages, answerFile } = await openEditor(file(DEVICES), {}, {
      '/api/v1/devices/': () => jsonResponse(200, { ports: [], incoming: [] }),
    });
    fromDrawio({ event: 'autosave', xml: model(DEVICES + edge('e1', 'a', 'b')) });
    await screen.findByRole('dialog', { name: 'Khai kết nối này vào sơ đồ cổng?' });
    await userEvent.setup().keyboard('{Escape}');
    await answerFile(DEVICES + edge('e1', 'a', 'b'));
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'patch' && JSON.stringify(m).includes('imsPaint=warn'))).toBe(true));
  });

  it('xoá nét đã khai → hỏi ba đường: "Chỉ xóa nét vẽ" không gọi gì; "Gỡ luôn kết nối" gọi endpoint gỡ; Hủy trả nét về (Q-26 07/10)', async () => {
    const xml = file(DEVICES + linked('e1', 'a', 'b', 'link-1'));
    const { fetchMock, fromDrawio } = await openEditor(xml, { links: [LINK] }, {
      '/api/v1/devices/dev-sw/ports/link-1/unlink': () => jsonResponse(201, { removed: true }),
    });
    const user = userEvent.setup();
    fromDrawio({ event: 'autosave', xml: model(DEVICES + linked('e1', 'a', 'b', 'link-1')) });
    fromDrawio({ event: 'autosave', xml: model(DEVICES) });
    const ask = await screen.findByRole('dialog', { name: 'Xóa nét dây đã khai' });
    expect(ask).toHaveTextContent('SW-E2E-01 Gi1/0/24 ↔ SRV-E2E-01 eth0');
    await user.click(within(ask).getByRole('button', { name: 'Chỉ xóa nét vẽ' }));
    expect(calls(fetchMock, '/unlink')).toHaveLength(0);

    fromDrawio({ event: 'autosave', xml: model(DEVICES + linked('e2', 'a', 'b', 'link-1')) });
    fromDrawio({ event: 'autosave', xml: model(DEVICES) });
    await user.click(within(await screen.findByRole('dialog', { name: 'Xóa nét dây đã khai' })).getByRole('button', { name: 'Gỡ luôn kết nối' }));
    await vi.waitFor(() => expect(calls(fetchMock, '/api/v1/devices/dev-sw/ports/link-1/unlink')).toHaveLength(1));
    expect(await screen.findByText('Đã gỡ 1 kết nối khỏi sơ đồ cổng.')).toBeInTheDocument();
  });

  it('xoá nét đã khai rồi bấm Hủy (✕ / Esc cũng vậy) → nét được chèn lại đúng như cũ, không gỡ gì', async () => {
    const { fetchMock, fromDrawio, messages, answerFile } = await openEditor(file(DEVICES + linked('e1', 'a', 'b', 'link-1')), { links: [LINK] });
    const user = userEvent.setup();
    fromDrawio({ event: 'autosave', xml: model(DEVICES + linked('e1', 'a', 'b', 'link-1')) });
    fromDrawio({ event: 'autosave', xml: model(DEVICES) });
    const ask = await screen.findByRole('dialog', { name: 'Xóa nét dây đã khai' });
    await user.click(within(ask).getAllByRole('button', { name: 'Hủy' }).at(-1)!);
    await answerFile(DEVICES);
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'patch')).toBe(true));
    const patch = messages().find((m) => m.action === 'patch') as { patch: { u: { p1: { cells: { i: { id: string; source: string; target: string; xmlValue: string }[] } } } } };
    expect(patch.patch.u.p1.cells.i.map((c) => [c.id, c.source, c.target])).toEqual([['e1', 'a', 'b']]);
    expect(patch.patch.u.p1.cells.i[0].xmlValue).toContain('ims_link_id="link-1"');
    expect(calls(fetchMock, '/unlink')).toHaveLength(0);
  });

  it('gỡ kết nối mà server báo PORT_NOT_FOUND (đã gỡ ở nơi khác) → không báo lỗi, không trả nét về', async () => {
    const { fromDrawio, messages } = await openEditor(file(DEVICES + linked('e1', 'a', 'b', 'link-1')), { links: [LINK] }, {
      '/api/v1/devices/dev-sw/ports/link-1/unlink': () => jsonResponse(404, { code: 'PORT_NOT_FOUND', message: 'Không tìm thấy dòng port map này.' }),
    });
    const user = userEvent.setup();
    fromDrawio({ event: 'autosave', xml: model(DEVICES + linked('e1', 'a', 'b', 'link-1')) });
    fromDrawio({ event: 'autosave', xml: model(DEVICES) });
    await user.click(within(await screen.findByRole('dialog', { name: 'Xóa nét dây đã khai' })).getByRole('button', { name: 'Gỡ luôn kết nối' }));
    expect(await screen.findByText('1 Kết nối đã được gỡ ở nơi khác từ trước — chỉ cần xóa nét.')).toBeInTheDocument();
    expect(screen.queryByText(/Không gỡ được/)).toBeNull();
    expect(messages().some((m) => m.action === 'patch')).toBe(false);
  });

  it('nhân bản nét đã khai → bản sao bị bỏ ims_link_id (patch) và được hỏi như nét mới', async () => {
    const { fromDrawio, messages, answerFile } = await openEditor(file(DEVICES + linked('e1', 'a', 'b', 'link-1')), { links: [LINK] }, {
      '/api/v1/devices/': () => jsonResponse(200, { ports: [], incoming: [] }),
    });
    fromDrawio({ event: 'autosave', xml: model(DEVICES + linked('e1', 'a', 'b', 'link-1')) });
    fromDrawio({ event: 'autosave', xml: model(DEVICES + linked('e1', 'a', 'b', 'link-1') + linked('e2', 'a', 'b', 'link-1')) });
    await answerFile(DEVICES + linked('e1', 'a', 'b', 'link-1') + linked('e2', 'a', 'b', 'link-1'));
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'patch')).toBe(true));
    const patch = messages().find((m) => m.action === 'patch') as { patch: { u: { p1: { cells: { u: Record<string, { xmlValue: string }> } } } } };
    expect(Object.keys(patch.patch.u.p1.cells.u)).toEqual(['e2']);
    expect(patch.patch.u.p1.cells.u.e2.xmlValue).not.toContain('ims_link_id');
    expect(await screen.findByRole('dialog', { name: 'Khai kết nối này vào sơ đồ cổng?' })).toBeInTheDocument();
  });

  it('"Chỉ xoá nét vẽ" một dây đã khai → dải "Có 1 kết nối mới chưa vẽ" hiện lại để vẽ vào được (tính lại từ XML đang vẽ)', async () => {
    const { fromDrawio, answerFile, fetchMock } = await openEditor(file(DEVICES + linked('e1', 'a', 'b', 'link-1')), { links: [LINK] }, {
      '/api/v1/diagrams/cable-status': () => jsonResponse(200, { edges: [], undrawn: [LINK] }),
    });
    const user = userEvent.setup();
    expect(screen.queryByText('Có 1 kết nối mới chưa vẽ')).toBeNull();
    fromDrawio({ event: 'autosave', xml: model(DEVICES + linked('e1', 'a', 'b', 'link-1')) });
    fromDrawio({ event: 'autosave', xml: model(DEVICES) });
    await user.click(within(await screen.findByRole('dialog', { name: 'Xóa nét dây đã khai' })).getByRole('button', { name: 'Chỉ xóa nét vẽ' }));
    await answerFile(DEVICES);
    await vi.waitFor(() => expect(calls(fetchMock, '/api/v1/diagrams/cable-status')).toHaveLength(1));
    expect(await screen.findByText('Có 1 kết nối mới chưa vẽ')).toBeInTheDocument();
  });

  it('menu ⋮ khi vẽ (Q-26 07/10): một mục "Sắp lại dây" thay hai mục đi dây; không có Phát hành / Gửi duyệt / Bình luận đã ghim', async () => {
    await openEditor(file(DEVICES), { links: [] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Thao tác với/ }));
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent ?? '');
    expect(items.some((text) => text.startsWith('Sắp lại dây'))).toBe(true);
    for (const gone of ['Bẻ dây vuông góc', 'Tự đi lại dây', 'Phát hành', 'Gửi duyệt', 'Bình luận đã ghim']) {
      expect(items.some((text) => text.startsWith(gone)), gone).toBe(false);
    }
  });

  it('menu ⋮ khi vẽ (Q-26 08/10): bỏ "Nối hàng loạt", "Ảnh thật…", "Gắn khung"', async () => {
    await openEditor(file(DEVICES), { links: [] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^Thao tác với/ }));
    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent ?? '');
    expect(items.some((text) => text.startsWith('Khai kết nối'))).toBe(true);
    for (const gone of ['Nối hàng loạt', 'Ảnh thật', 'Gắn khung']) {
      expect(items.some((text) => text.startsWith(gone)), gone).toBe(false);
    }
  });

  it('⋮ › "Sắp lại dây" › "Đi lại từ đầu": dây đã khai bị kéo đầu ra chỗ trống được nối lại về đúng máy, bỏ điểm uốn; nét tự do không đụng (Q-23 05/10)', async () => {
    const loose = `<UserObject label="⚠ Dây Gi1/0/24 ↔ eth0 phải nối SW-E2E-01 ↔ SRV-E2E-01 — kéo đầu dây về đúng máy" ims_link_id="link-1" id="e1"><mxCell style="rounded=0;exitX=1;exitY=0.5;endArrow=none;imsPaint=danger;dashed=1;html=0;" edge="1" parent="1" source="a"><mxGeometry relative="1" as="geometry"><mxPoint x="90" y="560" as="targetPoint"/></mxGeometry></mxCell></UserObject>`;
    const helper = `<mxCell id="f1" value="" style="endArrow=none;" edge="1" parent="1" source="b"><mxGeometry relative="1" as="geometry"><mxPoint x="90" y="560" as="targetPoint"/></mxGeometry></mxCell>`;
    const { messages, answerFile } = await openEditor(file(DEVICES + loose + helper), { links: [LINK] });
    const user = userEvent.setup();
    await pickMenuItem(user, /^Thao tác với/, /^Sắp lại dây/);
    await user.click(within(await screen.findByRole('dialog', { name: 'Sắp lại dây trên trang' })).getByRole('button', { name: 'Đi lại từ đầu' }));
    await answerFile(DEVICES + loose + helper);
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'patch')).toBe(true));
    const patch = messages().find((m) => m.action === 'patch') as {
      patch: { u: { p1: { cells: { u: Record<string, Record<string, string>>; i: { id: string; value: string }[] } } } };
    };
    const update = patch.patch.u.p1.cells.u.e1;
    expect(Object.keys(patch.patch.u.p1.cells.u)).toEqual(['e1']);
    // Dây người vẽ đụng tới chuyển sang nhãn cổng hai đầu (Q-23).
    expect(patch.patch.u.p1.cells.i.map((c) => [c.id, c.value])).toEqual([
      ['e1-ims-ps', 'Gi1/0/24'],
      ['e1-ims-pt', 'eth0'],
    ]);
    expect(update).toMatchObject({ geometry: '<mxGeometry relative="1" as="geometry"/>', source: 'a', target: 'b' });
    // Nối đúng rồi thì nhãn + màu theo kết nối NGAY (không chờ mở lại): hết nhãn đỏ "phải nối …".
    expect(update.style).toContain('edgeStyle=orthogonalEdgeStyle');
    expect(update.style).toContain('imsPaint=cable-2');
    expect(update.style).not.toContain('exitX');
    expect(update.xmlValue).toContain('label=""');
    expect(update.xmlValue).toContain('ims_port_labels="ends"');
    expect(update.xmlValue).toContain('ims_link_id="link-1"');
    expect(await screen.findByText('Đã đi lại 1 dây, nối lại 1 đầu dây về đúng máy. Bấm Lưu để giữ.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lưu' })).toBeEnabled();
  });

  it('dán một dây đã khai từ bản vẽ KHÁC (kết nối màn không biết) → bản dán bỏ ims_link_id, thành nét tự do', async () => {
    const { fromDrawio, messages, answerFile } = await openEditor(file(DEVICES), { links: [LINK] });
    const pasted = linked('e9', 'a', '', 'link-khac');
    fromDrawio({ event: 'autosave', xml: model(DEVICES) });
    fromDrawio({ event: 'autosave', xml: model(DEVICES + pasted) });
    await answerFile(DEVICES + pasted);
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'patch')).toBe(true));
    const patch = messages().find((m) => m.action === 'patch') as { patch: { u: { p1: { cells: { u: Record<string, { xmlValue: string }> } } } } };
    expect(patch.patch.u.p1.cells.u.e9.xmlValue).not.toContain('ims_link_id');
  });

  it('kết nối mới chưa vẽ → "Có 1 kết nối mới chưa vẽ" + "Vẽ vào" chèn nét đã gắn link, không ghi kho', async () => {
    const { fetchMock, messages, answerFile } = await openEditor(file(DEVICES), { links: [LINK], undrawnLinkIds: ['link-1'] });
    const user = userEvent.setup();
    expect(await screen.findByText(/Có 1 kết nối mới chưa vẽ/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vẽ vào' }));
    await answerFile(DEVICES);
    await vi.waitFor(() => expect(messages().some((m) => m.action === 'patch')).toBe(true));
    const patch = messages().find((m) => m.action === 'patch') as { patch: { u: { p1: { cells: { i: Record<string, unknown>[] } } } } };
    expect(patch.patch.u.p1.cells.i[0]).toMatchObject({ edge: 1, source: 'a', target: 'b' });
    expect(String(patch.patch.u.p1.cells.i[0].xmlValue)).toContain('ims_link_id="link-1"');
    expect(String(patch.patch.u.p1.cells.i[0].xmlValue)).toContain('label=""');
    expect(String(patch.patch.u.p1.cells.i[0].xmlValue)).toContain('ims_port_labels="ends"');
    // Hai ô nhãn đầu dây: lệnh thứ hai, khi nét đã có trong mô hình.
    const edgeId = String(patch.patch.u.p1.cells.i[0].id);
    const ends = messages().filter((m) => m.action === 'patch')[1] as { patch: { u: { p1: { cells: { i: { id: string; parent: string; value: string }[] } } } } };
    expect(ends.patch.u.p1.cells.i.map((c) => [c.id, c.parent, c.value])).toEqual([
      [`${edgeId}-ims-ps`, edgeId, 'Gi1/0/24'],
      [`${edgeId}-ims-pt`, edgeId, 'eth0'],
    ]);
    expect(screen.queryByText(/kết nối mới chưa vẽ/)).toBeNull();
    // Không ghi sơ đồ cổng.
    expect((fetchMock.mock.calls as unknown as [string, RequestInit | undefined][]).filter(([url, init]) => String(url).includes('/api/v1/devices/') && init?.method === 'POST')).toEqual([]);
  });
});

describe('Tab Sửa — thẻ của ô đang chọn (Q-23 06/10, không plugin)', () => {
  const SW_INFO = {
    id: 'dev-sw',
    found: true,
    code: 'SW-E2E-01',
    name: 'Switch',
    deviceTypeName: 'Switch',
    model: 'C9200-24T',
    serial: null,
    status: 'in_use',
    ips: ['10.0.0.2'],
    siteCode: 'HQ',
    cabinetCode: 'TU-01',
    u: 30,
    uSize: 1,
    vendorName: null,
    vendorPhone: null,
    warrantyEnd: null,
    ports: { used: 12, declared: 24 },
    cell: { style: '', label: '', width: 1, height: 1 },
  };
  const selection = (cells: Record<string, unknown>[]) => ({ event: 'export', format: 'json', data: { pages: [{ id: 'p1', cells }] } });

  it('khung trình vẽ có tiêu điểm → hỏi ô đang chọn bằng export json; rời khung thì thôi hỏi', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { messages } = await openEditor(file(DEVICES), {});
      const frame = screen.getByTitle('Khung vẽ draw.io');
      const asked = () => messages().filter((m) => m.action === 'export' && m.format === 'json' && m.selection === 1).length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(asked()).toBe(0);
      frame.focus();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      expect(asked()).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('chọn một máy → thẻ (IP, model, vị trí, cổng 12/24, trạng thái); "Chi tiết" mở thẻ chi tiết ngay tại màn sửa, "Mở hồ sơ" mở tab mới', async () => {
    const { fromDrawio } = await openEditor(file(DEVICES), { devices: [SW_INFO], deviceCells: [{ cellId: 'a', deviceId: 'dev-sw', code: 'SW-E2E-01' }] }, {
      '/api/v1/diagrams/by-device/dev-sw': () => jsonResponse(200, []),
    });
    fromDrawio(selection([{ id: 'a', type: 'node', metadata: { ims_device_id: 'dev-sw', ims_device_code: 'SW-E2E-01' } }]));
    const card = await screen.findByRole('region', { name: 'Đang chọn trên bản vẽ' });
    expect(card).toHaveTextContent('SW-E2E-01');
    expect(card).toHaveTextContent('10.0.0.2');
    expect(card).toHaveTextContent('C9200-24T');
    expect(card).toHaveTextContent('HQ · TU-01 · U30');
    expect(card).toHaveTextContent('12/24');
    expect(card).toHaveTextContent('Đang dùng');
    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Chi tiết' }));
    const dialog = await screen.findByRole('dialog', { name: 'SW-E2E-01' });
    const record = within(dialog).getByRole('link', { name: 'Mở hồ sơ' });
    expect(record).toHaveAttribute('target', '_blank');
    expect(record).toHaveAttribute('href', '/devices/dev-sw');
    // Bỏ chọn trong trình vẽ → thẻ tắt.
    fromDrawio(selection([]));
    await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Đang chọn trên bản vẽ' })).toBeNull());
  });

  it('máy vừa chèn (chưa có trong nội dung lúc mở) → thẻ tự đọc thông tin kho của máy đó', async () => {
    const { fromDrawio } = await openEditor(file(DEVICES), {}, {
      '/api/v1/diagrams/device-info': () => jsonResponse(200, [SW_INFO]),
    });
    fromDrawio(selection([{ id: 'a', type: 'node', metadata: { ims_device_id: 'dev-sw', ims_device_code: 'SW-E2E-01' } }]));
    const card = await screen.findByRole('region', { name: 'Đang chọn trên bản vẽ' });
    await vi.waitFor(() => expect(card).toHaveTextContent('12/24'));
  });

  it('chọn một dây đã khai → thẻ "A:cổng ↔ B:cổng", loại dây; hình tự do → không thẻ', async () => {
    const { fromDrawio } = await openEditor(file(DEVICES + linked('e1', 'a', 'b', 'link-1')), { links: [LINK] });
    fromDrawio(selection([{ id: 'e1', type: 'edge', source: 'a', target: 'b', metadata: { ims_link_id: 'link-1' } }]));
    const card = await screen.findByRole('region', { name: 'Đang chọn trên bản vẽ' });
    expect(card).toHaveTextContent('SW-E2E-01:Gi1/0/24 ↔ SRV-E2E-01:eth0');
    expect(card).toHaveTextContent('Fiber');
    fromDrawio(selection([{ id: 'shape-1', type: 'node' }]));
    await vi.waitFor(() => expect(screen.queryByRole('region', { name: 'Đang chọn trên bản vẽ' })).toBeNull());
  });
});

describe('Chế độ xem — màu dây, tô sáng, thẻ dây, mũi tên sang bản vẽ khác', () => {
  const SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><g data-cell-id="0"><g data-cell-id="1">' +
    '<g data-cell-id="a"><rect width="10" height="10"/><text>SW-E2E-01</text></g>' +
    '<g data-cell-id="b"><rect width="10" height="10"/><text>SRV-E2E-01</text></g>' +
    '<g data-cell-id="c"><rect width="10" height="10"/><text>AP-E2E-01</text></g>' +
    '<g data-cell-id="e1"><path d="M0 0L1 1"/></g><g data-cell-id="e2"><path d="M0 0L1 1"/></g><g data-cell-id="e3"><path d="M0 0L1 1"/></g></g></g></svg>';
  const EXTERNAL: DiagramLink = {
    ...LINK,
    id: 'link-out',
    portLabel: 'Te1/0/1',
    peerDeviceId: 'dev-core',
    peerDeviceCode: 'CORE-E2E-01',
    peerPort: 'Te1/0/48',
    labelFromA: 'Te1/0/1 ↔ Te1/0/48',
    labelFromB: 'Te1/0/48 ↔ Te1/0/1',
  };
  const deviceInfo = (id: string, code: string) => ({
    id,
    found: true,
    code,
    name: code,
    deviceTypeName: 'Switch',
    model: null,
    serial: null,
    status: 'in_use',
    ips: [],
    siteCode: null,
    cabinetCode: null,
    u: null,
    vendorName: null,
    vendorPhone: null,
    warrantyEnd: null,
    cell: { style: '', label: code, width: 60, height: 60 },
  });

  function openViewer() {
    routeFetch(
      base(
        {
          version: { ...VERSION, xml: '<mxfile/>', svg: SVG },
          deviceCells: [
            { cellId: 'a', deviceId: 'dev-sw', code: 'SW-E2E-01' },
            { cellId: 'b', deviceId: 'dev-srv', code: 'SRV-E2E-01' },
            { cellId: 'c', deviceId: 'dev-ap', code: 'AP-E2E-01' },
          ],
          devices: [deviceInfo('dev-sw', 'SW-E2E-01'), deviceInfo('dev-srv', 'SRV-E2E-01'), deviceInfo('dev-ap', 'AP-E2E-01')],
          cableEdges: [
            { cellId: 'e1', linkId: 'link-1', state: 'linked', sourceDeviceId: 'dev-sw', targetDeviceId: 'dev-srv' },
            { cellId: 'e2', linkId: null, state: 'undeclared', sourceDeviceId: 'dev-srv', targetDeviceId: 'dev-ap' },
            { cellId: 'e3', linkId: 'link-gone', state: 'removed', sourceDeviceId: 'dev-ap', targetDeviceId: 'dev-sw' },
          ],
          links: [LINK, EXTERNAL],
          externalLinkIds: ['link-out'],
        },
        {
          '/api/v1/diagrams/by-device/dev-core': () => jsonResponse(200, [{ id: 'd9', name: 'Phòng server E2E' }]),
          '/api/v1/diagrams/by-device/': () => jsonResponse(200, [ROOT]),
        },
      ),
    );
    return renderWithI18n(
      <MemoryRouter initialEntries={['/diagrams/d1']}>
        <ToastProvider>
          <ConfirmProvider>
            <Routes>
              <Route path="/diagrams/:id" element={<DiagramScreen me={ME} />} />
            </Routes>
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
  }

  it('nét dây mang ô màu theo loại dây; nét chưa khai vàng; nét có kết nối đã gỡ đỏ; có chú giải', async () => {
    openViewer();
    const linkedEdge = await screen.findByRole('button', { name: 'Gi1/0/24 ↔ eth0' });
    expect(linkedEdge).toHaveAttribute('data-ims-paint', 'cable-2');
    expect(screen.getByRole('button', { name: 'Chưa khai vào sơ đồ cổng.' })).toHaveAttribute('data-ims-paint', 'warn');
    expect(screen.getByRole('button', { name: 'Kết nối đã bị gỡ khỏi sơ đồ cổng.' })).toHaveAttribute('data-ims-paint', 'danger');
    const legend = screen.getByRole('list', { name: 'Chú giải màu dây' });
    expect(legend).toHaveTextContent('Fiber');
    expect(legend).toHaveTextContent('Chưa khai vào sơ đồ cổng');
  });

  it('bấm thiết bị: dây của nó + máy đầu kia sáng, phần còn lại mờ; thẻ có mũi tên sang bản vẽ khác', async () => {
    openViewer();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'SW-E2E-01' }));
    const dimmed = Array.from(document.querySelectorAll('[data-ims-dim]')).map((el) => el.getAttribute('data-cell-id'));
    // e3 (kết nối đã gỡ) cũng chạm SW nên AP là máy đầu kia — chỉ nét SRV↔AP mờ.
    expect(dimmed.sort()).toEqual(['e2']);
    const card = await screen.findByRole('dialog', { name: 'SW-E2E-01' });
    const arrow = await within(card).findByRole('link', { name: '→ CORE-E2E-01 (bản vẽ Phòng server E2E)' });
    expect(arrow).toHaveAttribute('href', '/diagrams/d9?focus=dev-core');
    expect(card).toHaveTextContent('Gi1/0/24 ↔ eth0');
    await user.keyboard('{Escape}');
    expect(screen.getByText('Đang tô sáng dây của SW-E2E-01.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bỏ tô sáng' }));
    expect(document.querySelectorAll('[data-ims-dim]')).toHaveLength(0);
  });

  it('bấm dây: thẻ dây (cổng hai đầu, loại dây, VLAN); nét "Chỉ vẽ" nói chưa khai', async () => {
    openViewer();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Gi1/0/24 ↔ eth0' }));
    const card = await screen.findByRole('dialog', { name: /^Dây SW-E2E-01 Gi1\/0\/24/ });
    expect(card).toHaveTextContent('Fiber');
    expect(card).toHaveTextContent('20');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Chưa khai vào sơ đồ cổng.' }));
    expect(await screen.findByRole('dialog', { name: /^Dây/ })).toHaveTextContent('Chưa khai vào sơ đồ cổng.');
  });
});

describe('Dây chưa khai — mở lại hộp khai', () => {
  it('liệt kê nét chưa khai và nét có kết nối đã gỡ; bấm một nét mở đúng hộp "Khai"', async () => {
    const xml = file(DEVICES + edge('e1', 'a', 'b') + linked('e2', 'b', 'a', 'link-gone'));
    await openEditor(xml, {
      cableEdges: [
        { cellId: 'e1', linkId: null, state: 'undeclared', sourceDeviceId: 'dev-sw', targetDeviceId: 'dev-srv' },
        { cellId: 'e2', linkId: 'link-gone', state: 'removed', sourceDeviceId: 'dev-srv', targetDeviceId: 'dev-sw' },
      ],
    }, { '/api/v1/devices/': () => jsonResponse(200, { ports: [], incoming: [] }) });
    const user = userEvent.setup();
    await pickMenuItem(user, /^Thao tác với/, 'Dây chưa khai');
    const box = screen.getByRole('dialog', { name: 'Nét dây chưa khai vào sơ đồ cổng' });
    expect(within(box).getByRole('button', { name: 'SW-E2E-01 ↔ SRV-E2E-01' })).toBeInTheDocument();
    await user.click(within(box).getByRole('button', { name: 'SRV-E2E-01 ↔ SW-E2E-01' }));
    const declare = await screen.findByRole('dialog', { name: 'Khai kết nối này vào sơ đồ cổng?' });
    expect(within(declare).getByRole('combobox', { name: 'Cổng của SRV-E2E-01' })).toBeInTheDocument();
  });
  it('kết nối gỡ ở trang Thiết bị khi bản vẽ đang mở: hỏi lại server trên XML đang vẽ, nét hiện trong danh sách', async () => {
    const xml = file(DEVICES + linked('e2', 'b', 'a', 'link-gone'));
    const { fetchMock } = await openEditor(
      xml,
      { cableEdges: [{ cellId: 'e2', linkId: 'link-gone', state: 'linked', sourceDeviceId: 'dev-srv', targetDeviceId: 'dev-sw' }] },
      {
        '/api/v1/diagrams/cable-status': () =>
          jsonResponse(200, { edges: [{ cellId: 'e2', linkId: 'link-gone', state: 'removed', sourceDeviceId: 'dev-srv', targetDeviceId: 'dev-sw' }], undrawn: [] }),
      },
    );
    const user = userEvent.setup();
    await pickMenuItem(user, /^Thao tác với/, 'Dây chưa khai');
    const box = screen.getByRole('dialog', { name: 'Nét dây chưa khai vào sơ đồ cổng' });
    expect(await within(box).findByRole('button', { name: 'SRV-E2E-01 ↔ SW-E2E-01' })).toBeInTheDocument();
    const sent = calls(fetchMock, '/api/v1/diagrams/cable-status').at(-1);
    expect(JSON.parse(String(sent?.[1]?.body)).xml).toContain('link-gone');
  });
});
