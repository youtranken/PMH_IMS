import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipToggleGroup } from '@/ui/chip-toggle-group';

/** Đủ trường của một loại thiết bị trong danh mục để lọc — khớp `CatalogLists.deviceTypes`. */
export interface FilterableDeviceType {
  id: string;
  name: string;
  isRouter: boolean;
  active: boolean;
}

/**
 * Loại mang cờ "Router/Firewall" — mặc định của ô chọn thiết bị ở NAT / Đường truyền. Tính cả
 * loại đã ngừng dùng: một con router cũ vẫn là router.
 */
export function routerTypeIdsOf(types: FilterableDeviceType[] | undefined): string[] {
  return (types ?? []).filter((type) => type.isRouter).map((type) => type.id);
}

/** Phần query `deviceTypeIds=a,b` cho `GET /devices`; rỗng = không lọc theo loại. */
export function deviceTypeIdsParam(ids: string[]): string {
  return ids.length > 0 ? new URLSearchParams({ deviceTypeIds: ids.join(',') }).toString() : '';
}

/**
 * Loại của máy vừa chọn có phải loại Router không — để CẢNH BÁO nhẹ, không chặn (Q-20: Core
 * hay Firewall vẫn làm NAT được). Không biết loại (hồ sơ cũ, danh mục chưa tải) thì coi là có,
 * để không bắn cảnh báo sai.
 */
export function isRouterType(
  types: FilterableDeviceType[] | undefined,
  typeId: string | null | undefined,
): boolean {
  if (!typeId || !types) return true;
  const type = types.find((item) => item.id === typeId);
  return type ? type.isRouter : true;
}

/**
 * Trạng thái bộ lọc: chưa đụng tới thì là các loại Router (tính lại khi danh mục về); người
 * dùng bấm rồi thì giữ đúng lựa chọn của họ, kể cả "Tất cả loại" (mảng rỗng).
 */
export function useDeviceTypeFilter(types: FilterableDeviceType[] | undefined): {
  value: string[];
  setValue: (next: string[]) => void;
} {
  const [chosen, setChosen] = useState<string[] | null>(null);
  return { value: chosen ?? routerTypeIdsOf(types), setValue: setChosen };
}

/**
 * Dải chip "Tất cả loại · Firewall · Core · Router…" đặt dưới một ô chọn thiết bị (Q-20) — chọn
 * nhiều loại một lúc, áp ngay vào danh sách của ô chọn.
 *
 * Chip chỉ bày loại ĐANG dùng; loại đã ngừng mà vẫn nằm trong lựa chọn (mặc định Router có cả
 * loại cũ) thì vẫn được lọc, chỉ không có chip để bấm.
 */
export function DeviceTypeFilter({
  types,
  value,
  onChange,
}: {
  types: FilterableDeviceType[] | undefined;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const shown = (types ?? []).filter((type) => type.active);
  return (
    <ChipToggleGroup
      label={t('deviceTypeFilter.label')}
      allLabel={t('deviceTypeFilter.all')}
      options={shown.map((type) => ({ value: type.id, label: type.name }))}
      value={value}
      onChange={(next) => {
        // `toggleChip` chỉ giữ giá trị có chip; giữ lại loại ẩn (đã ngừng) đang được lọc ngầm.
        const hidden = value.filter((id) => !shown.some((type) => type.id === id));
        onChange(next.length === 0 ? [] : [...next, ...hidden]);
      }}
    />
  );
}
