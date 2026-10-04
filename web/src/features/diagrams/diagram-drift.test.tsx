import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within, pickMenuItem } from '@/test/test-utils';
import type { DiagramNode, Finding } from './diagram-api';
import { DiagramScreen } from './diagram-screen';
import { DiagramTreeScreen } from './diagram-tree-screen';

/**
 * Cảnh báo lệch kho (Q-23 "không ép sửa"): dấu trên ô kèm cái đã đổi, "Có N thay đổi chưa vẽ" +
 * hộp "Kiểm tra khớp dữ liệu" bấm mục bay tới ô, cây hiện "Lệch kho (N)". Không nút nào sửa gì.
 */

const ME = { id: 'u1', email: 'sa@e2e.local', fullName: 'SA E2E', role: 'sa', csrfToken: 'c' } as unknown as Me;

const NODE: DiagramNode = {
  id: 'd1',
  parentId: null,
  name: 'Phòng server E2E',
  nodeType: 'room',
  siteId: null,
  cabinetId: null,
  ownerEmail: null,
  kind: 'official',
  archivedAt: null,
  status: 'official',
  latestVersion: null,
};

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">' +
  '<g data-cell-id="c1"><rect width="10" height="10"/></g>' +
  '<g data-cell-id="c2"><rect x="100" width="10" height="10"/></g>' +
  '</svg>';

const VERSION = { id: 'v1', seq: 3, summary: 'x', label: null, savedBy: 'a', savedByName: null, savedAt: '2026-10-03T01:00:00Z', basedOnVersionId: null, restoredFromSeq: null };

const device = (id: string, code: string, extra: Record<string, unknown> = {}) => ({
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
  cell: { style: '', label: code, width: 80, height: 40 },
  ...extra,
});

function content(drift: Finding[]) {
  return {
    diagram: NODE,
    version: { ...VERSION, xml: '<mxfile/>', svg: SVG, deviceSnapshot: [] },
    deviceCells: [
      { cellId: 'c1', deviceId: 'dev1', code: 'SW-E2E-01' },
      { cellId: 'c2', deviceId: 'dev2', code: 'SRV-E2E-01' },
    ],
    devices: [device('dev1', 'SW-E2E-01', { ips: ['10.0.1.9'] }), device('dev2', 'SRV-E2E-01', { status: 'retired' })],
    cableEdges: [],
    links: [],
    undrawnLinkIds: [],
    externalLinkIds: [],
    cableTypes: [],
    drift,
  };
}

const DRIFT: Finding[] = [
  { level: 'error', code: 'DEVICE_RETIRED', cellId: 'c2', message: 'Thiết bị SRV-E2E-01 đã thanh lý nhưng vẫn nằm trên bản vẽ — gỡ hình này trước khi phát hành.' },
  { level: 'warning', code: 'DRIFT_IP', cellId: 'c1', message: 'Thiết bị SW-E2E-01: IP 10.0.1.5 → 10.0.1.9' },
];

