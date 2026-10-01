import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@/lib/me';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { DigestRulesPanel } from './digest-rules-panel';

const me = { role: 'sa', csrfToken: 'x', email: 'sa@pmh.com.vn' } as unknown as Me;

function rule(id: string, name: string, active: boolean) {
  return {
    id,
    name,
    kinds: ['ssl'],
    withinDays: 30,
    recipients: ['it@pmh.com.vn'],
    frequency: 'weekly',
    hour: 8,
    weekday: 1,
    dayOfMonth: null,
    active,
    lastSentAt: null,
    nextSendAt: null,
  };
}

/* Tạm ngưng lấy đi nhưng đảo được (`warn`); Chạy lại là lối quay lại (`ok`). */
describe('Luật gửi báo cáo — màu việc Tạm ngưng / Chạy lại', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('luật đang chạy: Tạm ngưng là warn; luật đã ngưng: Chạy lại là ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input).endsWith('/expiry/rules')
            ? jsonResponse(200, [rule('r1', 'Luật chạy', true), rule('r2', 'Luật ngưng', false)])
            : jsonResponse(200, []),
        ),
      ),
    );
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <DigestRulesPanel
            me={me}
            kinds={[{ kind: 'ssl', label: 'Chứng chỉ SSL', canRenew: true }]}
            adding={false}
            onAddingChange={() => {}}
          />
        </ConfirmProvider>
      </ToastProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Thao tác với Luật chạy' }));
    expect(screen.getByRole('menuitem', { name: 'Tạm ngưng' })).toHaveClass('warn');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Thao tác với Luật ngưng' }));
    expect(screen.getByRole('menuitem', { name: 'Chạy lại' })).toHaveClass('ok');
  });
});
