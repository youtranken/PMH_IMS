import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/lib/i18n';

/** Render kèm i18n + QueryClient (client mới mỗi test, tắt retry → lỗi hiện ngay). */
export function renderWithI18n(ui: ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{ui}</I18nextProvider>
    </QueryClientProvider>,
  );
}

/** Tạo Response giả cho fetch mock — gọn hơn dựng full Response trong từng test. */
export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Chọn một việc trong menu ⋮ (`RowActions`): bấm nút mở menu theo tên rồi bấm mục. Việc phụ của
 * thanh mảnh màn sơ đồ và cột Thao tác đều nằm sau một cú bấm này (Q-18).
 */
export async function pickMenuItem(user: ReturnType<typeof userEvent.setup>, menu: string | RegExp, item: string | RegExp) {
  await user.click(await screen.findByRole('button', { name: menu }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

export * from '@testing-library/react';
export { userEvent };
