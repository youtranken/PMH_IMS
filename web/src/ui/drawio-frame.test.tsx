import { createRef } from 'react';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { DrawioFrame, type DrawioFrameHandle } from './drawio-frame';
import type { DrawioEvent } from './drawio-protocol';

const VIEWER = { fullName: 'SA E2E', email: 'sa@e2e.local' };

function setup(onEvent = vi.fn(), initTimeoutSeconds = 20) {
  const ref = createRef<DrawioFrameHandle>();
  renderWithI18n(
    <DrawioFrame
      ref={ref}
      mode="edit"
      title="Khung vẽ draw.io"
      initialXml="<mxfile/>"
      viewer={VIEWER}
      initTimeoutSeconds={initTimeoutSeconds}
      onEvent={onEvent}
    />,
  );
  const frame = screen.getByTitle('Khung vẽ draw.io') as HTMLIFrameElement;
  const posted = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
  return { ref, frame, posted, onEvent };
}

function fromWindow(source: Window | null, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source }));
  });
}

const sent = (posted: ReturnType<typeof vi.fn>) =>
  posted.mock.calls.map(([data]) => JSON.parse(data as string) as Record<string, unknown>);

describe('DrawioFrame — cầu nối nhúng draw.io (AD-17)', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('iframe trỏ /drawio/ nhúng, sandbox chỉ allow-scripts', () => {
    const { frame } = setup();
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toMatch(/^\/drawio\/\?embed=1&proto=json/);
  });

  it('tin từ cửa sổ KHÁC bị bỏ qua, kể cả đúng hình dạng giao thức', () => {
    const { onEvent, posted } = setup();
    fromWindow(window, '{"event":"init"}');
    fromWindow(null, '{"event":"save","xml":"<mxfile/>"}');
    expect(onEvent).not.toHaveBeenCalled();
    expect(posted).not.toHaveBeenCalled();
  });

  it('tin sai hình dạng từ đúng khung bị bỏ qua', () => {
    const { onEvent, frame } = setup();
    fromWindow(frame.contentWindow, '{"event":"eval","code":"x"}');
    fromWindow(frame.contentWindow, { event: 'init' });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('configure → đẩy cấu hình không nén; init → nạp XML đầu vào; sự kiện có kiểu tới màn', () => {
    const { onEvent, frame, posted } = setup();
    fromWindow(frame.contentWindow, '{"event":"configure"}');
    fromWindow(frame.contentWindow, '{"event":"init"}');
    fromWindow(frame.contentWindow, '{"event":"autosave","xml":"<mxfile>x</mxfile>"}');
    const messages = sent(posted);
    expect(messages[0]).toMatchObject({ action: 'configure', config: { compressXml: false } });
    expect(messages[1]).toEqual({ action: 'load', xml: '<mxfile/>', autosave: 1 });
    expect(onEvent.mock.calls.map(([e]) => (e as DrawioEvent).event)).toEqual(['configure', 'init', 'autosave']);
    expect(onEvent.mock.calls[2][0]).toEqual({ event: 'autosave', xml: '<mxfile>x</mxfile>' });
  });

  it('lệnh có kiểu đi qua handle, không màn nào tự postMessage', () => {
    const { ref, posted } = setup();
    act(() => ref.current!.send({ action: 'merge', xml: '<mxfile/>' }));
    act(() => ref.current!.send({ action: 'export', format: 'xmlsvg' }));
    expect(sent(posted)).toEqual([
      { action: 'merge', xml: '<mxfile/>' },
      { action: 'export', format: 'xmlsvg' },
    ]);
  });

  it('không nhận init trong hạn → "Trình vẽ chưa sẵn sàng" + Thử lại dựng lại khung', async () => {
    setup(vi.fn(), 5);
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole('alert')).toHaveTextContent('Trình vẽ chưa sẵn sàng');
    const before = screen.getByTitle('Khung vẽ draw.io');
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTitle('Khung vẽ draw.io')).not.toBe(before);
  });

  it('nhận init kịp thì không báo lỗi khi hết hạn', () => {
    const { frame } = setup(vi.fn(), 5);
    fromWindow(frame.contentWindow, '{"event":"init"}');
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('watermark tên · email · giờ phủ lên khung, ẩn với trình đọc màn hình', () => {
    setup();
    const marks = screen.getAllByText(/SA E2E · sa@e2e\.local · \d{2}:\d{2}/, { selector: '[aria-hidden="true"] *' });
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0].closest('.drawio-watermark')).not.toBeNull();
  });

  it('trình vẽ: watermark VẪN có (V-06) nhưng thưa — 3 hàng, lớp riêng nhạt hơn, chừa dải công cụ', () => {
    setup();
    const layer = document.querySelector('.drawio-watermark') as HTMLElement;
    expect(layer).toHaveAttribute('data-density', 'edit');
    expect(layer.querySelectorAll('span')).toHaveLength(3);
  });
});
