import { describe, expect, it } from 'vitest';
import { Combobox } from '@/ui/combobox';
import { SuggestInput } from '@/ui/suggest-input';
import { renderWithI18n } from '@/test/test-utils';

/**
 * Ô gõ tự do có gợi ý không được mang mũi tên của ô chọn: người dùng thấy mũi tên thì tưởng chỉ
 * được chọn trong danh sách, không dám gõ "Chị Lan — Kế toán".
 */
describe('SuggestInput — dấu hiệu "gõ tự do, có gợi ý"', () => {
  it('nút bung dùng biểu tượng danh sách, không phải chevron', () => {
    const { container } = renderWithI18n(
      <SuggestInput value="" onChange={() => {}} options={['Kế toán']} placeholder="x" ariaLabel="Bộ phận" />,
    );
    expect(container.querySelector('.combo-caret .chevron')).toBeNull();
    expect(container.querySelector('.combo-caret[data-caret="suggest"]')).not.toBeNull();
  });

  it('Combobox thường vẫn giữ chevron', () => {
    const { container } = renderWithI18n(
      <Combobox
        placeholder="x"
        query=""
        onQuery={() => {}}
        options={[]}
        getKey={(o: string) => o}
        renderOption={(o) => o}
        onSelect={() => {}}
      />,
    );
    expect(container.querySelector('.combo-caret .chevron')).not.toBeNull();
  });
});
