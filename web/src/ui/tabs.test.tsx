import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { Tabs } from '@/ui/tabs';

const ITEMS = [
  { key: 'site', label: 'Site' },
  { key: 'cabinet', label: 'Tủ mạng' },
  { key: 'vendor', label: 'Nhà cung cấp' },
];

function Harness() {
  const [value, setValue] = useState('site');
  return <Tabs items={ITEMS} value={value} onChange={setValue} ariaLabel="Danh mục" />;
}

describe('Tabs dùng chung', () => {
  it('chỉ tab đang chọn nằm trong luồng Tab của bàn phím', () => {
    renderWithI18n(<Harness />);
    expect(screen.getByRole('tab', { name: 'Site' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Tủ mạng' })).toHaveAttribute('tabindex', '-1');
  });

  it('phím mũi tên chuyển tab và cuộn vòng ở hai đầu', async () => {
    const user = userEvent.setup();
    renderWithI18n(<Harness />);
    const site = screen.getByRole('tab', { name: 'Site' });
    site.focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Tủ mạng' })).toHaveAttribute('aria-selected', 'true');

    // Từ tab đầu bấm ← phải sang tab cuối, không phải kẹt lại.
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Nhà cung cấp' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('Home/End nhảy về tab đầu và tab cuối', async () => {
    const user = userEvent.setup();
    renderWithI18n(<Harness />);
    screen.getByRole('tab', { name: 'Site' }).focus();

    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Nhà cung cấp' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Site' })).toHaveAttribute('aria-selected', 'true');
  });

  it('bấm chuột cũng đổi tab', async () => {
    const user = userEvent.setup();
    renderWithI18n(<Harness />);
    await user.click(screen.getByRole('tab', { name: 'Nhà cung cấp' }));
    expect(screen.getByRole('tab', { name: 'Nhà cung cấp' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
