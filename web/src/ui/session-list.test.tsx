import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describeUserAgent, SessionList, type SessionItem } from './session-list';

describe('describeUserAgent — "Chrome trên Linux" thay cho chuỗi UA 120 ký tự', () => {
  const cases: [string | null, [string, string] | null][] = [
    [
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
      ['Chrome', 'Linux'],
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0',
      ['Edge', 'Windows'],
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ['Safari', 'iPhone'],
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36',
      ['Chrome', 'Android'],
    ],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:129.0) Gecko/20100101 Firefox/129.0', ['Firefox', 'macOS']],
    ['curl/8.5.0', null],
    [null, null],
  ];
  it.each(cases)('%s → %s', (ua, expected) => {
    const got = describeUserAgent(ua);
    expect(got ? [got.browser, got.os] : null).toEqual(expected);
  });
});

const session = (over: Partial<SessionItem> = {}): SessionItem => ({
  id: 's1',
  ip: '172.16.90.9',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/128.0 Safari/537.36',
  createdAt: '2026-09-27T16:10:00Z',
  lastSeenAt: '2026-09-27T16:37:00Z',
  ...over,
});

describe('SessionList dạng thẻ', () => {
  it('mỗi phiên một thẻ: thiết bị · IP, mốc hoạt động, nút kết thúc bấm được', () => {
    const onEnd = vi.fn();
    render(<SessionList sessions={[session()]} endLabel="Đóng phiên" onEnd={onEnd} />);
    expect(screen.getByText('Chrome trên Linux · 172.16.90.9')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng phiên' }));
    expect(onEnd).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  });

  it('phiên hiện tại không có nút kết thúc (tự đá mình ra là việc của nút Đăng xuất)', () => {
    render(
      <SessionList
        sessions={[session({ current: true })]}
        endLabel="Đăng xuất máy này"
        currentLabel="Máy này"
        onEnd={() => undefined}
      />,
    );
    expect(screen.getByText('Máy này')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
