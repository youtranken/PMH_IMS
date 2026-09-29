import { describe, expect, it, vi } from 'vitest';
import { RetireDialog, type RetireGroup } from './retire-dialog';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * DEV-050 — hộp Thanh lý nói rõ sẽ gỡ gì / giữ gì, chọn gỡ thì phải gõ lại mã máy, và 409 mở
 * lại hộp kèm đúng danh sách thứ đang vướng.
 */
const CUT: RetireGroup[] = [
  { title: 'Địa chỉ IP', items: ['10.77.1.2 · Quản trị switch'] },
  { title: 'Sổ NAT', items: [] },
];

function mount(props: Partial<Parameters<typeof RetireDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  renderWithI18n(
    <RetireDialog
      code="SW-E2E-01"
      cut={CUT}
      keep={['Hồ sơ máy và toàn bộ lịch sử']}
      unknown={false}
      blockedBy={null}
      busy={false}
      error={null}
      onConfirm={onConfirm}
      onCancel={() => {}}
      {...props}
    />,
  );
  return onConfirm;
}

describe('RetireDialog', () => {
  it('liệt kê thứ SẼ GỠ từ dữ liệu thật, nhóm rỗng thì không hiện', () => {
    mount();
    expect(screen.getByText('10.77.1.2 · Quản trị switch')).toBeTruthy();
    expect(screen.queryByText('Sổ NAT')).toBeNull();
    expect(screen.getByText('Hồ sơ máy và toàn bộ lịch sử')).toBeTruthy();
  });

  it('mặc định "Chỉ thanh lý": bấm là gửi cleanup=false, không đòi gõ mã', async () => {
    const user = userEvent.setup();
    const onConfirm = mount();
    expect(screen.getByRole('radio', { name: /Chỉ thanh lý/ })).toHaveProperty('checked', true);
    await user.click(screen.getByRole('button', { name: 'Thanh lý' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('chọn "Gỡ hết": nút khoá tới khi gõ ĐÚNG mã máy, rồi gửi cleanup=true', async () => {
    const user = userEvent.setup();
    const onConfirm = mount();
    await user.click(screen.getByRole('radio', { name: 'Gỡ hết rồi thanh lý' }));
    const submit = screen.getByRole('button', { name: 'Thanh lý' });
    expect(submit).toHaveProperty('disabled', true);

    const box = screen.getByLabelText(/Gõ lại mã máy SW-E2E-01/);
    await user.type(box, 'SW-E2E-02');
    expect(submit).toHaveProperty('disabled', true);
    await user.clear(box);
    await user.type(box, 'sw-e2e-01');
    expect(submit).toHaveProperty('disabled', false);
    await user.click(submit);
    expect(onConfirm).toHaveBeenCalledWith(true);
  });

  it('máy không giữ gì: không có lựa chọn, không đòi gõ mã', () => {
    mount({ cut: [] });
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('Máy này không giữ gì phải gỡ.')).toBeTruthy();
  });

  it('409: hiện đúng danh sách API trả về thay cho danh sách dự đoán', () => {
    mount({ blockedBy: ['địa chỉ IP 10.77.1.9', 'rule NAT tcp 8080'] });
    expect(screen.getByText('rule NAT tcp 8080')).toBeTruthy();
    expect(screen.getByText(/chưa thanh lý được/)).toBeTruthy();
  });
});
