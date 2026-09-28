import { afterEach, describe, expect, it } from 'vitest';
import { clearNextPath, peekNextPath, rememberNextPath, safeNextPath } from './next-path';

/**
 * Đích sau đăng nhập (AUTH-029, VLT-001, Q-14): chỉ nhận đường NỘI BỘ. Đích lấy từ URL người
 * khác gửi tới, nên mọi thứ dẫn ra ngoài miền là một cú chuyển hướng mở (open redirect) — trang
 * lừa đảo đứng ngay sau màn đăng nhập thật.
 */
describe('safeNextPath', () => {
  it.each([
    ['/approvals?id=42', '/approvals?id=42'],
    ['/devices/abc#vault', '/devices/abc#vault'],
    ['/software', '/software'],
    ['/approvals?next=//evil.com', '/approvals?next=//evil.com'],
  ])('nhận đường nội bộ %s', (raw, expected) => {
    expect(safeNextPath(raw)).toEqual({ value: expected, reason: null });
  });

  it.each([
    [null, 'empty'],
    ['', 'empty'],
    ['//evil.com', 'external'],
    ['//evil.com/approvals', 'external'],
    ['/\\evil.com', 'external'],
    ['\\\\evil.com', 'external'],
    ['https://evil.com/approvals', 'external'],
    ['javascript:alert(1)', 'external'],
    ['approvals', 'external'],
    [' /approvals', 'external'],
    ['/\t/evil.com', 'external'],
    ['/%2F/evil.com', 'external'],
    ['/%5Cevil.com', 'external'],
  ])('bỏ đích %j (%s)', (raw, reason) => {
    expect(safeNextPath(raw as string | null)).toEqual({ value: null, reason });
  });

  it.each(['/', '/login', '/login/2fa', '/login/2fa-setup', '/change-password', '/dang-nhap'])(
    'không nhớ chính màn đăng nhập %s — về đó sau khi đăng nhập là vòng lặp',
    (raw) => {
      expect(safeNextPath(raw)).toEqual({ value: null, reason: 'auth' });
    },
  );
});

describe('nhớ / đọc / xoá đích', () => {
  afterEach(() => clearNextPath());

  it('nhớ đường hợp lệ, đọc lại được, xoá thì hết', () => {
    rememberNextPath('/approvals?id=7');
    expect(peekNextPath()).toBe('/approvals?id=7');
    clearNextPath();
    expect(peekNextPath()).toBeNull();
  });

  it('đích độc không bao giờ vào kho — và không đè mất đích tốt đã nhớ', () => {
    rememberNextPath('/software/1');
    rememberNextPath('//evil.com');
    expect(peekNextPath()).toBe('/software/1');
  });

  it('kho bị sửa tay thành đích độc thì đọc ra null', () => {
    sessionStorage.setItem('ims_next_path', '//evil.com');
    expect(peekNextPath()).toBeNull();
  });
});
