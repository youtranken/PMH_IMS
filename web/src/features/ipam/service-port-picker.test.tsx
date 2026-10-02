import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import type { ServicePortRow } from '@/lib/catalog-types';
import { ServicePortPicker } from './service-port-picker';

const HIKVISION = {
  id: 's1',
  name: 'Hikvision',
  protocol: 'tcp',
  portFrom: 6001,
  portTo: 6001,
  active: true,
} as unknown as ServicePortRow;

/* Q-20: tên dịch vụ bị cắt "Hkvi…" trong menu — rê chuột phải đọc được đủ tên, menu nới rộng. */
describe('ServicePortPicker', () => {
  it('mỗi dòng mang title là tên đầy đủ; menu không bị ép bằng bề rộng ô', async () => {
    renderWithI18n(
      <ServicePortPicker services={[HIKVISION]} onPick={vi.fn()} onAdd={vi.fn()} label="Port ngoài" />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Lọc dịch vụ cho Port ngoài' }));
    const option = await screen.findByRole('option', { name: /Hikvision/ });
    expect(option.querySelector('[title="Hikvision"]')).not.toBeNull();
    const menu = screen.getByRole('listbox');
    expect(menu.style.width).toBe('');
  });
});
