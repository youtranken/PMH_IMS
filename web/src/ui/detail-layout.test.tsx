import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen } from '@/test/test-utils';
import { DetailLayout } from '@/ui/detail-layout';

describe('DetailLayout', () => {
  it('không truyền `rail`: một cột trơn, không có cột phải rỗng', () => {
    const { container } = renderWithI18n(
      <DetailLayout>
        <p>Nội dung</p>
      </DetailLayout>,
    );
    expect(screen.getByText('Nội dung')).toBeInTheDocument();
    expect(container.querySelector('.detail-1col')).not.toBeNull();
    expect(container.querySelector('aside')).toBeNull();
  });

  it('có `rail`: hai cột, thẻ ở cột phải', () => {
    const { container } = renderWithI18n(
      <DetailLayout rail={<p>Thẻ</p>}>
        <p>Nội dung</p>
      </DetailLayout>,
    );
    expect(container.querySelector('aside')).toHaveTextContent('Thẻ');
  });
});
