import { describe, expect, it } from 'vitest';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { groupOfPath, navGroups, visibleGroups } from './app-nav';

const MEMBER = { role: 'member' } as Me;

/**
 * Q-27: khai Danh mục là việc ĐẦU TIÊN (site, tủ, model… phải có trước khi thêm thiết bị), nên
 * mục này đứng đầu nhóm Tài sản thay vì nằm khuất trong nhóm Hệ thống đang khép.
 */
describe('Danh mục đứng đầu nhóm Tài sản (Q-27)', () => {
  it('mục đầu của Tài sản là Danh mục, nhóm Hệ thống không còn mục này', () => {
    const assets = navGroups.find((group) => group.labelKey === 'nav.groupAssets');
    const admin = navGroups.find((group) => group.labelKey === 'nav.groupAdmin');
    expect(assets?.items[0]).toEqual({ key: 'nav.catalog', to: PATHS.adminCatalog });
    expect(admin?.items.map((item) => item.key)).not.toContain('nav.catalog');
  });

  it('màn Danh mục sáng nhóm Tài sản', () => {
    expect(groupOfPath(navGroups, PATHS.adminCatalog)?.labelKey).toBe('nav.groupAssets');
  });

  it('Member vẫn thấy Danh mục (form thiết bị cần biết danh mục có gì)', () => {
    const assets = visibleGroups(MEMBER).find((group) => group.labelKey === 'nav.groupAssets');
    expect(assets?.items.map((item) => item.key)).toContain('nav.catalog');
  });
});

/**
 * Q-22: SSL, tên miền, hợp đồng bảo trì nằm chung "Phần mềm" rồi lọc theo loại thì người dùng
 * không tìm ra. Mỗi loại có mục riêng trong "Tài sản", đúng thứ tự chủ dự án chốt.
 */
describe('Nhóm Tài sản (Q-22)', () => {
  const assets = () => navGroups.find((group) => group.labelKey === 'nav.groupAssets');

  it('đúng thứ tự: Danh mục · Thiết bị · Phần mềm · Tên miền & SSL · Hợp đồng bảo trì · Dịch vụ có hạn khác · … · Kho thanh lý', () => {
    const keys = assets()?.items.map((item) => item.key) ?? [];
    const order = ['nav.catalog', 'nav.devices', 'nav.software', 'nav.domains', 'nav.maintenance', 'nav.services'];
    expect(keys.slice(0, order.length)).toEqual(order);
    expect(keys[keys.length - 1]).toBe('nav.disposal');
  });

  it('mỗi mục trỏ đúng màn của nó', () => {
    const to = Object.fromEntries((assets()?.items ?? []).map((item) => [item.key, item.to]));
    expect(to['nav.software']).toBe(PATHS.software);
    expect(to['nav.domains']).toBe(PATHS.domains);
    expect(to['nav.maintenance']).toBe(PATHS.maintenance);
    expect(to['nav.services']).toBe(PATHS.services);
  });

  it('Member cũng thấy cả bốn màn (đọc mở cho mọi vai như Phần mềm)', () => {
    const keys = visibleGroups(MEMBER).flatMap((group) => group.items.map((item) => item.key));
    expect(keys).toEqual(expect.arrayContaining(['nav.software', 'nav.domains', 'nav.maintenance', 'nav.services']));
  });

  it('trang chi tiết của từng màn sáng đúng nhóm Tài sản', () => {
    for (const path of [PATHS.domainItem('a'), PATHS.maintenanceItem('a'), PATHS.serviceItem('a')]) {
      expect(groupOfPath(navGroups, path)?.labelKey).toBe('nav.groupAssets');
    }
  });
});
