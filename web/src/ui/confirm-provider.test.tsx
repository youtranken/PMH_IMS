import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { ConfirmProvider, useConfirm } from '@/ui/confirm-provider';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/**
 * Hộp hỏi ba lựa chọn (`choice`): xác nhận / lựa chọn phụ / Hủy là ba câu trả lời KHÁC nhau. Xoá nét
 * dây trên sơ đồ cần đủ ba — "Gỡ luôn kết nối", "Chỉ xóa nét vẽ", "Hủy" (trả nét về).
 */
function Asker() {
  const ask = useConfirm();
  const [answer, setAnswer] = useState('—');
  return (
    <>
      <button type="button" onClick={async () => setAnswer(await ask({ message: 'Xoá?', confirmLabel: 'Gỡ luôn', cancelLabel: 'Hủy', choice: { label: 'Chỉ nét' } }))}>
        hỏi
      </button>
      <output data-testid="answer">{answer}</output>
    </>
  );
}

describe('useConfirm — lựa chọn thứ ba (`choice`)', () => {
  it.each([
    ['Gỡ luôn', 'confirm'],
    ['Chỉ nét', 'choice'],
    ['Hủy', 'cancel'],
  ])('bấm "%s" → %s', async (button, expected) => {
    renderWithI18n(
      <ConfirmProvider>
        <Asker />
      </ConfirmProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'hỏi' }));
    // ✕ của hộp cũng mang tên nút hủy — bấm nút ở chân hộp (cuối danh sách).
    await user.click((await screen.findAllByRole('button', { name: button })).at(-1)!);
    expect(await screen.findByTestId('answer')).toHaveTextContent(expected);
  });

  it('Esc = Hủy', async () => {
    renderWithI18n(
      <ConfirmProvider>
        <Asker />
      </ConfirmProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'hỏi' }));
    await screen.findByRole('button', { name: 'Chỉ nét' });
    await user.keyboard('{Escape}');
    expect(await screen.findByTestId('answer')).toHaveTextContent('cancel');
  });
});
