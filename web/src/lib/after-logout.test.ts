import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { afterLogout, clearSignedOut, PALETTE_RECENT_PREFIX, signOutNotice } from './after-logout';
import { clearAllDrafts } from './draft-store';
import { clearNextPath, peekNextPath, rememberNextPath } from './next-path';

vi.mock('./draft-store', () => ({ clearAllDrafts: vi.fn(() => Promise.resolve()) }));

/**
 * Máy dùng chung: đăng xuất phải xoá danh sách "mở gần đây" của ô tìm nhanh (mã, tên hồ sơ
 * người trước vừa mở), không chỉ cache của react-query.
 */
describe('afterLogout', () => {
  afterEach(() => localStorage.clear());

  it('xoá mọi danh sách "mở gần đây" của ô tìm nhanh, giữ khoá khác', () => {
    localStorage.setItem(`${PALETTE_RECENT_PREFIX}a@pmh.com.vn`, '[{"to":"/devices/1"}]');
    localStorage.setItem(`${PALETTE_RECENT_PREFIX}b@pmh.com.vn`, '[{"to":"/isp-lines/2"}]');
    localStorage.setItem('ims_theme', 'dark');
    const navigate = vi.fn();

    afterLogout(new QueryClient(), navigate);

    expect(localStorage.getItem(`${PALETTE_RECENT_PREFIX}a@pmh.com.vn`)).toBeNull();
    expect(localStorage.getItem(`${PALETTE_RECENT_PREFIX}b@pmh.com.vn`)).toBeNull();
    expect(localStorage.getItem('ims_theme')).toBe('dark');
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('đăng xuất thường: bỏ đích dở, màn đăng nhập nói "đã đăng xuất"', () => {
    rememberNextPath('/devices/7', 'a@pmh.com.vn');
    afterLogout(new QueryClient(), vi.fn());
    expect(peekNextPath()).toBeNull();
    expect(signOutNotice()).toBe('signedOut');
    clearSignedOut();
  });

  it.each([
    ['back', null],
    ['totpExpired', 'totpExpired'],
  ] as const)('rời màn mã 2 lớp (%s): GIỮ đích dở (Q-14), câu báo = %s', (reason, notice) => {
    rememberNextPath('/devices/7', 'a@pmh.com.vn');
    afterLogout(new QueryClient(), vi.fn(), reason);
    expect(peekNextPath('a@pmh.com.vn')).toBe('/devices/7');
    expect(signOutNotice()).toBe(notice);
    clearSignedOut();
    clearNextPath();
  });

  it('kho bị chặn thì vẫn đăng xuất xong', () => {
    const spy = vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('blocked');
    });
    const navigate = vi.fn();
    expect(() => afterLogout(new QueryClient(), navigate)).not.toThrow();
    expect(navigate).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe('afterLogout — bản vẽ dở cất ở trình duyệt (Q-23 06/10)', () => {
  beforeEach(() => vi.mocked(clearAllDrafts).mockClear());

  it('bấm Đăng xuất: bỏ mọi bản dở trên máy (máy dùng chung không giữ gì của người vừa ra)', () => {
    afterLogout(new QueryClient(), vi.fn());
    expect(clearAllDrafts).toHaveBeenCalledOnce();
    clearSignedOut();
  });

  it.each(['back', 'totpExpired'] as const)('rời màn mã 2 lớp (%s): GIỮ bản dở — cùng người đăng nhập lại để khôi phục', (reason) => {
    afterLogout(new QueryClient(), vi.fn(), reason);
    expect(clearAllDrafts).not.toHaveBeenCalled();
    clearSignedOut();
  });
});
