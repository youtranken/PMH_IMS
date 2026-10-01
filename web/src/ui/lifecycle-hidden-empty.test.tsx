import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { LifecycleHiddenEmpty } from '@/ui/lifecycle-hidden-empty';

/*
 * Danh sách ẩn hồ sơ cuối đời theo mặc định (Q-20). Khi bảng trống mà thật ra chỉ có hồ sơ đã
 * thanh lý, câu "Kho trống — thêm hồ sơ đầu tiên" hay "Không có gì khớp" là nói sai: người dùng
 * đi thêm lại một máy đã có, hoặc tưởng tìm sai mã. Phải nói chúng đang ẩn và chỉ đường xem.
 */
function renderWith(total: number | 'fail', probeUrl: string | null = '/api/v1/devices?status=all') {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      total === 'fail' ? jsonResponse(500, { message: 'x' }) : jsonResponse(200, { items: [], total }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  const onShowAll = vi.fn();
  renderWithI18n(
    <MemoryRouter>
      <LifecycleHiddenEmpty
        probeKey={['devices', 'hidden-probe']}
        probeUrl={probeUrl}
        endLabel="Đã thanh lý"
        allLabel="Tất cả (cả Đã thanh lý)"
        onShowAll={onShowAll}
        fallback={<p>KHO TRỐNG</p>}
      />
    </MemoryRouter>,
  );
  return { fetchMock, onShowAll };
}

describe('LifecycleHiddenEmpty', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('còn hồ sơ cuối đời đang ẩn → nói rõ, nút "Tất cả (cả …)" và link Kho thanh lý', async () => {
    const { onShowAll } = renderWith(3);
    expect(await screen.findByText(/đã thanh lý đang ẩn/)).toBeInTheDocument();
    expect(screen.queryByText('KHO TRỐNG')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kho thanh lý' })).toHaveAttribute('href', '/disposal');
    await userEvent.click(screen.getByRole('button', { name: 'Tất cả (cả Đã thanh lý)' }));
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it('thật sự 0 hồ sơ → khối trống gốc của màn', async () => {
    renderWith(0);
    expect(await screen.findByText('KHO TRỐNG')).toBeInTheDocument();
  });

  it('không dò được → khối trống gốc, không bịa', async () => {
    renderWith('fail');
    expect(await screen.findByText('KHO TRỐNG')).toBeInTheDocument();
  });

  it('không có probeUrl (đang lọc trạng thái đích danh) → không hỏi API', () => {
    const { fetchMock } = renderWith(3, null);
    expect(screen.getByText('KHO TRỐNG')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
