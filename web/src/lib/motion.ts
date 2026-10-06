const MOTION_KEY = 'ims_motion'; // chỉ lựa chọn hiển thị — KHÔNG token (AD-8)

/**
 * "Hiệu ứng chuyển động" (Q-21). 'system' theo `prefers-reduced-motion` của máy; 'on' thắng báo
 * "giảm chuyển động" (máy qua phiên từ xa / máy ảo luôn báo thế dù người dùng không chọn); 'off'
 * tắt cả khi máy cho phép.
 */
export type MotionPreference = 'system' | 'on' | 'off';

/** Phát khi lựa chọn đổi, để mọi chỗ hiển thị lựa chọn cùng cập nhật. */
export const MOTION_EVENT = 'ims-motion-change';

const SYSTEM_REDUCE = '(prefers-reduced-motion: reduce)';

/** Quy ước phải khớp `public/theme-init.js` (đặt `data-motion` trước khi React render). */
export function motionPreference(): MotionPreference {
  try {
    const saved = localStorage.getItem(MOTION_KEY);
    return saved === 'on' || saved === 'off' ? saved : 'system';
  } catch {
    return 'system';
  }
}

/**
 * 'on'/'off' ghi thẳng lên `<html data-motion>`; 'system' gỡ thuộc tính để CSS tự theo `@media`.
 * Mọi luật "giảm chuyển động" trong CSS khoá theo đúng thuộc tính này.
 */
export function setMotionPreference(pref: MotionPreference): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.motion;
  else root.dataset.motion = pref;
  try {
    localStorage.setItem(MOTION_KEY, pref);
  } catch {
    // kho bị chặn thì vẫn áp cho phiên hiện tại
  }
  window.dispatchEvent(new Event(MOTION_EVENT));
}

/**
 * Có bỏ chuyển động không — đọc thuộc tính đang áp (không đọc kho) để JS và CSS luôn nói cùng
 * một điều.
 */
export function motionReduced(): boolean {
  const applied = document.documentElement.dataset.motion;
  if (applied === 'on') return false;
  if (applied === 'off') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia(SYSTEM_REDUCE).matches;
}
