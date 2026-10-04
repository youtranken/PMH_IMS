import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, renderWithI18n, render, screen } from '@/test/test-utils';
import { COUNT_UP_MS, useCountUp } from '@/ui/use-count-up';
import { SAVE_DONE_MS, SubmitButton } from '@/ui/submit-button';
import { SUCCESS_BURST_MS } from '@/ui/success-burst';
import { ToastProvider, useToast } from '@/ui/toast';
import { Loading } from '@/ui/load-state';
import { LiveRegion } from '@/ui/live-region';
import { TabPanel, Tabs } from '@/ui/tabs';
import { DROP_FLASH_MS, FilePicker } from '@/ui/file-picker';
import { Dialog } from '@/ui/dialog';

/**
 * Vi chuyển động dùng chung (Q-21). Mỗi hiệu ứng có hai vế phải giữ: bật thì chạy
 * đúng nhịp, "Tắt" / máy báo giảm chuyển động thì ra NGAY trạng thái cuối — không ai phải chờ
 * một con số đếm hay một dấu tích để làm tiếp.
 */

function setMotion(value: 'on' | 'off') {
  document.documentElement.dataset.motion = value;
}

afterEach(() => {
  delete document.documentElement.dataset.motion;
  vi.useRealTimers();
});

const FAKE = { toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout', 'performance', 'Date'] } as const;

function Counter({ value }: { value: number }) {
  return <span data-testid="n">{useCountUp(value)}</span>;
}

describe('useCountUp — số KPI đếm từ 0 lên', () => {
  it('"Tắt" chuyển động → hiện ngay giá trị cuối, không qua 0', () => {
    setMotion('off');
    render(<Counter value={42} />);
    expect(screen.getByTestId('n')).toHaveTextContent('42');
  });

  it('bật → bắt đầu từ 0, tới đúng giá trị sau COUNT_UP_MS', () => {
    setMotion('on');
    vi.useFakeTimers({ toFake: [...FAKE.toFake] });
    render(<Counter value={42} />);
    expect(screen.getByTestId('n')).toHaveTextContent('0');
    act(() => {
      vi.advanceTimersByTime(COUNT_UP_MS / 2);
    });
    const mid = Number(screen.getByTestId('n').textContent);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(42);
    act(() => {
      vi.advanceTimersByTime(COUNT_UP_MS);
    });
    expect(screen.getByTestId('n')).toHaveTextContent('42');
  });

  it('chỉ đếm lần đầu: giá trị đổi sau đó (tải lại) nhảy thẳng tới số mới', () => {
    setMotion('on');
    vi.useFakeTimers({ toFake: [...FAKE.toFake] });
    const { rerender } = render(<Counter value={5} />);
    act(() => {
      vi.advanceTimersByTime(COUNT_UP_MS * 2);
    });
    rerender(<Counter value={9} />);
    expect(screen.getByTestId('n')).toHaveTextContent('9');
  });

  it('tháo giữa chừng thì dừng vòng khung hình', () => {
    setMotion('on');
    vi.useFakeTimers({ toFake: [...FAKE.toFake] });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = render(<Counter value={42} />);
    unmount();
    expect(cancel).toHaveBeenCalled();
  });
});

function SaveHarness({ succeed = true }: { succeed?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  return (
    <>
      <SubmitButton busy={busy} succeeded={ok} onClick={() => setBusy(true)} />
      <button
        type="button"
        onClick={() => {
          setOk(succeed);
          setBusy(false);
        }}
      >
        xong
      </button>
    </>
  );
}

describe('SubmitButton — nút Lưu hiện dấu tích khi lưu xong', () => {
  it('đang ghi: chữ "Đang lưu…" và khoá nút', () => {
    renderWithI18n(<SubmitButton busy succeeded={false} />);
    const button = screen.getByRole('button', { name: 'Đang lưu…' });
    expect(button).toBeDisabled();
  });

  it('lưu xong: dấu tích đúng SAVE_DONE_MS rồi trở lại; tên nút vẫn là "Lưu"', () => {
    setMotion('on');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    renderWithI18n(<SaveHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    fireEvent.click(screen.getByRole('button', { name: 'xong' }));
    const button = screen.getByRole('button', { name: 'Lưu' });
    expect(button).toHaveAttribute('data-done', 'true');
    act(() => {
      vi.advanceTimersByTime(SAVE_DONE_MS - 10);
    });
    expect(button).toHaveAttribute('data-done', 'true');
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(button).not.toHaveAttribute('data-done');
  });

  it('lưu hỏng: không có dấu tích', () => {
    setMotion('on');
    renderWithI18n(<SaveHarness succeed={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    fireEvent.click(screen.getByRole('button', { name: 'xong' }));
    expect(screen.getByRole('button', { name: 'Lưu' })).not.toHaveAttribute('data-done');
  });

  it('"Tắt" chuyển động: không có dấu tích', () => {
    setMotion('off');
    renderWithI18n(<SaveHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    fireEvent.click(screen.getByRole('button', { name: 'xong' }));
    expect(screen.getByRole('button', { name: 'Lưu' })).not.toHaveAttribute('data-done');
  });
});

function BurstButton() {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast({ message: 'Đã duyệt E2E', tone: 'ok', burst: true })}>
      duyệt
    </button>
  );
}

describe('SuccessBurst — vòng xanh + dấu tích khi duyệt / phát hành', () => {
  it('toast `burst` vẽ vòng xanh (ẩn với trình đọc màn hình) rồi tự gỡ; câu toast vẫn đọc', () => {
    setMotion('on');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { container } = renderWithI18n(
      <ToastProvider>
        <BurstButton />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'duyệt' }));
    expect(screen.getByRole('status')).toHaveTextContent('Đã duyệt E2E');
    const burst = container.ownerDocument.querySelector('.success-burst');
    expect(burst).not.toBeNull();
    expect(burst).toHaveAttribute('aria-hidden', 'true');
    act(() => {
      vi.advanceTimersByTime(SUCCESS_BURST_MS + 10);
    });
    expect(container.ownerDocument.querySelector('.success-burst')).toBeNull();
  });

  it('"Tắt" chuyển động: chỉ toast, không vòng', () => {
    setMotion('off');
    const { container } = renderWithI18n(
      <ToastProvider>
        <BurstButton />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'duyệt' }));
    expect(screen.getByRole('status')).toHaveTextContent('Đã duyệt E2E');
    expect(container.ownerDocument.querySelector('.success-burst')).toBeNull();
  });
});

