import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { SoftwareRenewals } from './software-renewals';

afterEach(() => vi.unstubAllGlobals());

// Cùng cách gọi người như màn Sắp hết hạn: họ tên, email ở chú thích; không tra được thì email.
describe('Sổ gia hạn — cột người gia hạn', () => {
  it('hiện họ tên (email ở title), lùi về email khi không có tên', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(200, [
            {
              id: 'r1',
              oldEnd: '2025-01-01',
              newEnd: '2026-01-01',
              contract: null,
              cost: null,
              websites: null,
              actor: 'a@pmh.com.vn',
              actorName: 'Nguyễn Văn A',
              createdAt: '2025-12-20T01:00:00.000Z',
            },
            {
              id: 'r2',
              oldEnd: null,
              newEnd: '2025-01-01',
              contract: null,
              cost: null,
              websites: null,
              actor: 'nghi-viec@pmh.com.vn',
              actorName: null,
              createdAt: '2024-12-20T01:00:00.000Z',
            },
          ]),
        ),
      ),
    );
    renderWithI18n(<SoftwareRenewals softwareId="s1" />);
    const named = await screen.findByText('Nguyễn Văn A');
    expect(named).toHaveAttribute('title', 'a@pmh.com.vn');
    expect(screen.queryByText('a@pmh.com.vn')).not.toBeInTheDocument();
    expect(screen.getByText('nghi-viec@pmh.com.vn')).toBeInTheDocument();
  });
});
