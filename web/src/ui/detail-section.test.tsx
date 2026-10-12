import { describe, expect, it } from 'vitest';
import { DetailSection } from '@/ui/detail-layout';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';

describe('DetailSection', () => {
  it('action đứng cùng hàng tiêu đề, khu vẫn là landmark mang đúng tên', () => {
    renderWithI18n(
      <DetailSection title="Thông số" action={<button type="button">Bổ sung 2 ô</button>}>
        <p>nội dung</p>
      </DetailSection>,
    );
    const region = screen.getByRole('region', { name: 'Thông số' });
    expect(region).toContainElement(screen.getByRole('button', { name: 'Bổ sung 2 ô' }));
  });

  it('foldable: gập sẵn thì chỉ có tiêu đề + tóm tắt; bấm thì mở nội dung', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <DetailSection title="Hình dùng trên sơ đồ" foldable={{ summary: 'Mặt trước: ảnh model' }}>
        <p>hai ô ảnh</p>
      </DetailSection>,
    );
    expect(screen.queryByText('hai ô ảnh')).not.toBeInTheDocument();
    expect(screen.getByText('Mặt trước: ảnh model')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Mở rộng Hình dùng trên sơ đồ' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Thân khu chưa có trong cây thì không trỏ tới nó (IDREF hỏng).
    expect(toggle).not.toHaveAttribute('aria-controls');

    await user.click(toggle);
    expect(screen.getByText('hai ô ảnh')).toBeInTheDocument();
    const open = screen.getByRole('button', { name: 'Thu gọn Hình dùng trên sơ đồ' });
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(open.getAttribute('aria-controls') ?? '')).toHaveTextContent('hai ô ảnh');
  });

  it('foldable mở sẵn khi defaultOpen', () => {
    renderWithI18n(
      <DetailSection title="Ảnh" foldable={{ defaultOpen: true }}>
        <p>hai ô ảnh</p>
      </DetailSection>,
    );
    expect(screen.getByText('hai ô ảnh')).toBeInTheDocument();
  });
});
