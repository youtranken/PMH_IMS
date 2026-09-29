import { describe, expect, it } from 'vitest';
import { Tabs } from '@/ui/tabs';
import { renderWithI18n, screen } from '@/test/test-utils';

/**
 * TAB KHÔNG ĐƯỢC ĐEO SỐ 0.
 *
 * ===== LỖ BÀI NÀY CANH =====
 *
 * `item.count !== undefined` cho số `0` lọt qua, nên một hồ sơ chưa có giấy tờ nào hiện ra
 * "Giấy tờ 0" — trên trình duyệt thật, tab của một thiết bị trống trả về
 * `["Tổng quan", "Giấy tờ 0", "Két sắt 0", "Lịch sử"]`. Con số ấy không nói thêm gì so với
 * việc mở tab ra và thấy khu rỗng, mà lại làm tab trông như đang hỏng. `_SPEC.md:61` xếp đây
 * là lỗi, `_SPEC.md:529` là gạch nghiệm thu.
 *
 * Bốn màn chi tiết đều truyền số thô (`counts.files`, `counts.secrets`, `seatUsed`,
 * `portRowCount`), nên sửa ở `ui/tabs.tsx` là sửa cho cả bốn — thay vì bắt mỗi màn tự nhớ
 * (AD-15).
 *
 * ===== VÌ SAO GỘP `0` VỚI `undefined` =====
 *
 * `ui/tab-counts.ts` khai rõ `undefined` = "CHƯA BIẾT (đang tải, hoặc không có quyền xem),
 * KHÔNG phải 0". Hai nghĩa khác nhau, nhưng câu trả lời cho câu hỏi "có vẽ con số không" thì
 * giống nhau: không. Nên phép thử truthy ở đây là chủ ý, không phải cẩu thả.
 */
describe('Tabs — số đếm', () => {
  const dung = (count: number | undefined) =>
    renderWithI18n(
      <Tabs
        items={[
          { key: 'profile', label: 'Hồ sơ' },
          { key: 'files', label: 'Giấy tờ', count },
        ]}
        value="profile"
        onChange={() => undefined}
        ariaLabel="Thiết bị"
      />,
    );

  const nhanTab = () => screen.getByRole('tab', { name: /Giấy tờ/ }).textContent ?? '';

  it('count = 0 thì KHÔNG vẽ số', () => {
    dung(0);
    expect(nhanTab()).toBe('Giấy tờ');
    expect(document.querySelector('.tab-count')).toBeNull();
  });

  it('count = undefined (chưa biết) cũng không vẽ số', () => {
    dung(undefined);
    expect(nhanTab()).toBe('Giấy tờ');
    expect(document.querySelector('.tab-count')).toBeNull();
  });

  it('count > 0 thì vẽ, và có dấu cách để trình đọc màn hình không đọc dính', () => {
    dung(4);
    // "Giấy tờ 4", KHÔNG phải "Giấy tờ4" — xem chú thích về dấu cách trong `ui/tabs.tsx`.
    expect(nhanTab()).toBe('Giấy tờ 4');
    expect(document.querySelector('.tab-count')?.textContent).toBe('4');
  });
});
