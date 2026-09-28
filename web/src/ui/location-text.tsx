import { locationLabel } from '@/lib/device-types';

/**
 * Vị trí "site · tủ" của thiết bị, CHỈ được xuống dòng sau dấu "·".
 *
 * Mã đọc theo khối: ngắt "TU-E2E-" / "HCM-01" giữa mã là người đọc chép sai tủ. Mỗi mã nằm
 * trong một `.mono` không ngắt, `<wbr>` sau dấu chấm giữa là chỗ ngắt duy nhất được phép. Chữ
 * đọc ra vẫn y hệt `locationLabel` nên tìm theo chữ trên màn không đổi.
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
      <span className="mono">{device.siteCode}</span> · <wbr />
      <span className="mono">{device.cabinetCode}</span>
    </span>
  );
}
