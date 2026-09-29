import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { SoftwareDetail } from './software-detail';
import { RestoreDialog } from './software-restore-dialog';
import { isoDay, plusOneYear } from './software-standing';
import type { SoftwareDetailRow } from './software-types';

/**
 * SW-033 / SW-034 — hồ sơ Thanh lý: không có Gia hạn, có băng nói rõ đã thanh lý ra sao và
 * một hộp Khôi phục gọi đúng PATCH của Sửa hồ sơ rồi gán lại ghế qua API gán sẵn có.
 */

const BASE: SoftwareDetailRow = {
  id: 'sw-1',
  code: 'LIC-E2E-M365',
  name: 'Microsoft 365',
  kind: 'license',
  licenseModel: 'subscription',
  vendorId: null,
  vendorName: null,
  seatTotal: 3,
  seatUsed: 0,
  startDate: null,
  endDate: '2026-08-01',
  note: null,
  status: 'retired',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  autoRetireOn: null,
  retirement: { at: '2026-09-01T02:00:00Z', by: 'system', auto: true },
};

const ME = { role: 'member', csrfToken: 'csrf' } as unknown as Me;

const HISTORY = [
  { deviceId: 'd-1', deviceCode: 'PC-01', deviceName: 'Máy kế toán', releasedAt: '2026-09-01T02:00:00Z' },
  { deviceId: 'd-2', deviceCode: 'PC-02', deviceName: 'Máy xưởng', releasedAt: '2026-09-01T02:00:00Z' },
];

function mockFetch(detail: SoftwareDetailRow) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === `/api/v1/software/${detail.id}` && method === 'GET') {
        return Promise.resolve(jsonResponse(200, detail));
      }
      if (url.includes('/assignments?includeReleased=true')) {
        return Promise.resolve(jsonResponse(200, HISTORY));
      }
      if (url.endsWith('/assignments') && method === 'POST') {
        return Promise.resolve(jsonResponse(201, { assignment: {}, warnings: [] }));
      }
      return Promise.resolve(jsonResponse(200, method === 'GET' ? [] : {}));
    }),
  );
  return calls;
}

function renderDetail(detail: SoftwareDetailRow) {
  return renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter initialEntries={[`/software/${detail.id}`]}>
          <Routes>
            <Route path="/software/:id" element={<SoftwareDetail me={ME} />} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe('Trang chi tiết phần mềm — Gia hạn / Khôi phục', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hồ sơ Thanh lý: không có Gia hạn; băng nói ngày + tự động sau N ngày; có Khôi phục…', async () => {
    mockFetch(BASE);
    renderDetail(BASE);
    expect(await screen.findByText(/Đã thanh lý ngày 01\/09\/2026 · tự động sau 31 ngày hết hạn/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gia hạn' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Khôi phục…' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Đưa vào kho thanh lý' })).not.toBeInTheDocument();
  });

  it('người thanh lý: băng ghi "bởi <email>"', async () => {
    const detail = { ...BASE, retirement: { at: '2026-09-01T02:00:00Z', by: 'a@pmh.com.vn', auto: false } };
    mockFetch(detail);
    renderDetail(detail);
    expect(await screen.findByText(/bởi a@pmh.com.vn/)).toBeInTheDocument();
  });

  it('license vĩnh viễn đang dùng: không có Gia hạn, không có Khôi phục', async () => {
    const detail: SoftwareDetailRow = {
      ...BASE,
      licenseModel: 'perpetual',
      endDate: null,
      status: 'active',
      retirement: null,
    };
    mockFetch(detail);
    renderDetail(detail);
    expect(await screen.findByRole('button', { name: 'Sửa hồ sơ' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gia hạn' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Khôi phục…' })).not.toBeInTheDocument();
  });

  it('thuê bao đang dùng: vẫn có Gia hạn', async () => {
    const detail: SoftwareDetailRow = { ...BASE, endDate: '2099-01-01', status: 'active', retirement: null };
    mockFetch(detail);
    renderDetail(detail);
    expect(await screen.findByRole('button', { name: 'Gia hạn' })).toBeInTheDocument();
  });
});

describe('Hộp Khôi phục', () => {
  afterEach(() => vi.unstubAllGlobals());

  function renderDialog(detail: SoftwareDetailRow, onDone = vi.fn()) {
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <RestoreDialog software={detail} csrfToken="csrf" onClose={() => {}} onDone={onDone} />
        </ConfirmProvider>
      </ToastProvider>,
    );
    return onDone;
  }

  it('hạn mới +1 năm sẵn; tick một máy → PATCH Sửa hồ sơ rồi POST gán đúng máy đó', async () => {
    const calls = mockFetch(BASE);
    const onDone = renderDialog(BASE);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: /PC-02/ }));
    await user.click(screen.getByRole('button', { name: 'Khôi phục' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ assigned: 1, failures: [] }));
    const writes = calls.filter((call) => call.method !== 'GET');
    expect(writes).toEqual([
      {
        url: '/api/v1/software/sw-1',
        method: 'PATCH',
        body: { status: 'active', endDate: plusOneYear(isoDay(new Date())) },
      },
      { url: '/api/v1/software/sw-1/assignments', method: 'POST', body: { deviceId: 'd-2' } },
    ]);
  });

  it('tick nhiều máy hơn số ghế: báo lỗi trong hộp, không gửi gì', async () => {
    const calls = mockFetch(BASE);
    const onDone = renderDialog({ ...BASE, seatTotal: 1 });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: /PC-01/ }));
    await user.click(screen.getByRole('checkbox', { name: /PC-02/ }));
    await user.click(screen.getByRole('button', { name: 'Khôi phục' }));

    expect(await screen.findByText(/Hồ sơ chỉ có 1 ghế/)).toBeInTheDocument();
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
    expect(onDone).not.toHaveBeenCalled();
  });
});
