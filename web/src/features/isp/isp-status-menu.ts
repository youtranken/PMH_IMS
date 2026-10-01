import type { TFunction } from 'i18next';
import type { RowAction } from '@/ui/row-actions';
import type { IspStatus } from './isp-types';

/**
 * Các bước đổi trạng thái đi được từ `status` — MỘT bộ cho cả danh sách lẫn trang chi tiết
 * (Q-18), để hai chỗ không bày hai menu khác nhau cho cùng một đường truyền.
 */
export function ispMenuTargets(status: IspStatus): IspStatus[] {
  if (status === 'active') return ['suspended', 'terminated'];
  if (status === 'suspended') return ['active', 'terminated'];
  return ['active'];
}

/**
 * `?action=<trạng thái>` là lối từ menu ⋮ của danh sách: hộp hỏi lại (nhất là Thanh lý) cần số
 * ngăn két của đường này, thứ chỉ trang chi tiết đọc. Giá trị đến từ thanh địa chỉ nên chỉ nhận
 * bước đi được từ trạng thái hiện tại.
 */
export function parseIspAction(action: string | null, status: IspStatus): IspStatus | null {
  return ispMenuTargets(status).find((next) => next === action) ?? null;
}

const MENU_KEY: Record<IspStatus, string> = {
  active: 'isp.reactivateMenu',
  suspended: 'isp.suspendMenu',
  terminated: 'isp.terminateMenu',
};

export function ispMenuItems(
  t: TFunction,
  status: IspStatus,
  onPick: (next: IspStatus) => void,
): RowAction[] {
  return ispMenuTargets(status).map((next) => ({
    key: next,
    label: t(MENU_KEY[next]),
    onSelect: () => onPick(next),
    warn: next === 'suspended',
    ok: next === 'active',
    danger: next === 'terminated',
  }));
}
