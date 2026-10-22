import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { jsonResponse, renderWithI18n, screen } from '@/test/test-utils';
import { useSuggestedCode } from './use-suggested-code';

function Probe({ url, initial = '' }: { url: string | null; initial?: string }) {
  const [code, setCode] = useState(initial);
  useSuggestedCode(url, code, setCode, 'probe-code');
  return <input id="probe-code" aria-label="Mã" value={code} onChange={(e) => setCode(e.target.value)} />;
}

/** FM-21: form Thêm điền sẵn mã kế tiếp — chỉ khi ô Mã còn trống, không đè thứ người dùng đã gõ. */
describe('useSuggestedCode', () => {
  it('ô trống → điền mã gợi ý', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, { code: 'PC-E2E-012' }))));
    renderWithI18n(<Probe url="/api/v1/devices/next-code" />);
    expect(await screen.findByDisplayValue('PC-E2E-012')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('ô đã có chữ → giữ nguyên; url null (form Sửa) → không hỏi', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, { code: 'PC-E2E-012' })));
    vi.stubGlobal('fetch', fetchMock);
    const view = renderWithI18n(<Probe url="/api/v1/devices/next-code" initial="SW-01" />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole('textbox', { name: 'Mã' })).toHaveValue('SW-01');
    view.unmount();
    fetchMock.mockClear();
    renderWithI18n(<Probe url={null} />);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
