import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor, within } from '@/test/test-utils';
import { AssignDialog } from './assign-dialog';
import type { SoftwareRow } from './software-types';

/**
 * SW-053 — gán license cho NHIỀU máy một lượt, điều khoản ghế dùng chung cho cả lô. Gửi TUẦN
 * TỰ từng máy; hỏng giữa chừng thì dừng, bỏ máy đã gán khỏi lô, nói rõ máy hỏng.
 */

afterEach(() => vi.unstubAllGlobals());

const SOFTWARE: SoftwareRow = {
  id: 'sw1',
  code: 'LIC-E2E-LO',
  name: 'Office',
  kind: 'license',
  licenseModel: 'subscription',
  vendorId: null,
  vendorName: null,
  seatTotal: 10,
  seatUsed: 0,
  startDate: null,
  endDate: '2030-01-01',
  note: null,
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  autoRetireOn: null,
};

const DEVICES = [
  { id: 'd1', code: 'PC-E2E-01', name: 'Máy 1' },
  { id: 'd2', code: 'PC-E2E-02', name: 'Máy 2' },
];

function mockFetch(failOn?: string) {
  const posts: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/devices')) {
        return Promise.resolve(jsonResponse(200, { items: DEVICES }));
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      posts.push(body);
      if (body.deviceId === failOn) {
        return Promise.resolve(
          jsonResponse(400, { code: 'SEAT_LIMIT_REACHED', message: 'Hết ghế.' }),
        );
      }
      return Promise.resolve(jsonResponse(201, { assignment: { id: `a-${String(body.deviceId)}` } }));
    }),
  );
  return posts;
}

async function pick(code: string) {
  const box = screen.getByPlaceholderText('Tìm máy trong kho…');
  await userEvent.type(box, 'PC-E2E');
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(code) }));
}

function render(onDone = vi.fn()) {
  renderWithI18n(
    <ToastProvider>
      <AssignDialog software={SOFTWARE} csrfToken="t" onClose={vi.fn()} onDone={onDone} />
    </ToastProvider>,
  );
  return onDone;
}

describe('AssignDialog — gán nhiều máy một lượt', () => {
  it('chọn hai máy thành chip, gửi hai lượt cùng điều khoản, báo số máy', async () => {
    const posts = mockFetch();
    const onDone = render();
    await pick('PC-E2E-01');
    await pick('PC-E2E-02');
    const chips = screen.getByRole('list', { name: 'Máy sẽ gán' });
    expect(within(chips).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'PC-E2E-01✕',
      'PC-E2E-02✕',
    ]);
    await userEvent.type(screen.getByRole('textbox', { name: 'Hợp đồng' }), 'HD-01');
    await userEvent.click(screen.getByRole('button', { name: 'Gán 2 máy' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith([], 2));
    expect(posts.map((body) => [body.deviceId, body.contract])).toEqual([
      ['d1', 'HD-01'],
      ['d2', 'HD-01'],
    ]);
  });

  it('máy thứ hai hỏng → dừng, máy đã gán rời lô, câu lỗi nêu máy hỏng', async () => {
    mockFetch('d2');
    const onDone = render();
    await pick('PC-E2E-01');
    await pick('PC-E2E-02');
    await userEvent.click(screen.getByRole('button', { name: 'Gán 2 máy' }));
    expect(await screen.findByText(/Đã gán 1 máy, dừng ở PC-E2E-02/)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    const chips = screen.getByRole('list', { name: 'Máy sẽ gán' });
    expect(within(chips).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'PC-E2E-02✕',
    ]);
  });

  it('bỏ một máy khỏi lô bằng nút ✕ của chip', async () => {
    mockFetch();
    render();
    await pick('PC-E2E-01');
    await userEvent.click(screen.getByRole('button', { name: 'Bỏ PC-E2E-01 khỏi lô' }));
    expect(screen.queryByRole('list', { name: 'Máy sẽ gán' })).toBeNull();
  });
});
