import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { ToastProvider } from '@/ui/toast';
import { jsonResponse, renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { DisposeButton } from './dispose-button';

describe('DisposeButton — câu hỏi lại dựng lúc bấm', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('`resolveMessage` thay câu tĩnh: hộp hỏi lại hiện câu vừa dựng', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, {}))));
    renderWithI18n(
      <ToastProvider>
        <ConfirmProvider>
          <DisposeButton
            url="/api/v1/software/x"
            body={{ status: 'retired' }}
            label="Đưa vào kho thanh lý"
            confirmMessage="câu tĩnh"
            resolveMessage={() => Promise.resolve('2 máy đang dùng sẽ bị gỡ license: PC-01, PC-02.')}
            csrfToken="t"
            onDone={() => {}}
          />
        </ConfirmProvider>
      </ToastProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Đưa vào kho thanh lý' }));
    expect(
      await screen.findByText('2 máy đang dùng sẽ bị gỡ license: PC-01, PC-02.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('câu tĩnh')).not.toBeInTheDocument();
  });
});
