import { useOwnerAttachments, type AttachmentOwnerType } from '@/ui/attachment-panel';
import { useOwnerSecrets, type SecretOwnerType } from '@/ui/vault-panel';
import type { Me } from '@/lib/me';

/**
 * Chủ thể có ĐỦ cả hai thứ: giấy tờ đính kèm lẫn ngăn két.
 *
 * Giao của hai whitelist, không phải một union viết tay thứ ba: `file.owner_type` còn nhận
 * `subnet`/`nat_rule` (những thứ không có két), nên nếu khai tay thì lần sau ai đó cho dải
 * mạng cất secret là chỗ này lặng lẽ sai. Giao thì TS tự thu hẹp lại giúp.
 */
export type OwnerWithTabs = AttachmentOwnerType & SecretOwnerType;

export interface TabCounts {
  /** `undefined` = chưa biết (đang tải, hoặc không có quyền xem). KHÔNG phải 0. */
  files: number | undefined;
  secrets: number | undefined;
}

/**
 * Số hiện bên phải nhãn tab của trang chi tiết — "Giấy tờ 3", "Két sắt 2".
 *
 * Vì sao đếm ở web chứ không để API trả về kèm hồ sơ: `vault.module` đã import `devices`,
 * `software` và `service-accounts` để tra tên chủ thể ở trang tổng két. Cho `devices` gọi
 * ngược `vault.api` để đếm là một vòng phụ thuộc, và `dependency-cruiser` chặn thẳng
 * (luật `no-circular`). Ở đây thì không có vòng nào: trình duyệt vốn được phép hỏi cả hai
 * module, và mỗi module vẫn tự gác quyền của mình.
 *
 * Được thêm một thứ không định trước: hai truy vấn này dùng CHUNG khóa cache với panel, nên
 * bấm sang tab là dữ liệu đã nằm sẵn — tab mở ra không còn quay vòng chờ nữa.
 *
 * Số `0` là một câu trả lời thật ("chưa đính giấy tờ nào") và vẫn hiện. Chỉ khi chưa biết mới
 * không hiện gì.
 */
export function useTabCounts(ownerType: OwnerWithTabs, ownerId: string, me: Me): TabCounts {
  const attachments = useOwnerAttachments(ownerType, ownerId);
  const { secrets } = useOwnerSecrets(ownerType, ownerId, me);

  return {
    files: attachments.data?.length,
    secrets: secrets.data?.length,
  };
}
