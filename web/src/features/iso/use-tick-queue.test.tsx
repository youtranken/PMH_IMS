import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTickQueue } from './use-tick-queue';

/**
 * Bấm ô 0203 nhanh: mỗi ô một request bay, giá trị bấm sau cùng là thứ phải tới server — kể cả
 * khi request trước hỏng mạng.
 */

function setup(fetchImpl: (body: { result: string | null }) => Promise<Response>, form: '0203' | '0208' = '0203') {
  const bodies: { result: string | null }[] = [];
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { result: string | null };
      urls.push(String(url));
      bodies.push(body);
      return fetchImpl(body);
    }),
  );
  const onSaved = vi.fn();
  const onError = vi.fn();
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useTickQueue('tok', form, '2026-10', { onSaved, onError }), { wrapper });
  return { hook, bodies, urls, onSaved, onError };
}

const noContent = () => Promise.resolve(new Response(null, { status: 204 }));

afterEach(() => vi.unstubAllGlobals());

describe('useTickQueue', () => {
  it('bấm ✓ rồi ✗ khi lượt đầu còn bay: chỉ gửi thêm giá trị cuối, ô hiện ✗ ngay', async () => {
    let release: () => void = () => undefined;
    const first = new Promise<Response>((resolve) => (release = () => resolve(new Response(null, { status: 204 }))));
    const { hook, bodies, onSaved } = setup((b) => (b.result === 'ok' ? first : noContent()));
    act(() => hook.result.current.set('L1', '2026-10-02', 'ok'));
    act(() => hook.result.current.set('L1', '2026-10-02', 'fail'));
    expect(hook.result.current.pending.get('L1|2026-10-02')).toBe('fail');
    expect(bodies.map((b) => b.result)).toEqual(['ok']);
    await act(async () => release());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('L1', '2026-10-02', 'fail'));
    expect(bodies.map((b) => b.result)).toEqual(['ok', 'fail']);
  });

  it('lượt đầu hỏng mạng nhưng đã có lần bấm sau: vẫn gửi lần bấm sau, không báo lỗi', async () => {
    const { hook, bodies, onSaved, onError } = setup((b) => (b.result === 'ok' ? Promise.reject(new TypeError('network')) : noContent()));
    act(() => {
      hook.result.current.set('L1', '2026-10-02', 'ok');
      hook.result.current.set('L1', '2026-10-02', 'fail');
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('L1', '2026-10-02', 'fail'));
    expect(bodies.map((b) => b.result)).toEqual(['ok', 'fail']);
    expect(onError).not.toHaveBeenCalled();
  });

  it('giá trị cuối gửi không được: ô về theo server và báo lỗi', async () => {
    const { hook, onError } = setup(() => Promise.reject(new TypeError('network')));
    act(() => hook.result.current.set('L1', '2026-10-02', 'ok'));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(hook.result.current.pending.has('L1|2026-10-02')).toBe(false);
  });

  it('0208: gửi ô dòng máy tới API dấu 0208 theo mã dòng issue', async () => {
    const { hook, bodies, urls, onSaved } = setup(noContent, '0208');
    act(() => hook.result.current.set('I1', '2026-10-03', 'ok'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('I1', '2026-10-03', 'ok'));
    expect(urls).toEqual(['/api/v1/iso/antivirus/marks']);
    expect(bodies).toEqual([{ issueId: 'I1', day: '2026-10-03', result: 'ok' }]);
  });
});
