import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { disposalDetailText, disposalStatusTone } from './disposal-kinds';

const t = i18n.t.bind(i18n);

/**
 * Cột "chi tiết" của hồ sơ thanh lý: với phần mềm và tài khoản dịch vụ API gửi MÃ LOẠI thô
 * ('license', 'vpn'). Màn hình không bao giờ được in mã thô ra.
 */
describe('disposalDetailText', () => {
  it.each([
    ['software', 'license', 'License phần mềm'],
    ['software', 'ssl', 'Chứng chỉ SSL'],
    ['service_account', 'vpn', 'Tài khoản VPN'],
    ['service_account', 'shared', 'Tài khoản dùng chung'],
    ['device', 'Switch', 'Switch'],
    ['isp', '100 Mbps', '100 Mbps'],
  ] as const)('%s / %s → %s', (kind, detail, text) => {
    expect(disposalDetailText(kind, detail, t)).toBe(text);
  });

  it('mã lạ của phần mềm/tài khoản → trống, KHÔNG in mã thô; null → null', () => {
    expect(disposalDetailText('software', 'loai-moi', t)).toBeNull();
    expect(disposalDetailText('device', null, t)).toBeNull();
  });
});

/**
 * Q-19: badge trạng thái ở kho mang ĐÚNG màu của màn gốc. Cùng chữ "Đã ngừng dùng" mà ở kho
 * xám còn ở danh sách tài khoản dịch vụ đỏ thì người đọc tưởng hai trạng thái khác nhau.
 */
describe('disposalStatusTone', () => {
  it.each([
    ['service_account', 'disabled', 'danger'],
    ['device', 'retired', 'muted'],
    ['software', 'retired', 'muted'],
    ['isp', 'terminated', 'muted'],
    ['software', 'expired_ok', 'danger'],
  ] as const)('%s / %s → %s', (kind, status, tone) => {
    expect(disposalStatusTone(kind, status)).toBe(tone);
  });

  it('trạng thái lạ → muted, không ra class rỗng', () => {
    expect(disposalStatusTone('device', 'la-hoac')).toBe('muted');
  });
});
