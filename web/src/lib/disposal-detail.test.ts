import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { disposalDetail } from './disposal-kinds';

/*
 * DP-001: cột Chi tiết của Kho thanh lý in mã kỹ thuật ("license", "vpn") cho phần mềm và tài
 * khoản dịch vụ. Dịch qua nhãn của module chủ; chi tiết là chữ tự do (loại thiết bị, băng thông)
 * thì giữ nguyên.
 */
describe('disposalDetail — cột Chi tiết đọc được', () => {
  const t = i18n.t;
  it.each([
    ['software', 'license', 'License phần mềm'],
    ['software', 'ssl', 'Chứng chỉ SSL'],
    ['service_account', 'vpn', 'Tài khoản VPN'],
    ['service_account', 'shared', 'Tài khoản dùng chung'],
    ['device', 'Switch', 'Switch'],
    ['isp', '100 Mbps', '100 Mbps'],
    ['software', 'la-lam', 'la-lam'],
    ['device', null, '—'],
  ] as const)('%s · %s → %s', (kind, detail, expected) => {
    expect(disposalDetail(kind, detail, t)).toBe(expected);
  });
});
