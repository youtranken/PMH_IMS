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

function RoundProbe() {
  const [code, setCode] = useState('');
  const [round, setRound] = useState(0);
  useSuggestedCode('/api/v1/devices/next-code', code, setCode, 'probe-code', round);
  return (
    <>
      <input id="probe-code" aria-label="Mã" value={code} onChange={(e) => setCode(e.target.value)} />
      <button
        type="button"
        onClick={() => {
          setCode('');
          setRound((n) => n + 1);
        }}
      >
        Lưu & thêm tiếp
      </button>
    </>
  );
}

describe('useSuggestedCode — không dùng mã cũ, không điền chen', () => {
  it('người dùng tự xoá trắng ô Mã → để trống cho họ gõ; "Lưu & thêm tiếp" (round đổi) → mã kế tiếp', async () => {
    let next = 'PC-E2E-012';
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(200, { code: next })));
    vi.stubGlobal('fetch', fetchMock);
    renderWithI18n(<RoundProbe />);
    const box = await screen.findByDisplayValue('PC-E2E-012');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(box, { target: { value: '' } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(box).toHaveValue('');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    next = 'PC-E2E-013';
    fireEvent.click(screen.getByRole('button', { name: 'Lưu & thêm tiếp' }));
    expect(await screen.findByDisplayValue('PC-E2E-013')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

function GuardProbe() {
  const [code, setCode] = useState('');
  const guard = useSuggestedCode('/api/v1/devices/next-code', code, setCode, 'probe-code');
  return <input id="probe-code" aria-label="Mã" data-guard-value={guard} value={code} onChange={(e) => setCode(e.target.value)} />;
}

describe('useSuggestedCode — mã điền sẵn không phải "đã gõ dở"', () => {
  it('mã còn đúng gợi ý → data-guard-value rỗng; người dùng gõ khác → bỏ, cửa canh thấy thay đổi', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(200, { code: 'PC-E2E-012' }))));
    renderWithI18n(<GuardProbe />);
    const box = await screen.findByDisplayValue('PC-E2E-012');
    expect(box).toHaveAttribute('data-guard-value', '');
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(box, { target: { value: 'PC-E2E-099' } });
    expect(box).not.toHaveAttribute('data-guard-value');
    vi.unstubAllGlobals();
  });
});
