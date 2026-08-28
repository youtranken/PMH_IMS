import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';

/**
 * Nút "Đưa vào kho thanh lý" — MỘT khái niệm cho người dùng, bốn cái tên cho hệ thống.
 *
 * Mỗi module là chủ vòng đời hồ sơ của mình (AD-3) và gọi trạng thái "ngừng dùng" theo cách
 * riêng: thiết bị `retired`, phần mềm `retired`, đường truyền `terminated`, tài khoản dịch vụ
 * `disabled`. Không hợp nhất chúng thành một cờ chung — đó sẽ là nguồn sự thật thứ hai, và
 * hai nguồn sẽ lệch nhau đúng vào lúc có người đi đối chiếu.
 *
 * Nhưng người dùng không quan tâm bốn cái tên đó. Component này giấu chỗ khác nhau: một nhãn,
 * một câu hỏi lại, rồi gọi đúng đường của module chủ.
 *
 * KHÔNG dùng cho tài khoản dịch vụ: nó có đường riêng (`:id/disable`) BẮT ghi lý do, và lý do
 * đó là thứ sáu tháng sau người ta đi tìm. Bọc nó vào đây là làm mất phần quan trọng nhất.
 */
export function DisposeButton({
  url,
  body,
  label,
  confirmMessage,
  csrfToken,
  onDone,
  disabled,
}: {
  /** Đường của MODULE CHỦ, không phải một endpoint chung. */
  url: string;
  /** Thân request đưa hồ sơ về trạng thái ngừng dùng của chính module đó. */
  body: Record<string, unknown>;
  /** Nhãn hiện trên nút — mỗi màn giữ chữ quen thuộc của mình (Thanh lý / Cắt hợp đồng). */
  label: string;
  confirmMessage: string;
  csrfToken: string;
  onDone: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const dispose = useApiMutation<Record<string, unknown>, unknown>(url, {
    method: 'PATCH',
    csrfToken,
    refreshMe: false,
  });

  return (
    <button
      type="button"
      className="btn sm"
      disabled={disabled || dispose.isPending}
      onClick={(event) => {
        // Dòng của bảng có `onRowClick` mở trang chi tiết — không chặn thì bấm nút này cũng
        // rời trang, và hộp hỏi lại mở ra trên một màn đang chuyển.
        event.stopPropagation();
        void (async () => {
          const ok = await askConfirm({
            title: t('disposal.confirmTitle'),
            message: confirmMessage,
            confirmLabel: label,
            danger: true,
          });
          if (!ok) return;
          dispose.mutate(body, {
            onSuccess: () => {
              toast({ message: t('disposal.done') });
              onDone();
            },
            onError: (error) => toast({ message: errorMessage(error), tone: 'error' }),
          });
        })();
      }}
    >
      {label}
    </button>
  );
}
