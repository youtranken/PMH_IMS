import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import type { DeviceRow, DeviceStatus } from '@/lib/device-types';
import { DeviceRowActions, deviceMenuItems } from './device-actions';

function device(status: DeviceStatus): DeviceRow {
  return {
    id: 'd1',
    code: 'PC-01',
    name: 'Máy trạm',
    deviceTypeId: 't1',
    deviceTypeName: 'PC',
    hasPortMap: false,
    model: null,
    serial: null,
    siteId: null,
    siteCode: null,
    cabinetId: null,
    cabinetCode: null,
    vendorId: null,
    vendorName: null,
    assignedTo: null,
    department: null,
    purchaseDate: null,
    warrantyStart: null,
    warrantyEnd: null,
    status,
    note: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function setup(status: DeviceStatus) {
  const handlers = {
    onEdit: vi.fn(),
    onStatus: vi.fn(),
    onClone: vi.fn(),
    onRetire: vi.fn(),
  };
  renderWithI18n(<DeviceRowActions device={device(status)} {...handlers} />);
  return handlers;
}

async function menuNames() {
  await userEvent.click(screen.getByRole('button', { name: 'Thao tác với PC-01' }));
  return screen.getAllByRole('menuitem').map((item) => item.textContent);
}

describe('Cột Thao tác của danh sách thiết bị (Q-18)', () => {
  it('máy đang dùng: nút Sửa ở ngoài, menu ⋮ có Đổi trạng thái · Nhân bản · Thanh lý (đỏ, cuối)', async () => {
    const handlers = setup('in_use');
    await userEvent.click(screen.getByRole('button', { name: 'Sửa máy PC-01' }));
    expect(handlers.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));

    expect(await menuNames()).toEqual(['Đổi trạng thái', 'Nhân bản', 'Thanh lý']);
    expect(screen.getByRole('menuitem', { name: 'Thanh lý' })).toHaveClass('danger');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Thanh lý' }));
    expect(handlers.onRetire).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }));
  });

  it('đổi trạng thái / nhân bản gọi đúng việc, không lan lên dòng', async () => {
    const handlers = setup('broken');
    await menuNames();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Đổi trạng thái' }));
    expect(handlers.onStatus).toHaveBeenCalledTimes(1);
    await menuNames();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Nhân bản' }));
    expect(handlers.onClone).toHaveBeenCalledTimes(1);
  });

  it('đường hỏng: máy đã thanh lý thì Sửa tắt, menu chỉ còn Đưa lại vào dùng · Nhân bản', async () => {
    const handlers = setup('retired');
    expect(screen.getByRole('button', { name: 'Sửa máy PC-01' })).toBeDisabled();
    expect(await menuNames()).toEqual(['Đưa lại vào dùng', 'Nhân bản']);
    expect(screen.getByRole('menuitem', { name: 'Đưa lại vào dùng' })).toHaveClass('ok');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Đưa lại vào dùng' }));
    expect(handlers.onStatus).toHaveBeenCalledTimes(1);
    expect(handlers.onRetire).not.toHaveBeenCalled();
  });
});

describe('deviceMenuItems — bộ việc dùng chung của trang chi tiết', () => {
  const t = ((key: string) => key) as unknown as Parameters<typeof deviceMenuItems>[0];
  const noop = () => {};

  it('điện thoại (Sửa không đứng ngoài): Sửa đứng đầu menu', () => {
    const keys = deviceMenuItems(t, false, {
      onEdit: noop,
      onStatus: noop,
      onClone: noop,
      onRetire: noop,
    }).map((item) => item.key);
    expect(keys).toEqual(['edit', 'status', 'clone', 'retire']);
  });

  it('máy đã thanh lý, nút "Đưa lại vào dùng" đã ở ngoài: menu chỉ còn Nhân bản', () => {
    const keys = deviceMenuItems(t, true, {
      onEdit: noop,
      onStatus: noop,
      onClone: noop,
      onRetire: noop,
    }).map((item) => item.key);
    expect(keys).toEqual(['clone']);
  });
});
