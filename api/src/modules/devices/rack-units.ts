import { rackUnitLabel } from '../../common/rack-units';

/** Trần U của một tủ — khớp `cabinet_u_height_check` và `device_rack_u_range_check`. */
export const RACK_U_MAX = 60;

export interface RackUnitsInput {
  start: number | null;
  size: number | null;
  hasCabinet: boolean;
  cabinetCode: string | null;
  /** `cabinet.u_height`; `null` = tủ chưa khai chiều cao, chỉ áp trần 60. */
  cabinetHeight: number | null;
}

/**
 * Lý do từ chối U của một hồ sơ, `null` = nhận. Hàm thuần, câu chữ tiếng Việt cho người dùng —
 * CHECK của DB chỉ là lưới cuối, gặp nó người dùng chỉ thấy một câu chung chung.
 */
export function rackUnitsReason(input: RackUnitsInput): string | null {
  const { start, size } = input;
  if (start === null && size === null) return null;
  if (start === null || size === null) return '"U bắt đầu" và "Số U" phải cùng có hoặc cùng trống.';
  if (!Number.isInteger(start) || !Number.isInteger(size)) return '"U bắt đầu" và "Số U" phải là số nguyên.';
  if (start < 1 || start > RACK_U_MAX || size < 1 || size > RACK_U_MAX) {
    return `"U bắt đầu" và "Số U" phải từ 1 tới ${RACK_U_MAX}.`;
  }
  if (!input.hasCabinet) return 'Muốn khai vị trí U thì chọn tủ trước.';
  const top = start + size - 1;
  const height = input.cabinetHeight ?? RACK_U_MAX;
  if (top > height) {
    const where =
      input.cabinetHeight === null ? `${RACK_U_MAX}U` : `${['tủ', input.cabinetCode].filter(Boolean).join(' ')} (${input.cabinetHeight}U)`;
    return `${rackUnitLabel(start, size)} vượt ${where}.`;
  }
  return null;
}

export interface RackOccupant {
  code: string;
  name: string;
  start: number;
  size: number;
}

/** Máy đầu tiên (trong `others`) chiếm một U nằm trong dải `range`; `null` = dải còn trống. */
export function rackOverlap<T extends RackOccupant>(range: { start: number; size: number }, others: T[]): T | null {
  const top = range.start + range.size - 1;
  return others.find((other) => other.start <= top && range.start <= other.start + other.size - 1) ?? null;
}