function routeFetch(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const hit = Object.keys(routes).find((path) => url.includes(path));
    return Promise.resolve(hit ? routes[hit]() : jsonResponse(404, { code: 'NOT_FOUND' }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function open(drift: Finding[]) {
  const fetchMock = routeFetch({
    '/api/v1/diagrams/editor-settings': () => jsonResponse(200, { initTimeoutSeconds: 20, presenceTtlSeconds: 60 }),
    '/api/v1/diagrams/d1/content': () => jsonResponse(200, content(drift)),
    '/api/v1/diagrams/d1': () => jsonResponse(200, NODE),
  });
  renderWithI18n(
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
  return fetchMock;
}

const cell = (id: string) => document.querySelector(`[data-cell-id="${id}"]`)!;

beforeEach(() => vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
afterEach(() => vi.unstubAllGlobals());

describe('Lệch kho trên màn xem bản vẽ', () => {
  it('ô lệch mang dấu + tên trợ năng nói cái đã đổi; thanh trên báo "Có N thay đổi chưa vẽ"', async () => {
    open(DRIFT);
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    expect(await screen.findByRole('button', { name: 'Có 2 thay đổi chưa vẽ' })).toBeInTheDocument();
    await waitFor(() => expect(cell('c1')).toHaveAttribute('data-ims-mark', 'warn'));
    expect(cell('c1').getAttribute('aria-label')).toContain('IP 10.0.1.5 → 10.0.1.9');
    expect(cell('c2')).toHaveAttribute('data-ims-mark', 'danger');
  });

  it('"Kiểm tra khớp dữ liệu" liệt kê từng mục; bấm một mục thì đóng hộp và bay tới đúng ô', async () => {
    const fetchMock = open(DRIFT);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Có 2 thay đổi chưa vẽ' }));
    const dialog = await screen.findByRole('dialog', { name: 'Kiểm tra khớp dữ liệu' });
    expect(dialog).toHaveTextContent('Thiết bị SW-E2E-01: IP 10.0.1.5 → 10.0.1.9');
    expect(dialog).toHaveTextContent('SRV-E2E-01 đã thanh lý');
    const writesBefore = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').length;
    const items = within(dialog).getAllByRole('listitem');
    const ipItem = items.find((li) => li.textContent?.includes('IP 10.0.1.5'))!;
    await user.click(within(ipItem).getByRole('button', { name: 'Xem trên bản vẽ' }));
    expect(screen.queryByRole('dialog', { name: 'Kiểm tra khớp dữ liệu' })).toBeNull();
    await waitFor(() => expect(cell('c1')).toHaveAttribute('data-ims-selected'));
    // Không ép sửa: mở hộp và bay tới không ghi gì.
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST').length).toBe(writesBefore);
  });

  it('không lệch: không có lời báo trên thanh, nút "Kiểm tra khớp" vẫn mở hộp và nói khớp', async () => {
    open([]);
    await screen.findByRole('region', { name: 'Bản vẽ, chỉ xem' });
    expect(screen.queryByRole('button', { name: /thay đổi chưa vẽ/ })).toBeNull();
    await pickMenuItem(userEvent.setup(), /^Thao tác với/, 'Kiểm tra khớp');
    const dialog = await screen.findByRole('dialog', { name: 'Kiểm tra khớp dữ liệu' });
    expect(dialog).toHaveTextContent('Bản vẽ khớp với dữ liệu kho.');
  });
});

describe('Cây bản vẽ — dấu lệch kho', () => {
  it('bản chính thức có lệch hiện "Lệch kho (N)", bản không lệch thì không', async () => {
    routeFetch({
      '/versions': () => jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 }),
      '/publications': () => jsonResponse(401, { code: 'STEPUP_REQUIRED', scope: 'diagram', graceMinutes: 10 }),
      '/api/v1/diagrams': () =>
        jsonResponse(200, [
          { ...NODE, driftCount: 2 },
          { ...NODE, id: 'd2', parentId: NODE.id, name: 'Tầng 1 E2E', driftCount: 0 },
        ]),
    });
    renderWithI18n(
      <MemoryRouter initialEntries={['/diagrams']}>
        <ToastProvider>
          <ConfirmProvider>
            <Routes>
              <Route path="/diagrams" element={<DiagramTreeScreen me={ME} />} />
            </Routes>
          </ConfirmProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    // Băng gốc (lệch) rồi khu con (không lệch) trên bản đồ.
    const map = await screen.findByRole('region', { name: 'Bản đồ bản vẽ' });
    const [banner, area] = Array.from(map.querySelectorAll<HTMLElement>('.dmap-banner, .dmap-area-head'));
    expect(banner).toHaveTextContent('Lệch kho (2)');
    expect(area).toHaveTextContent('Tầng 1 E2E');
    expect(area).not.toHaveTextContent('Lệch kho');
  });
});
