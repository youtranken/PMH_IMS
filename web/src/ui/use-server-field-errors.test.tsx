import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { Field } from '@/ui/page-header';
import { useServerFieldErrors } from '@/ui/use-server-field-errors';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

/** FM-10: lỗi trùng mã / email chỉ hiện ở đầu form, xa ô sai; điện thoại phải cuộn lên. */
function Form({ error }: { error: unknown }) {
  const [code, setCode] = useState('SW-01');
  const [top, setTop] = useState<string | null>(null);
  const server = useServerFieldErrors([code]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!server.claim(error, { DEVICE_CODE_TAKEN: 'device-code' })) setTop('top');
      }}
    >
      {top ? <p role="alert">{top}</p> : null}
      <Field label="Mã thiết bị" htmlFor="device-code" error={server.error('device-code')}>
        <input value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <button type="submit">Lưu</button>
    </form>
  );
}

describe('useServerFieldErrors', () => {
  it('mã lỗi có trong bảng: câu của API hiện DƯỚI ô và tiêu điểm vào ô', async () => {
    renderWithI18n(<Form error={new ApiError(409, { code: 'DEVICE_CODE_TAKEN', message: 'Mã SW-01 đã có.' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    const input = screen.getByRole('textbox', { name: 'Mã thiết bị' });
    expect(input).toHaveAccessibleDescription('Mã SW-01 đã có.');
    expect(input).toHaveFocus();
    expect(screen.queryByText('top')).toBeNull();
  });
  it('sửa ô thì lỗi tắt', async () => {
    renderWithI18n(<Form error={new ApiError(409, { code: 'DEVICE_CODE_TAKEN', message: 'Mã SW-01 đã có.' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Mã thiết bị' }), '2');
    expect(screen.queryByText('Mã SW-01 đã có.')).toBeNull();
  });
  it('mã lỗi khác: trả false, nơi gọi tự báo ở đầu form', async () => {
    renderWithI18n(<Form error={new ApiError(500, null)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(screen.getByText('top')).toBeInTheDocument();
  });
});
