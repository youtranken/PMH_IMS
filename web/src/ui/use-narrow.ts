import { BREAKPOINTS } from '@/ui/breakpoints';
import { useMediaQuery } from '@/ui/use-media-query';

/** Đang ở màn hẹp (điện thoại, máy tính bảng dọc) — mốc `BREAKPOINTS.narrow`, khớp drawer của shell. */
export function useIsNarrow(): boolean {
  return useMediaQuery(BREAKPOINTS.narrow);
}
