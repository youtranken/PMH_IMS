import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui/toast';
import { RenewDialog } from '@/ui/renew-dialog';
import { jsonResponse, renderWithI18n, screen, userEvent, waitFor } from '@/test/test-utils';

/**
 * SW-049 — gia hạn license kéo luôn ghế có kỳ hạn riêng: hộp nói RÕ bao nhiêu ghế sẽ bị bỏ lại
 * phía sau hạn mới, bật sẵn ô cập nhật, và gửi `seats: true` lên endpoint của module chủ.
 */

afterEach(() => vi.unstubAllGlobals());

const ROW = { kind: 'license', id: 'sw1', code: 'LIC-01', label: 'Office', end: '2099-12-31' };

function renderDialog(seatEnds: string[] | undefined, withTerms = false) {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(jsonResponse(201, { seatsRenewed: 1 })),
  );
  vi.stubGlobal('fetch', fetchMock);
  const onDone = vi.fn();
  renderWithI18n(
    <ToastProvider>
      <RenewDialog
        row={ROW}
        kindLabel="License"
        csrfToken="t"
        url="/api/v1/software/sw1/renew"
        seatEnds={seatEnds}
        withTerms={withTerms}
        onClose={vi.fn()}
        onDone={onDone}
      />
    </ToastProvider>,
  );
  return { fetchMock, onDone };
}

const sentBody = (fetchMock: ReturnType<typeof vi.fn>) =>
  JSON.parse(String((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).body)) as Record<string, unknown>;

describe('RenewDialog — ghế có kỳ hạn riêng', () => {
  it('chỉ đếm ghế có hạn riêng TRƯỚC hạn mới, bật sẵn, gửi seats: true', async () => {
    const { fetchMock, onDone } = renderDialog(['2099-12-31', '2101-06-30']);
    // Chưa chọn hạn mới: ghế hết cùng lúc với hồ sơ là ghế sẽ bị bỏ lại.
    const box = screen.getByRole('checkbox', { name: /Cập nhật luôn 1 ghế/ });
    expect(box).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: '+2 năm' }));
    // Hạn mới 2101-12-31: cả hai ghế đều trước nó.
    expect(screen.getByRole('checkbox', { name: /Cập nhật luôn 2 ghế/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Gia hạn' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody(fetchMock)).toEqual({ endDate: '2101-12-31', seats: true });
  });

  it('bỏ tick thì không gửi seats; không có ghế riêng thì không hiện ô', async () => {
    const { fetchMock, onDone } = renderDialog(['2099-12-31']);
    await userEvent.click(screen.getByRole('checkbox', { name: /Cập nhật luôn 1 ghế/ }));
    await userEvent.click(screen.getByRole('button', { name: '+1 năm' }));
    await userEvent.click(screen.getByRole('button', { name: 'Gia hạn' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody(fetchMock)).toEqual({ endDate: '2100-12-31' });
  });

  it('không truyền seatEnds → không có ô ghế', () => {
    renderDialog(undefined);
    expect(screen.queryByRole('checkbox', { name: /ghế/ })).toBeNull();
  });
});

describe('RenewDialog — hợp đồng + chi phí của lượt gia hạn (Q-15)', () => {
  it('gửi số hợp đồng + chi phí đã đọc thành số đồng', async () => {
    const { fetchMock, onDone } = renderDialog(undefined, true);
    await userEvent.click(screen.getByRole('button', { name: '+1 năm' }));
    await userEvent.type(screen.getByLabelText('Số hợp đồng'), ' HD-2027-01 ');
    await userEvent.type(screen.getByLabelText('Chi phí kỳ mới'), '12,5tr');
    await userEvent.click(screen.getByRole('button', { name: 'Gia hạn' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody(fetchMock)).toEqual({
      endDate: '2100-12-31',
      contract: 'HD-2027-01',
      cost: 12_500_000,
    });
  });

  it('bỏ trống hai ô thì không gửi gì thêm', async () => {
    const { fetchMock, onDone } = renderDialog(undefined, true);
    await userEvent.click(screen.getByRole('button', { name: '+1 năm' }));
    await userEvent.click(screen.getByRole('button', { name: 'Gia hạn' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody(fetchMock)).toEqual({ endDate: '2100-12-31' });
  });

  it('chi phí không đọc được → báo lỗi dưới ô, không gửi', async () => {
    const { fetchMock } = renderDialog(undefined, true);
    await userEvent.click(screen.getByRole('button', { name: '+1 năm' }));
    await userEvent.type(screen.getByLabelText('Chi phí kỳ mới'), 'năm triệu');
    await userEvent.click(screen.getByRole('button', { name: 'Gia hạn' }));
    expect(await screen.findByText(/Chi phí chưa đọc được/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('không bật withTerms (màn Sắp hết hạn) → không có hai ô', () => {
    renderDialog(undefined);
    expect(screen.queryByLabelText('Số hợp đồng')).toBeNull();
    expect(screen.queryByLabelText('Chi phí kỳ mới')).toBeNull();
  });
});
