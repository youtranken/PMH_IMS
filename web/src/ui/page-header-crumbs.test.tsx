import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { PageHeader } from '@/ui/page-header';
import { renderWithI18n, screen } from '@/test/test-utils';

/** PW-B12: 4 kiểu nút quay lại. Màn con dùng breadcrumb trên tiêu đề như trang chi tiết. */
describe('PageHeader crumbs', () => {
  it('vẽ breadcrumb trên tiêu đề, mục đầu là link quay lại', () => {
    renderWithI18n(
      <MemoryRouter>
        <PageHeader title="Xem lại 0203" crumbs={[{ label: 'Kỳ phiếu', to: '/iso/periods' }, { label: 'Xem lại' }]} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(nav).toContainElement(screen.getByRole('link', { name: 'Kỳ phiếu' }));
    expect(screen.getByRole('link', { name: 'Kỳ phiếu' })).toHaveAttribute('href', '/iso/periods');
  });
});
