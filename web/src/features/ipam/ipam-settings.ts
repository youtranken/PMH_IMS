import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

export interface IpamSettings {
  /** Ngưỡng "dải sắp đầy" — CÙNG con số ô "Dải mạng sắp đầy" của bảng điều khiển. */
  subnetFullPercent: number;
  /** Cổng mở ra Internet bị gắn "Nhạy cảm" trên sổ NAT. */
  natSensitivePorts: number[];
}

/*
 * Giá trị dùng trong lúc câu hỏi chưa về (và khi hỏng) — trùng giá trị seed. Đây là tham số
 * hiển thị (màu thanh đo, huy hiệu), nên hỏng thì lùi về mặc định và im lặng, không nuốt màn
 * hình bằng một khối lỗi.
 */
const FALLBACK: IpamSettings = {
  subnetFullPercent: 80,
  natSensitivePorts: [21, 22, 23, 445, 1433, 3306, 3389, 5432, 5900],
};

/** Tham số hiển thị của màn IP và sổ NAT, đọc từ `system_config` qua `GET ipam/settings` (AD-11). */
export function useIpamSettings(): IpamSettings {
  const query = useQuery({
    queryKey: ['ipam', 'settings'],
    queryFn: () => apiFetch<IpamSettings>('/api/v1/ipam/settings'),
    staleTime: 10 * 60_000,
    retry: false,
  });
  return query.data ?? FALLBACK;
}
