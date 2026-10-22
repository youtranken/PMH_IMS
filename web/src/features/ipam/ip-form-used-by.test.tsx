import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';
import { IpForm } from './subnet-detail';
import type { IpRow } from './ipam-types';

/**
 * LF-03 (Q-33): hộp Sửa IP — IP gắn máy lấy người dùng theo máy (chỉ đọc, không gửi bản sao);
 * IP không gắn máy giữ ô tự ghi.
 */

function mockFetch() {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      });
      if (url.startsWith('/api/v1/catalog')) {
        return Promise.resolve(jsonResponse(200, { departments: [] }));
      }
      return Promise.resolve(jsonResponse(200, {}));
    }),
  );
  return calls;
}

const RECORD: IpRow = {
  id: 'ip-1',
  subnetId: 'sub-1',
  address: '10.77.1.5',
  deviceId: 'dev-1',
  deviceCode: 'PC-E2E-1',
  deviceName: 'Máy kế toán',
  deviceSiteCode: null,
  usedBy: 'Chị Mới — Kế toán',
  assignedBy: 'e2e',
  assignedAt: '2026-01-02',
  status: 'assigned',
  note: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  voidedAt: null,
  voidedBy: null,
  voidReason: null,
};

function render(record: IpRow, onSaved = vi.fn()) {
  renderWithI18n(
    <ToastProvider>
      <IpForm record={record} csrfToken="t" onClose={vi.fn()} onSaved={onSaved} />
    </ToastProvider>,
  );
  return onSaved;
}

describe('Sửa IP — người dùng theo máy (LF-03)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('IP gắn máy: người dùng đọc theo máy, không có ô gõ; Lưu gửi usedBy rỗng', async () => {
    const calls = mockFetch();
    const onSaved = render(RECORD);
    expect(await screen.findByText('Chị Mới — Kế toán')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Người dùng / phòng ban' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      deviceId: 'dev-1',
      usedBy: '',
    });
  });

  it('IP không gắn máy: giữ ô tự ghi', async () => {
    mockFetch();
    render({ ...RECORD, deviceId: null, deviceCode: null, deviceName: null, usedBy: 'Máy chấm công' });
    expect(await screen.findByRole('combobox', { name: 'Người dùng / phòng ban' })).toHaveValue(
      'Máy chấm công',
    );
  });
});
