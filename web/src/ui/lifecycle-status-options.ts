import type { TFunction } from 'i18next';
import type { SelectOption } from '@/ui/select';

/** Giá trị "mọi trạng thái kể cả cuối đời" trên URL — `''` là mặc định (ẩn hồ sơ cuối đời). */
export const ALL_STATUSES = 'all';

/**
 * Mục của ô lọc trạng thái vòng đời ở các màn danh sách ẩn hồ sơ cuối đời theo mặc định (Q-20):
 * Thiết bị, Phần mềm, Đường truyền, Tài khoản dịch vụ.
 *
 * Một khuôn chữ cho cả bốn màn ("Đang theo dõi (trừ …)" / "Tất cả (cả …)") và "Tất cả" LUÔN đứng
 * cuối — mỗi màn tự dựng thì chữ lệch nhau và một màn để "Tất cả" lọt giữa danh sách.
 *
 * `endStatus` là trạng thái cuối đời của chính màn đó; tên của nó lấy từ `labelOf` để câu gọi
 * đúng tên module chủ ("Đã thanh lý" / "Đã ngừng dùng").
 */
export function lifecycleStatusOptions<S extends string>(
  t: TFunction,
  {
    statuses,
    labelOf,
    endStatus,
  }: {
    statuses: readonly S[];
    labelOf: (status: S) => string;
    endStatus: S;
  },
): (SelectOption & { label: string })[] {
  const end = labelOf(endStatus);
  return [
    { value: '', label: t('common.lifecycleLive', { end }) },
    ...statuses.map((status) => ({ value: status as string, label: labelOf(status) })),
    { value: ALL_STATUSES, label: t('common.lifecycleAll', { end }) },
  ];
}
