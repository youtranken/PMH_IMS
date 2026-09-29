import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import '@/lib/i18n';
import { usePageTitle } from '@/ui/use-page-title';

/**
 * Tên tab trình duyệt phải ĐỔI THEO MÀN (B-03).
 *
 * Bài này dùng `t` THẬT (nạp `@/lib/i18n`) chứ không stub: nó khẳng định về CHỮ người dùng
 * đọc trên tab, nên một khoá gõ sai phải đỏ ngay tại đây. Stub trả lại chính cái khoá thì
 * `'nav.devices · IMS'` cũng "xanh", và bài kiểm khi đó chỉ canh việc có gọi `t` hay không.
 */

function wrap(path: string) {
  return function Wrap({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
  };
}

describe('usePageTitle', () => {
  it.each([
    ['/', 'Bảng điều khiển · IMS'],
    ['/devices', 'Thiết bị · IMS'],
    ['/software', 'Phần mềm · IMS'],
    ['/admin/accounts', 'Người dùng IMS · IMS'],
    // Trang chi tiết đội tên khu vực của nó.
    ['/devices/abc-123', 'Thiết bị · IMS'],
    ['/ip-addresses/sub-1', 'Địa chỉ IP · IMS'],
  ])('%s → "%s"', (path, expected) => {
    renderHook(() => usePageTitle(), { wrapper: wrap(path) });
    expect(document.title).toBe(expected);
  });

  it('đường lạ chỉ đội tên sản phẩm, không đoán bừa một màn', () => {
    renderHook(() => usePageTitle(), { wrapper: wrap('/khong-co-duong-nay') });
    expect(document.title).toBe('IMS');
  });

  it('tên MÀN đứng trước tên sản phẩm', () => {
    /*
     * Vế này đáng một ô riêng vì nó là cả lý do của B-03: tab bị bóp còn ~15 ký tự khi mở
     * nhiều tab, và trình duyệt cắt ĐUÔI. Đảo thứ tự thành "IMS · Thiết bị" thì bốn tab IMS
     * lại đọc y hệt nhau — tức bài kiểm trên vẫn xanh trong khi lỗi đã quay lại nguyên vẹn.
     */
    renderHook(() => usePageTitle(), { wrapper: wrap('/devices') });
    expect(document.title.startsWith('Thiết bị')).toBe(true);
  });
});
