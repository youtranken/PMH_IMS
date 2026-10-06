import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { PortFace } from './port-face';

function mockPanel(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, body))));
}

afterEach(() => vi.unstubAllGlobals());

describe('Mặt cổng (Q-26)', () => {
  it('ô đang dùng / trống có chữ, bấm ô thấy đầu kia; "Hiện cả cổng trống (n)" bung danh sách', async () => {
    mockPanel({
      ports: [
        { label: 'p1', kind: 'rj45', peer: 'PC-E2E · eth0' },
        { label: 'p2', kind: 'rj45', peer: null },
        { label: 'p3', kind: 'sfp', peer: null },
      ],
      unlisted: [],
      used: 1,
      total: 3,
    });
    renderWithI18n(<PortFace deviceId="d1" />);
    const grid = await screen.findByRole('list', { name: 'Mặt cổng' });
    expect(within(grid).getByRole('button', { name: 'p1 → PC-E2E · eth0' })).toBeInTheDocument();
    expect(within(grid).getByRole('button', { name: 'p2 — trống' })).toBeInTheDocument();
    expect(screen.getByText('đang dùng 1/3')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(grid).getByRole('button', { name: 'p1 → PC-E2E · eth0' }));
    expect(screen.getByRole('status')).toHaveTextContent('p1 → PC-E2E · eth0');
    await user.click(screen.getByRole('button', { name: 'Hiện cả cổng trống (2)' }));
    expect(screen.getByLabelText('Cổng trống')).toHaveTextContent('p2, p3');
  });

  it('máy chưa có danh sách cổng: không vẽ gì (sơ đồ cổng chạy như trước)', async () => {
    mockPanel({ ports: [], unlisted: [], used: 0, total: 0 });
    const { container } = renderWithI18n(<PortFace deviceId="d1" />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
