import { locationLabel } from '@/lib/device-types';

/**
 * Vị trí "site · tủ" của thiết bị, CHỈ được xuống dòng sau dấu "·".
 *
 * Mã đọc theo khối: ngắt "TU-E2E-" / "HCM-01" giữa mã là người đọc chép sai tủ. Mỗi mã nằm
 * trong một `.mono` không ngắt; khoảng TRƯỚC dấu chấm giữa là khoảng trắng không ngắt, nên chỗ
 * ngắt duy nhất là khoảng SAU dấu — không có dòng nào bắt đầu bằng "·" đứng trơ trọi.
 */
export function LocationText({
  device,
}: {
  device: { siteCode: string | null; cabinetCode: string | null };
}) {
  if (!device.siteCode || !device.cabinetCode) {
    return <span className="mono">{locationLabel(device)}</span>;
  }
  return (
    <span className="location-text">
      <span className="mono">{device.siteCode}</span>
      {'\u00a0· '}
      <span className="mono">{device.cabinetCode}</span>
    </span>
  );
}
