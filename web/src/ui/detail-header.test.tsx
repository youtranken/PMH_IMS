import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DetailHeader } from '@/ui/detail-header';
import { renderWithI18n, screen } from '@/test/test-utils';

/*
 * Mũi tên của nút quay lại phải là SVG `Chevron`, không phải ký tự `‹`: ký tự in to hơn chữ
 * bên cạnh nằm theo đường cơ sở của phông nên lệch lên/xuống, SVG thì căn giữa bằng flex.
 */
describe('DetailHeader — nút quay lại', () => {
  it('mũi tên là SVG chevron, tên nút chỉ là chữ', () => {
    renderWithI18n(
      <MemoryRouter>
        <DetailHeader crumbs={[{ label: 'Thiết bị', to: '/devices' }, { label: 'SW-01' }]} code="SW-01" />
      </MemoryRouter>,
    );
    const back = screen.getByRole('link', { name: 'Thiết bị' });
    expect(back.textContent).toBe('Thiết bị');
    expect(back.querySelector('svg.chevron.crumb-arrow')).not.toBeNull();
  });
});
