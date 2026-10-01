import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import {
  DeviceTypeFilter,
  deviceTypeIdsParam,
  isRouterType,
  routerTypeIdsOf,
  useDeviceTypeFilter,
} from '@/ui/device-type-filter';

const TYPES = [
  { id: 'fw', name: 'Firewall', isRouter: true, active: true },
  { id: 'core', name: 'Core', isRouter: false, active: true },
  { id: 'rt', name: 'Router', isRouter: true, active: true },
  { id: 'old', name: 'Modem cũ', isRouter: true, active: false },
];

/* Q-20: ô chọn thiết bị của NAT / Đường truyền lọc theo loại, mặc định các loại cờ Router. */
describe('device-type-filter — hàm thuần', () => {
  it('loại cờ Router (kể cả loại đã ngừng dùng: router cũ vẫn là router)', () => {
    expect(routerTypeIdsOf(TYPES)).toEqual(['fw', 'rt', 'old']);
    expect(routerTypeIdsOf(undefined)).toEqual([]);
  });

  it.each([
    [[], ''],
    [['fw'], 'deviceTypeIds=fw'],
    [['fw', 'core'], 'deviceTypeIds=fw%2Ccore'],
  ])('tham số %j → "%s"', (ids, expected) => {
    expect(deviceTypeIdsParam(ids as string[])).toBe(expected);
  });

  it.each([
    ['fw', true],
    ['core', false],
    [undefined, true],
  ])('isRouterType(%s) = %s (không biết loại thì không cảnh báo)', (id, expected) => {
    expect(isRouterType(TYPES, id)).toBe(expected);
  });
});

function Harness({ onValue }: { onValue: (value: string[]) => void }) {
  const [types] = useState(TYPES);
  const filter = useDeviceTypeFilter(types);
  onValue(filter.value);
  return <DeviceTypeFilter types={types} value={filter.value} onChange={filter.setValue} />;
}

describe('DeviceTypeFilter', () => {
  it('mặc định bật các loại Router; "Tất cả loại" gỡ hết; bấm Core thêm Core', async () => {
    const seen = vi.fn();
    renderWithI18n(<Harness onValue={seen} />);
    const group = screen.getByRole('group', { name: 'Lọc theo loại thiết bị' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Firewall' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Core' })).toHaveAttribute('aria-pressed', 'false');
    // Loại đã ngừng dùng không bày thành chip mới — nhưng vẫn nằm trong bộ lọc mặc định.
    expect(screen.queryByRole('button', { name: 'Modem cũ' })).toBeNull();
    expect(seen).toHaveBeenLastCalledWith(['fw', 'rt', 'old']);

    await userEvent.click(screen.getByRole('button', { name: 'Core' }));
    expect(seen.mock.calls.at(-1)?.[0]).toEqual(expect.arrayContaining(['fw', 'core', 'rt']));

    await userEvent.click(screen.getByRole('button', { name: 'Tất cả loại' }));
    expect(seen).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole('button', { name: 'Tất cả loại' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  /* Danh sách loại dài (12+ loại) trong một ô hẹp: cuộn ngang thì chip đang bật (Firewall)
     nằm khuất, người dùng không thấy bộ lọc đang lọc gì. Chip xuống dòng thay vì cuộn. */
  it('dải chip xuống dòng (không cuộn ngang)', () => {
    renderWithI18n(<Harness onValue={() => undefined} />);
    expect(screen.getByRole('group', { name: 'Lọc theo loại thiết bị' })).toHaveClass('segmented', 'wrap');
  });
});