describe('Loading variant="table" — khung chờ có vệt sáng thay chữ "Đang tải…"', () => {
  it('vẫn loan báo "Đang tải…" qua vùng sống chung, khung xương ẩn với trình đọc màn hình', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { container } = renderWithI18n(
      <>
        <LiveRegion />
        <Loading variant="table" />
      </>,
    );
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const block = container.querySelector('.skeleton-table');
    expect(block).not.toBeNull();
    expect(block).toHaveAttribute('aria-busy', 'true');
    // Chữ còn đó cho trình đọc màn hình, nhưng không hiện bằng mắt.
    expect(block!.querySelector('.sr-only')).toHaveTextContent('Đang tải…');
    expect(container.querySelector('.load-state')).toBeNull();
    const rows = block!.querySelectorAll('.skeleton-line');
    expect(rows.length).toBeGreaterThan(2);
    for (const row of Array.from(rows)) expect(row.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(container.querySelector('.skeleton.sk-bar')).not.toBeNull();
    expect(container.textContent).toContain('Đang tải…');
  });

  it('mặc định vẫn là khối "Đang tải…" cũ', () => {
    const { container } = renderWithI18n(<Loading />);
    expect(container.querySelector('.load-state')).not.toBeNull();
    expect(container.querySelector('.skeleton-table')).toBeNull();
  });
});

function TabsHarness() {
  const [tab, setTab] = useState('a');
  return (
    <>
      <Tabs
        ariaLabel="thử"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'a', label: 'Một' },
          { key: 'b', label: 'Hai' },
        ]}
      />
      <TabPanel tabKey={tab}>nội dung {tab}</TabPanel>
    </>
  );
}

