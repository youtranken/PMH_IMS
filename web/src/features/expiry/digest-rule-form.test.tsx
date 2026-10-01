import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent, within } from '@/test/test-utils';
import { DigestRulesPanel } from './digest-rules-panel';

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

function renderForm() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/expiry/rules')) {
        return Promise.resolve(
          jsonResponse(200, [
            {
              id: 'r1',
              name: 'SSL → IT',
              kinds: ['ssl'],
              withinDays: 30,
              recipients: ['it@pmh.com.vn'],
              frequency: 'weekly',
              hour: 8,
              weekday: 1,
              dayOfMonth: null,
              active: true,
              lastSentAt: null,
              nextSendAt: null,
            },
          ]),
        );
      }
      return Promise.resolve(jsonResponse(200, []));
    }),
  );
  renderWithI18n(
    <ToastProvider>
      <ConfirmProvider>
        <DigestRulesPanel
          me={me}
          kinds={[{ kind: 'ssl', label: 'Chứng chỉ SSL', canRenew: true }]}
          adding
          onAddingChange={() => {}}
        />
      </ConfirmProvider>
    </ToastProvider>,
  );
  return screen.findByRole('dialog', { name: 'Thêm luật' });
}

/*
 * Ô Người nhận vẫn gõ tự do, nhưng đọc lại thành chip (email sai đỏ ngay chip của nó) và gợi ý
 * hộp thư đã dùng ở luật khác (EX-018). "Đang chạy" là công tắc có chữ đổi theo (EX-020).
 */
describe('Form luật gửi báo cáo — chip người nhận, gợi ý, công tắc Đang chạy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gõ hai email: chip đúng thường, chip sai mang nhãn "chưa đúng dạng"', async () => {
    const dialog = await renderForm();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Người nhận' }),
      'sep@pmh.com.vn, khong-phai-email',
    );
    const chips = within(within(dialog).getByRole('list', { name: 'Người nhận đã nhập' })).getAllByRole(
      'listitem',
    );
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'sep@pmh.com.vn',
      'khong-phai-email — chưa đúng dạng email',
    ]);
  });

  it('gợi ý hộp thư của luật khác + email của mình; bấm là thêm vào ô', async () => {
    const dialog = await renderForm();
    const group = await within(dialog).findByRole('group', { name: 'Gợi ý người nhận' });
    await userEvent.click(within(group).getByRole('button', { name: 'Thêm it@pmh.com.vn' }));
    expect(within(dialog).getByRole('textbox', { name: 'Người nhận' })).toHaveValue('it@pmh.com.vn');
    await userEvent.click(within(group).getByRole('button', { name: 'Thêm sa@pmh.com.vn' }));
    expect(within(dialog).getByRole('textbox', { name: 'Người nhận' })).toHaveValue(
      'it@pmh.com.vn, sa@pmh.com.vn',
    );
    expect(within(dialog).queryByRole('group', { name: 'Gợi ý người nhận' })).not.toBeInTheDocument();
  });

  it('"Đang chạy" là công tắc; tắt thì chữ đổi thành "Đang tạm ngưng"', async () => {
    const dialog = await renderForm();
    const toggle = within(dialog).getByRole('switch', { name: 'Đang chạy' });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(within(dialog).getByText('Đang tạm ngưng')).toBeInTheDocument();
  });

  it('lưới 2 cột trong hộp đủ rộng cho hai ô cạnh nhau', async () => {
    const dialog = await renderForm();
    expect(dialog.querySelector('form.form-grid')).toHaveAttribute('data-columns', '2');
    expect(Number.parseInt(dialog.style.maxWidth, 10)).toBeGreaterThanOrEqual(760);
  });

  it('gợi ý dài của Theo dõi loại và Người nhận nằm sau nút (i)', async () => {
    const dialog = await renderForm();
    for (const label of ['Theo dõi loại', 'Người nhận']) {
      expect(within(dialog).getByRole('button', { name: `Giải thích: ${label}` })).toBeInTheDocument();
    }
    expect(within(dialog).queryByText(/kể cả loại thêm về sau/)).toBeNull();
    expect(within(dialog).queryByText(/Không cần có tài khoản IMS/)).toBeNull();
  });
});
