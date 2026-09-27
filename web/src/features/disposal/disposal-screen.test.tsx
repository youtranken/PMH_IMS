import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { DisposalScreen } from './disposal-screen';

const DEVICE = {
  kind: 'device',
  id: 'd1',
  code: 'PC-E2E-01',
  name: 'Máy cũ',
  detail: 'PC',
  status: 'retired',
  updatedAt: '2026-09-20T01:30:00.000Z',
};

function renderWith(truncated: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(jsonResponse(200, { items: [DEVICE], truncated }))),
  );
  return renderWithI18n(
    <MemoryRouter>
      <DisposalScreen />
    </MemoryRouter>,
  );
}

/**
 * OLD-BE-02 — mỗi loại chỉ tải tối đa một trần dòng. Loại bị cắt thì màn phải nói ra, không để
 * người đọc tưởng kho chỉ có chừng đó.
 */
describe('Kho thanh lý', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loại bị cắt → báo rõ tên loại', async () => {
    renderWith(['device', 'isp']);
    expect(await screen.findByText(/chưa hiện hết/)).toHaveTextContent(/Thiết bị, Đường truyền/);
    expect(screen.getByText('PC-E2E-01')).toBeInTheDocument();
  });

  it('không loại nào bị cắt → không báo gì', async () => {
    renderWith([]);
    await screen.findByText('PC-E2E-01');
    expect(screen.queryByText(/chưa hiện hết/)).toBeNull();
  });
});
