import { describe, expect, it } from 'vitest';
import { FactStrip, SpecList } from '@/ui/detail-facts';
import { renderWithI18n, screen } from '@/test/test-utils';

/**
 * AX-01: `role="group"` đặt thẳng lên `<dl>` đè ngữ nghĩa danh sách định nghĩa — axe (dlitem)
 * coi mọi dt/dd như không có dl cha: 432 phần tử ở 28 màn. Tên nhóm vẫn phải giữ (test và trình
 * đọc màn hình tìm "Tóm tắt thiết bị", "Thông số"), nên role nằm ở lớp bọc ngoài.
 */
describe('FactStrip / SpecList — dl không mang role', () => {
  it.each([
    ['FactStrip', <FactStrip key="f" label="Tóm tắt thiết bị" facts={[{ key: 'a', label: 'Vị trí', value: 'T-01' }]} />, 'Tóm tắt thiết bị'],
    ['SpecList', <SpecList key="s" label="Thông số" items={[{ label: 'Serial', value: 'X1' }]} />, 'Thông số'],
  ])('%s', (_, node, name) => {
    renderWithI18n(node);
    const group = screen.getByRole('group', { name });
    const dl = group.querySelector('dl');
    expect(dl).not.toBeNull();
    expect(dl).not.toHaveAttribute('role');
    for (const item of Array.from(group.querySelectorAll('dt, dd'))) expect(item.closest('dl')).toBe(dl);
  });
});