describe('Tabs — vạch dưới trượt, nội dung mờ dần vào', () => {
  function stubLayout() {
    const proto = HTMLElement.prototype;
    const width = vi.spyOn(proto, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'tab' ? 80 : 0;
    });
    const left = vi.spyOn(proto, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return this.id === 'tab-b' ? 100 : 10;
    });
    const top = vi.spyOn(proto, 'offsetTop', 'get').mockReturnValue(3);
    const height = vi.spyOn(proto, 'offsetHeight', 'get').mockReturnValue(40);
    return () => [width, left, top, height].forEach((s) => s.mockRestore());
  }

  it('vạch theo tab đang chọn: đổi tab thì đổi vị trí', () => {
    const restore = stubLayout();
    const { container } = renderWithI18n(<TabsHarness />);
    const ink = container.querySelector<HTMLElement>('.tab-ink');
    expect(ink).not.toBeNull();
    expect(ink).toHaveAttribute('aria-hidden', 'true');
    expect(ink!.style.transform).toContain('translate(10px');
    expect(ink!.style.transform).toContain('scaleX(80)');
    expect(screen.getByRole('tablist')).toHaveAttribute('data-ink', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Hai' }));
    expect(container.querySelector<HTMLElement>('.tab-ink')!.style.transform).toContain('translate(100px');
    restore();
  });

  it('chưa đo được (bố cục 0) thì không vẽ vạch — gạch chân CSS của tab vẫn đó', () => {
    const { container } = renderWithI18n(<TabsHarness />);
    expect(container.querySelector('.tab-ink')).toBeNull();
    expect(screen.getByRole('tablist')).not.toHaveAttribute('data-ink');
  });

  it('đổi tab: panel mờ dần vào khi bật, đứng yên khi "Tắt"', () => {
    const animate = vi.fn();
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    setMotion('on');
    renderWithI18n(<TabsHarness />);
    expect(animate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab', { name: 'Hai' }));
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames] = animate.mock.calls[0] as [Keyframe[]];
    for (const frame of frames) expect(Object.keys(frame).filter((k) => k !== 'offset' && k !== 'easing')).toEqual(['opacity']);
    setMotion('off');
    fireEvent.click(screen.getByRole('tab', { name: 'Một' }));
    expect(animate).toHaveBeenCalledTimes(1);
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });
});

describe('FilePicker — vùng thả tệp', () => {
  function file() {
    return new File(['x'], 'E2E-ảnh.png', { type: 'image/png' });
  }

  it('kéo vào: sáng lên; rê qua chữ con (dragleave lẻ) không tắt; rời hẳn mới tắt', () => {
    const { container } = renderWithI18n(<FilePicker label="Chọn tệp" file={null} onPick={() => {}} />);
    const zone = container.querySelector('.file-picker')!;
    fireEvent.dragEnter(zone);
    fireEvent.dragOver(zone);
    expect(zone).toHaveClass('dragging');
    fireEvent.dragEnter(zone.querySelector('.file-picker-label')!);
    fireEvent.dragLeave(zone.querySelector('.file-picker-label')!);
    expect(zone).toHaveClass('dragging');
    fireEvent.dragLeave(zone);
    expect(zone).not.toHaveClass('dragging');
  });

  it('thả: loé xác nhận đúng DROP_FLASH_MS; biểu tượng tải lên ẩn với trình đọc màn hình', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onPick = vi.fn();
    const { container } = renderWithI18n(<FilePicker label="Chọn tệp" file={null} onPick={onPick} />);
    const zone = container.querySelector('.file-picker')!;
    expect(zone.querySelector('.file-picker-icon')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByLabelText('Chọn tệp')).toBeInTheDocument();
    fireEvent.dragEnter(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [file()] } });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(zone).not.toHaveClass('dragging');
    expect(zone).toHaveClass('dropped');
    act(() => {
      vi.advanceTimersByTime(DROP_FLASH_MS + 10);
    });
    expect(zone).not.toHaveClass('dropped');
  });
});

describe('Dialog — mở/đóng có trạng thái để CSS làm mờ + phóng nhẹ', () => {
  it('lớp canh giữa mang data-state theo `open`', () => {
    renderWithI18n(
      <Dialog open onOpenChange={() => {}} title="Hộp E2E">
        thân
      </Dialog>,
    );
    const viewport = document.querySelector('.dialog-viewport');
    expect(viewport).toHaveAttribute('data-state', 'open');
  });
});
