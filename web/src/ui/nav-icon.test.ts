import { describe, expect, it } from 'vitest';
import { navGroups } from '@/shell/app-nav';
import { hasNavIcon } from './nav-icon';

/**
 * Mục menu không có icon riêng thì rơi về một chấm tròn nhỏ — nhìn như dấu đầu dòng lạc giữa
 * hàng icon nét đều. Thêm mục mới mà quên vẽ icon phải ĐỎ ở đây.
 */
describe('NavIcon', () => {
  const keys = navGroups.flatMap((group) => group.items.map((item) => item.key));
  it.each(keys)('%s có icon riêng', (key) => {
    expect(hasNavIcon(key)).toBe(true);
  });
});
