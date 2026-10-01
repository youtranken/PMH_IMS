import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen } from '@/test/test-utils';
import { PerpetualBadge } from '@/ui/perpetual-badge';
import { SecretStrengthMeter } from '@/ui/secret-strength-meter';

/*
 * Ký tự làm hình (∞ ✓ ○) theo phông chữ: mỗi máy một nét, lệch đường cơ sở, và trình đọc màn
 * hình đọc ra "vô cực", "dấu kiểm". Hình là SVG dùng chung (`glyph-icons.tsx`), chữ là chữ.
 */
describe('hình trong nhãn là SVG, không phải ký tự', () => {
  it('PerpetualBadge: chữ "Vĩnh viễn" + hình vô cực aria-hidden', () => {
    const { container } = renderWithI18n(<PerpetualBadge />);
    expect(container.textContent).toBe('Vĩnh viễn');
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('Vĩnh viễn')).toHaveClass('badge');
  });

  it('PerpetualBadge plain: không khung badge', () => {
    renderWithI18n(<PerpetualBadge plain />);
    expect(screen.getByText('Vĩnh viễn')).not.toHaveClass('badge');
  });

  it('SecretStrengthMeter không in ✓ / ○', () => {
    const b = renderWithI18n(<SecretStrengthMeter value="abc" />);
    expect(b.container.textContent).not.toMatch(/[✓○]/);
    expect(b.container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
  });
});
