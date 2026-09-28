import { afterEach, describe, expect, it } from 'vitest';
import {
  clearNextPath,
  nextPathFor,
  nextPathLabelKey,
  peekNextPath,
  rememberNextPath,
  safeNextPath,
} from './next-path';

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

/**
 * Máy dùng chung: phiên của A chết giữa chừng thì đích A đang làm dở thuộc về A. B ngồi vào
 * đăng nhập trong cùng tab thì KHÔNG được kéo tới trang của A. Đích không gắn ai (link trong
 * thư mở khi chưa đăng nhập) thì thuộc người đăng nhập.
 */
describe('nextPathFor — đích chỉ quay về đúng chủ', () => {
  const stored = (path: string, owner: string | null) => JSON.stringify({ path, owner });

  it.each([
    ['không có gì đã nhớ', null, 'a@pmh.com.vn', null],
    ['đích không gắn ai → ai đăng nhập cũng dùng', stored('/approvals/1', null), 'b@pmh.com.vn', '/approvals/1'],
    ['đúng chủ', stored('/devices/9', 'a@pmh.com.vn'), 'a@pmh.com.vn', '/devices/9'],
    ['đúng chủ, khác hoa thường', stored('/devices/9', 'A@PMH.com.vn'), 'a@pmh.com.vn', '/devices/9'],
    ['người khác đăng nhập → bỏ', stored('/devices/9', 'a@pmh.com.vn'), 'b@pmh.com.vn', null],
    ['người khác, email rỗng → bỏ', stored('/devices/9', 'a@pmh.com.vn'), '', null],
    ['chưa biết ai (chỉ để hiện tên màn) → đọc được', stored('/devices/9', 'a@pmh.com.vn'), undefined, '/devices/9'],
    ['bản cũ lưu chuỗi trần → coi như không gắn ai', '/software/3', 'b@pmh.com.vn', '/software/3'],
    ['đích độc trong JSON → bỏ', stored('//evil.com', null), 'a@pmh.com.vn', null],
    ['JSON hỏng → bỏ', '{"path":', 'a@pmh.com.vn', null],
    ['JSON thiếu path → bỏ', JSON.stringify({ owner: 'a@pmh.com.vn' }), 'a@pmh.com.vn', null],
  ])('%s', (_name, raw, forEmail, expected) => {
    expect(nextPathFor(raw, forEmail)).toBe(expected);
  });
});

describe('nhớ kèm chủ', () => {
  afterEach(() => clearNextPath());

  it('nhớ kèm email người đang làm → chỉ người đó lấy lại được', () => {
    rememberNextPath('/approvals/7', 'a@pmh.com.vn');
    expect(peekNextPath('b@pmh.com.vn')).toBeNull();
    expect(peekNextPath('a@pmh.com.vn')).toBe('/approvals/7');
  });

  it('không biết ai đang làm → ai đăng nhập cũng về được', () => {
    rememberNextPath('/approvals/7');
    expect(peekNextPath('b@pmh.com.vn')).toBe('/approvals/7');
  });
});

describe('nextPathLabelKey — dòng phụ màn đăng nhập nói TÊN MÀN, không in đường dẫn', () => {
  it.each([
    ['/approvals?id=42', 'nav.approvals'],
    ['/approvals/9f1c', 'nav.approvals'],
    ['/devices/abc?tab=vault#x', 'nav.devices'],
    ['/profile', 'profile.title'],
    ['/khong-co-man-nay', null],
    [null, null],
  ])('%s → %s', (path, key) => {
    expect(nextPathLabelKey(path)).toBe(key);
  });
});
