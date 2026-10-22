import { useCallback, useMemo, useState } from 'react';

/**
 * Chọn nhiều dòng của một bảng (`DataTable` prop `selection`) — Sắp hết hạn, Thiết bị, Sổ NAT
 * (UX-E25). Một bản cho mọi màn: tick / bỏ tick, chọn hết trang, xoá chọn.
 */
export function useRowSelection() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const onToggle = useCallback(
    (id: string) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const onToggleAll = useCallback(
    (ids: string[], checked: boolean) =>
      setSelected((current) => {
        const next = new Set(current);
        for (const id of ids) {
          if (checked) next.add(id);
          else next.delete(id);
        }
        return next;
      }),
    [],
  );
  const clear = useCallback(() => setSelected(new Set()), []);
  return useMemo(() => ({ selected, onToggle, onToggleAll, clear }), [selected, onToggle, onToggleAll, clear]);
}
