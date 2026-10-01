import type { ReactNode } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { Combobox } from '@/ui/combobox';
import { deviceTypeIdsParam } from '@/ui/device-type-filter';
import { useDebouncedValue } from '@/ui/use-debounced-value';

/** Một máy trong ô chọn — đủ trường `GET /devices` trả để hiện và để cảnh báo loại (Q-20). */
export interface DeviceOption {
  id: string;
  code: string;
  name: string;
  siteCode?: string | null;
  deviceTypeId?: string | null;
}

/** Số máy mỗi lượt gợi ý — một con số cho mọi ô chọn máy, gõ thêm để thu hẹp. */
export const DEVICE_PICKER_LIMIT = 20;

/** Gốc khoá cache của mọi ô chọn máy — làm mới sau khi thêm máy (vd "Thêm router mới") theo khoá này. */
export const DEVICE_PICKER_KEY = ['devices', 'picker'] as const;

/** Phần query của `GET /devices` cho ô chọn máy — tách ra để kiểm bằng bảng dữ liệu. */
export function devicePickerQuery({
  term,
  typeIds,
  nearSiteId,
  usable = true,
}: {
  term: string;
  typeIds?: string[];
  nearSiteId?: string;
  usable?: boolean;
}): string {
  const params = new URLSearchParams({ limit: String(DEVICE_PICKER_LIMIT) });
  if (usable) params.set('usable', 'true');
  const q = term.trim();
  if (q) params.set('search', q);
  // Site chỉ là gợi ý KHI CHƯA GÕ: gõ thì tìm khắp kho (máy chưa gán site vẫn phải ra).
  else if (nearSiteId) params.set('siteId', nearSiteId);
  const byType = deviceTypeIdsParam(typeIds ?? []);
  return [params.toString(), byType].filter(Boolean).join('&');
}

/**
 * Ô chọn MỘT thiết bị trong kho — dùng chung cho cấp/sửa IP, đường truyền, NAT (router + máy
 * đích), gán license, sơ đồ cổng (AD-15). Mỗi chỗ tự dựng một bản thì limit, khoá cache và nhịp
 * debounce lệch nhau, và một chỗ quên `usable=true` là bày ra máy đã thanh lý để chọn.
 *
 * Điều khiển từ ngoài: `value = { deviceId, term }`. Gõ lại là bỏ lựa chọn cũ (`deviceId = ''`)
 * — nếu không, ô hiện mã A mà id gửi đi là B. Đã chọn thì thôi hỏi API (ô đang hiện đúng mã).
 *
 * `typeIds` = lọc theo loại (`DeviceTypeFilter`, Q-20); `nearSiteId` = khi CHƯA gõ thì mở sẵn
 * máy cùng site; `exclude` = id không bày ra (máy đã chọn trong lô, chính máy đang sửa);
 * `minChars` = chỉ hỏi khi đã gõ đủ (ô trong hộp có nhiều ô khác, không cần danh sách mở sẵn);
 * `renderExtra` = dòng ghi thêm sau tên máy; `annotate` = một lượt hỏi thêm cho cả các máy đang
 * bày (vd "đang giữ IP …") — hỏng thì chỉ mất dòng ghi thêm, ô chọn vẫn dùng được.
 */
export function DeviceCombobox({
  value,
  onChange,
  ariaLabel,
  placeholder,
  typeIds,
  nearSiteId,
  usable = true,
  exclude,
  minChars = 0,
  ready = true,
  renderExtra,
  annotate,
  action,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
}: {
  value: { deviceId: string; term: string };
  onChange: (next: { deviceId: string; term: string; device?: DeviceOption }) => void;
  ariaLabel: string;
  placeholder: string;
  typeIds?: string[];
  nearSiteId?: string;
  usable?: boolean;
  exclude?: string[];
  minChars?: number;
  /** `false` khi bộ lọc còn chờ dữ liệu (vd danh mục loại chưa về) — hỏi sớm thì danh sách co lại. */
  ready?: boolean;
  renderExtra?: (device: DeviceOption) => ReactNode;
  annotate?: (ids: string[]) => {
    queryKey: QueryKey;
    queryFn: () => Promise<Record<string, ReactNode>>;
  };
  action?: { label: string; onClick: () => void };
  /** Ba thuộc tính `Field` tự gắn vào đứa con — chuyển thẳng xuống ô gõ thật. */
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const term = useDebouncedValue(value.term);
  const query = devicePickerQuery({ term, typeIds, nearSiteId, usable });
  const devices = useQuery({
    queryKey: [...DEVICE_PICKER_KEY, query],
    enabled: ready && !value.deviceId && term.trim().length >= minChars,
    queryFn: () => apiFetch<{ items: DeviceOption[] }>(`/api/v1/devices?${query}`),
  });
  const options = (devices.data?.items ?? []).filter((item) => !exclude?.includes(item.id));
  const ids = options.map((item) => item.id);
  const note = annotate?.(ids);
  const notes = useQuery({
    queryKey: note?.queryKey ?? [...DEVICE_PICKER_KEY, 'no-annotate'],
    enabled: note !== undefined && ids.length > 0 && !value.deviceId,
    queryFn: note?.queryFn ?? (() => Promise.resolve({})),
  });

  return (
    <Combobox
      id={id}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      query={value.term}
      onQuery={(next) => onChange({ deviceId: '', term: next })}
      options={options}
      failed={devices.isError}
      getKey={(item) => item.id}
      renderOption={(item) => {
        const extra = renderExtra?.(item) ?? notes.data?.[item.id];
        return (
          <>
            <span className="mono">{item.code}</span>{' '}
            <small>{[item.name, item.siteCode].filter(Boolean).join(' · ')}</small>
            {extra ? (
              <small>
                {' · '}
                {extra}
              </small>
            ) : null}
          </>
        );
      }}
      onSelect={(item) => onChange({ deviceId: item.id, term: item.code, device: item })}
      action={action}
    />
  );
}
