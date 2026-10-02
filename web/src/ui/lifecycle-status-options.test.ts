import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { lifecycleStatusOptions } from '@/ui/lifecycle-status-options';

/*
 * Bốn màn danh sách (Thiết bị, Phần mềm, Đường truyền, Tài khoản dịch vụ) ẩn hồ sơ cuối đời theo
 * mặc định (Q-20). Ô lọc trạng thái phải nói CÙNG một khuôn ở cả bốn, và "Tất cả" luôn đứng cuối —
 * mỗi màn tự xếp thì một màn để "Tất cả" giữa danh sách, người dùng chọn nhầm.
 */
const t = i18n.t.bind(i18n);
const LABEL: Record<string, string> = {
  in_use: 'Đang dùng',
  spare: 'Dự phòng',
  retired: 'Đã thanh lý',
};

describe('lifecycleStatusOptions', () => {
  const options = lifecycleStatusOptions(t, {
    statuses: ['in_use', 'spare', 'retired'],
    labelOf: (status) => LABEL[status],
    endStatus: 'retired',
  });

  it('mặc định đứng đầu, "Tất cả" đứng cuối, trạng thái riêng ở giữa theo thứ tự truyền vào', () => {
    expect(options.map((o) => o.value)).toEqual(['', 'in_use', 'spare', 'retired', 'all']);
  });

  it('chữ theo một khuôn, gọi tên trạng thái cuối đời của chính màn đó', () => {
    expect(options[0].label).toBe('Đang theo dõi (trừ Đã thanh lý)');
    expect(options[options.length - 1].label).toBe('Tất cả (cả Đã thanh lý)');
  });

  it('tài khoản dịch vụ gọi trạng thái cuối là "Đã ngừng dùng"', () => {
    const sa = lifecycleStatusOptions(t, {
      statuses: ['active', 'disabled'],
      labelOf: (status) => (status === 'active' ? 'Đang dùng' : 'Đã ngừng dùng'),
      endStatus: 'disabled',
    });
    expect(sa[0].label).toBe('Đang theo dõi (trừ Đã ngừng dùng)');
    expect(sa[sa.length - 1].label).toBe('Tất cả (cả Đã ngừng dùng)');
  });
});
