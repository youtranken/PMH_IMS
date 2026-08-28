import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';

/**
 * "Đưa vào kho thanh lý" — MỘT khái niệm cho người dùng, bốn cái tên cho hệ thống.
 *
 * Mỗi module là chủ vòng đời hồ sơ của mình (AD-3) và gọi trạng thái "ngừng dùng" theo cách
 * riêng: thiết bị `retired`, phần mềm `retired`, đường truyền `terminated`, tài khoản dịch vụ
 * `disabled`. Không hợp nhất chúng thành một cờ chung — đó sẽ là nguồn sự thật thứ hai, và
 * hai nguồn sẽ lệch nhau đúng vào lúc có người đi đối chiếu.
 *
 * Nhưng người dùng không quan tâm bốn cái tên đó. Chỗ này giấu chỗ khác nhau: một nhãn, một
 * câu hỏi lại, rồi gọi đúng đường của module chủ.
 *
 * KHÔNG dùng cho tài khoản dịch vụ: nó có đường riêng (`:id/disable`) BẮT ghi lý do, và lý do
 * đó là thứ sáu tháng sau người ta đi tìm. Bọc nó vào đây là làm mất phần quan trọng nhất.
 */
export interface DisposeOptions {
  /** Đường của MODULE CHỦ, không phải một endpoint chung. */
  url: string;
  /** Thân request đưa hồ sơ về trạng thái ngừng dùng của chính module đó. */
  body: Record<string, unknown>;
  /** Nhãn hiện trên nút xác nhận — mỗi màn giữ chữ quen thuộc của mình. */
  label: string;
  confirmMessage: string;
  csrfToken: string;
  onDone: () => void;
}

/**
 * Bản HOOK của cùng việc đó — dành cho chỗ không vẽ được một cái nút.
 *
 * Sinh ra khi cột thao tác đổi sang menu ba chấm (28/08/2026): mục trong menu là một dòng dữ
 * liệu `{ label, onSelect }`, không phải một component. Tách hook ra thay vì chép logic hỏi
 * lại + gọi API sang màn phần mềm — AD-15 cấm bản thứ hai, và hai bản sẽ trôi khác nhau đúng
 * lúc câu hỏi xác nhận đổi.
 */
export function useDispose({
  url,
  body,
  label,
  confirmMessage,
  csrfToken,
  onDone,
}: DisposeOptions): { run: () => void; isPending: boolean } {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const dispose = useApiMutation<Record<string, unknown>, unknown>(url, {
    method: 'PATCH',
    csrfToken,
    refreshMe: false,
  });

  const run = () => {
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
  };

  return { run, isPending: dispose.isPending };
}

/** Nút rời — dùng ở trang CHI TIẾT, nơi thanh thao tác vẫn là dãy nút phẳng. */
export function DisposeButton({
  disabled,
  ...options
}: DisposeOptions & { disabled?: boolean }) {
  const { run, isPending } = useDispose(options);

  return (
    <button
      type="button"
      /* Đỏ (28/08/2026): đưa vào kho thanh lý là dừng tính hạn, cắt khỏi email nhắc gia hạn
         và khóa hồ sơ lại. Nó đứng cạnh "Sửa" và "Gia hạn" — cùng một sắc xám thì ba việc
         trông ngang nhau, trong khi chỉ một cái lấy đi thứ gì đó. */
      className="btn sm danger"
      disabled={disabled || isPending}
      onClick={(event) => {
        // Dòng của bảng có `onRowClick` mở trang chi tiết — không chặn thì bấm nút này cũng
        // rời trang, và hộp hỏi lại mở ra trên một màn đang chuyển.
        event.stopPropagation();
        run();
      }}
    >
      {options.label}
    </button>
  );
}
