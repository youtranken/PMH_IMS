import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen, within } from '@/test/test-utils';
import { FactStrip, SpecList } from './detail-facts';

describe('FactStrip — dải 4 ô đầu trang chi tiết (Q-27)', () => {
  it('mỗi ô là một cặp nhãn / giá trị có tên, ô trống mang dấu "chưa khai" thay vì biến mất', () => {
    renderWithI18n(
      <FactStrip
        label="Tóm tắt thiết bị"
        facts={[
          { key: 'loc', label: 'Vị trí', value: 'LST · T-1', note: 'Lầu 3' },
          { key: 'user', label: 'Người sử dụng', value: null, blankText: 'chưa khai' },
        ]}
      />,
    );
    const strip = screen.getByRole('group', { name: 'Tóm tắt thiết bị' });
    const terms = within(strip).getAllByRole('term').map((node) => node.textContent);
    expect(terms).toEqual(['Vị trí', 'Người sử dụng']);
    expect(within(strip).getByText('Lầu 3')).toBeInTheDocument();
    const blank = within(strip).getByText('chưa khai');
    expect(blank.closest('dd')).toHaveAttribute('data-blank', 'true');
  });
});

describe('SpecList — thông số thứ tự cố định', () => {
  it('giữ đúng thứ tự khai báo, ô trống ghi "chưa khai" đúng chỗ của nó', () => {
    renderWithI18n(
      <SpecList
        label="Thông số"
        items={[
          { label: 'Loại thiết bị', value: 'Server' },
          { label: 'Model', value: '' },
          { label: 'Serial', value: <span className="mono">SN-1</span>, present: true },
          { label: 'Ghi chú', value: null },
        ]}
      />,
    );
    const list = screen.getByRole('group', { name: 'Thông số' });
    expect(within(list).getAllByRole('term').map((node) => node.textContent)).toEqual([
      'Loại thiết bị',
      'Model',
      'Serial',
      'Ghi chú',
    ]);
    const defs = within(list).getAllByRole('definition');
    expect(defs.map((node) => node.textContent)).toEqual(['Server', 'chưa khai', 'SN-1', 'chưa khai']);
    expect(defs[1]).toHaveAttribute('data-blank', 'true');
    expect(defs[2]).not.toHaveAttribute('data-blank');
  });
});
