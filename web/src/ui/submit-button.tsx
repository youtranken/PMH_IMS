import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motionReduced } from '@/lib/motion';
import { CheckIcon } from '@/ui/glyph-icons';

/** Dấu tích giữ trên nút sau khi lưu xong (Q-21) — một nhịp để mắt kịp thấy rồi trả lại chữ. */
export const SAVE_DONE_MS = 700;

/**
 * `true` trong `ms` kể từ lúc `busy` vừa tắt mà lượt ghi thành công.
 *
 * Bắt cạnh xuống của `busy` NGAY TRONG LƯỢT RENDER (không chờ effect): hộp thoại đóng ngay sau
 * khi lưu, và lượt render cuối trước lúc hộp mờ đi là lượt duy nhất còn kịp vẽ dấu tích.
 */
export function useSuccessFlash(busy: boolean, succeeded: boolean, ms: number = SAVE_DONE_MS): boolean {
  const [wasBusy, setWasBusy] = useState(busy);
  const [flash, setFlash] = useState(0);
  if (busy !== wasBusy) {
    setWasBusy(busy);
    if (wasBusy && !busy && succeeded && !motionReduced()) setFlash((n) => n + 1);
  }
  const [shownFor, setShownFor] = useState(0);
  useEffect(() => {
    if (flash === 0) return;
    const timer = window.setTimeout(() => setShownFor(flash), ms);
    return () => window.clearTimeout(timer);
  }, [flash, ms]);
  // Bấm lại giữa nhịp thì nhịp cũ kết thúc ngay — dấu tích không được đè chữ "Đang lưu…".
  return flash > shownFor && !busy;
}

/**
 * Nút chính "Lưu" của hộp thoại / form (AD-15): một chỗ cho ba trạng thái mà 15 nơi gọi đang tự
 * viết lại — chữ thường, "Đang lưu…" khi lượt ghi đang bay, và dấu tích ngắn khi lưu xong.
 *
 * Chữ của nút KHÔNG đổi lúc hiện dấu tích (chỉ mờ đi bằng CSS): tên nút với trình đọc màn hình
 * và với bài kiểm vẫn là "Lưu"; thông báo "đã lưu" thật vẫn là việc của toast.
 */
export function SubmitButton({
  busy,
  succeeded,
  form,
  type = 'submit',
  className = 'btn primary',
  disabled,
  onClick,
  children,
  busyLabel,
}: {
  busy: boolean;
  /** Lượt ghi vừa xong có thành công không (vd `save.isSuccess`). Không truyền = không có dấu tích. */
  succeeded?: boolean;
  form?: string;
  type?: 'submit' | 'button';
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  /** Chữ thường của nút; mặc định "Lưu". */
  children?: ReactNode;
  /** Chữ khi đang ghi; mặc định "Đang lưu…". */
  busyLabel?: string;
}) {
  const { t } = useTranslation();
  const done = useSuccessFlash(busy, Boolean(succeeded));
  return (
    <button
      type={type}
      form={form}
      className={`${className} submit-btn`}
      disabled={busy || disabled}
      onClick={onClick}
      data-done={done ? 'true' : undefined}
    >
      <span className="submit-label">{busy ? (busyLabel ?? t('common.saving')) : (children ?? t('common.save'))}</span>
      {done ? (
        <span className="submit-check" aria-hidden="true">
          <CheckIcon />
        </span>
      ) : null}
    </button>
  );
}
