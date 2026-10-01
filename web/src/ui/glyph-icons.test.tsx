import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import vi_ from '@/locales/vi';
import { renderWithI18n, screen } from '@/test/test-utils';
import { ConfirmProvider } from '@/ui/confirm-provider';
import { DetailHeader } from '@/ui/detail-header';
import { Dialog } from '@/ui/dialog';
import { CloseIcon, KebabIcon } from '@/ui/glyph-icons';
import { RowActions } from '@/ui/row-actions';

/*
 * Ký tự `›` `✕` `⋮` `→` theo cỡ chữ: ở 14px mảnh như dấu ngoặc, lệch khỏi tâm ô bấm, và đứng
 * cạnh SVG thì trông như hai hệ thống. Mọi hình nhỏ trên nút đều là SVG dùng chung.
 */
describe('Hình nhỏ trên nút là SVG, không phải ký tự', () => {
  it('CloseIcon và KebabIcon là SVG aria-hidden, không chữ', () => {
    const { container } = renderWithI18n(
      <>
        <CloseIcon />
        <KebabIcon />
      </>,
    );
    const svgs = container.querySelectorAll('svg[aria-hidden="true"]');
    expect(svgs).toHaveLength(2);
    expect(container.textContent).toBe('');
  });

  it('nút ba chấm vẽ SVG, tên vẫn là nhãn', () => {
    renderWithI18n(
      <RowActions label="Thao tác với LIC-01" items={[{ key: 'x', label: 'Xóa', onSelect: vi.fn() }]} />,
    );
    const trigger = screen.getByRole('button', { name: 'Thao tác với LIC-01' });
    expect(trigger.textContent).toBe('');
    expect(trigger.querySelector('svg')).not.toBeNull();
  });

  it('nút ✕ của hộp thoại là SVG, tên giữ "Đóng hộp thoại"', () => {
    renderWithI18n(
      <ConfirmProvider>
        <Dialog open onOpenChange={vi.fn()} title="Sửa thiết bị">
          <p>nội dung</p>
        </Dialog>
      </ConfirmProvider>,
    );
    const close = screen.getByRole('button', { name: 'Đóng hộp thoại' });
    expect(close.textContent).toBe('');
    expect(close.querySelector('svg')).not.toBeNull();
  });

  it('vạch ngăn breadcrumb là chevron SVG', () => {
    const { container } = renderWithI18n(
      <MemoryRouter>
        <DetailHeader
          crumbs={[{ label: 'Thiết bị', to: '/devices' }, { label: 'Router' }, { label: 'SW-01' }]}
          code="SW-01"
        />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(nav.textContent).not.toContain('›');
    expect(container.querySelectorAll('svg.chevron.crumb-sep')).toHaveLength(2);
  });

  it.each([
    ['vault.stepBack', vi_.vault.stepBack],
    ['access.backToList', vi_.access.backToList],
    ['expiry.openRecordShort', vi_.expiry.openRecordShort],
    ['palette.seeAll', vi_.palette.seeAll],
    ['palette.ipSub', vi_.palette.ipSub],
  ])('chuỗi %s không mang mũi tên ký tự', (_key, text) => {
    expect(text).not.toMatch(/[‹›←→]/);
  });
});
