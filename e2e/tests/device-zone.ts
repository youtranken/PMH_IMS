import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Khu chi tiết của trang thiết bị (Địa chỉ IP, Sổ NAT, Đường truyền ISP). Trên máy tính khu GẬP
 * SẴN (Q-27 bổ sung 10/10: bản đồ quan hệ đã tóm tắt), nên bài muốn đọc dòng trong khu phải mở nó
 * ra trước — qua đúng nút người dùng bấm. Điện thoại mở sẵn thì không bấm gì.
 */
export async function openDeviceZone(page: Page, title: string): Promise<Locator> {
  const region = page.getByRole('region', { name: title });
  await expect(region).toBeVisible();
  const expand = region.getByRole('button', { name: `Mở rộng ${title}` });
  if ((await expand.count()) > 0) await expand.click();
  return region;
}

/** Khu "Hình dùng trên sơ đồ" của trang thiết bị gập sẵn (Q-27 bổ sung) — mở để tới hai ô ảnh. */
export async function openDeviceLook(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Mở rộng Hình dùng trên sơ đồ' }).click();
}
