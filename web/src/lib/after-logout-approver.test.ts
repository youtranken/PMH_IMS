import { describe, expect, it } from 'vitest';
import { clearPaletteRecent, LAST_APPROVER_KEY } from './after-logout';

/** Máy dùng chung: người duyệt người trước chọn ở hộp Xin mở két không được sống qua lượt đăng xuất. */
describe('Hết phiên xoá người duyệt nhớ sẵn', () => {
  it('clearPaletteRecent xoá luôn khoá người duyệt lần trước', () => {
    localStorage.setItem(LAST_APPROVER_KEY, 'sa@pmh.com.vn');
    clearPaletteRecent();
    expect(localStorage.getItem(LAST_APPROVER_KEY)).toBeNull();
  });
});
