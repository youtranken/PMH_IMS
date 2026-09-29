import { describe, expect, it } from 'vitest';
import { previewCodeFromLogin } from './service-account-types';

/**
 * Bản xem trước của `codeFromLogin` (API) — CÙNG bảng dữ liệu với
 * `api/src/modules/service-accounts/service-account-rules.spec.ts`. Hai bài phải đổi cùng nhau:
 * xem trước nói một mã, API đặt một mã khác là tệ hơn không xem trước.
 */
describe('previewCodeFromLogin', () => {
  it.each([
    ['ketoan@pmh.com.vn', 'KETOAN'],
    ['vpn-ketoan', 'VPN-KETOAN'],
    ['ke.toan_2@pmh.com.vn', 'KE-TOAN-2'],
    ['  admin  ', 'ADMIN'],
    ['Nguyễn Văn A', 'NGUYEN-VAN-A'],
    ['đăng-nhập', 'DANG-NHAP'],
    ['-admin-@pmh.com.vn', 'ADMIN'],
    ['@@@', 'TK'],
    ['', 'TK'],
  ])('"%s" → %s', (login, expected) => {
    expect(previewCodeFromLogin(login)).toBe(expected);
  });
});
