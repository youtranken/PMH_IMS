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
 * Số `0` là một câu trả lời thật ("chưa đính giấy tờ nào"), KHÁC hẳn `undefined` ("chưa đọc
 * được"), và hook này giữ nguyên phân biệt ấy cho phía gọi.
 *
 * NHƯNG THANH TAB KHÔNG VẼ SỐ 0 (sửa chú thích 19/09/2026). Từ `_SPEC.md:61`/`:529`, `ui/tabs.tsx`
 * đổi sang phép thử truthy: `0` và `undefined` đều không vẽ huy hiệu. Bản trước của khối này
 * khẳng định ngược lại — "số 0 … vẫn hiện" — tức file ĐỊNH NGHĨA HỢP ĐỒNG nói sai về nơi hợp
 * đồng ấy được dùng, và người viết màn thứ tám sẽ mất một lượt gỡ lỗi để phát hiện luật thật
 * nằm ở file khác.
 *
 * Phân biệt `0` với `undefined` vẫn có ích, chỉ là không phải ở thanh tab: bản đồ quan hệ và
 * dòng "Chưa gắn:" đọc đúng hai giá trị đó để không nói "chưa giữ gì" khi thật ra chưa biết.
 */
export function useTabCounts(ownerType: OwnerWithTabs, ownerId: string, me: Me): TabCounts {
  const attachments = useOwnerAttachments(ownerType, ownerId);
  const { secrets } = useOwnerSecrets(ownerType, ownerId, me);

  return {
    files: attachments.data?.length,
    secrets: secrets.data?.length,
  };
}
