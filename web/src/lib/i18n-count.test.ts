import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';

/**
 * PW-C11 / TX-42: số ĐẾM trong câu ("28805 dòng") đọc như mã. `{{count}}` và các khoá đếm khác
 * tự có dấu ngăn nghìn; năm, số phiên bản, cổng là mã nên giữ nguyên.
 */
describe('i18n định dạng số đếm', () => {
  it('{{count}} có dấu ngăn nghìn', () => {
    expect(i18n.t('catalog.bulkActivated', { count: 28805 })).toBe('Đã dùng lại 28.805 mục.');
  });

  it('các khoá đếm khác (total, used, free, days) cũng vậy', () => {
    expect(
      i18n.t('zz.missing', {
        defaultValue: '{{used}}/{{total}} · {{free}} trống · {{days}} ngày',
        used: 1024,
        total: 65534,
        free: 64510,
        days: 1075,
      }),
    ).toBe('1.024/65.534 · 64.510 trống · 1.075 ngày');
  });

  it('số dòng nhập Excel (created, updated) cũng vậy', () => {
    expect(i18n.t('zz.missing', { defaultValue: 'thêm {{created}}, cập nhật {{updated}}', created: 12000, updated: 3400 })).toBe(
      'thêm 12.000, cập nhật 3.400',
    );
  });

  it('năm, số phiên bản, cổng, số thứ tự giữ nguyên', () => {
    expect(
      i18n.t('zz.missing', {
        defaultValue: '{{year}} #{{seq}} :{{port}} ghế {{n}}',
        year: 2026,
        seq: 12345,
        port: 8080,
        n: 1200,
      }),
    ).toBe('2026 #12345 :8080 ghế 1200');
  });

  it('chuỗi (mã) truyền vào {{total}} không bị đổi', () => {
    expect(i18n.t('zz.missing', { defaultValue: '{{total}}', total: '28805' })).toBe('28805');
  });
});
