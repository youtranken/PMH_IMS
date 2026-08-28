import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Chép một chuỗi ngắn (mã hồ sơ, serial, IP) vào clipboard.
 *
 * Vì sao đáng có: serial là thứ người ta ĐỌC QUA ĐIỆN THOẠI cho nhà cung cấp lúc gọi bảo
 * hành, và mã hồ sơ là thứ dán vào biên bản. Bôi đen một chuỗi `mono` giữa một khối chữ là
 * thao tác dễ trượt, nhất là trên màn hình cảm ứng.
 *
 * KHÔNG dùng cho giá trị secret: két sắt cố ý không có nút chép (clipboard sống qua cả phiên
 * đăng nhập, dán nhầm vào ô chat là mất luôn) — xem chú thích ở `reveal-dialog.tsx`.
 */
export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);

  // Trả nhãn về "Sao chép" sau 1,5 giây. Dọn timer khi component biến mất, không thì
  // `setState` chạy trên một component đã tháo và React cảnh báo.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);

  return (
    <button
      type="button"
      className="copy-btn"
      aria-label={label ?? t('common.copy')}
      title={done ? t('common.copied') : (label ?? t('common.copy'))}
      onClick={() => {
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
          } catch {
            /*
             * Clipboard bị trình duyệt từ chối (không phải HTTPS, người dùng chặn quyền) thì
             * IM LẶNG bỏ qua: đây là tiện ích phụ, giá trị vẫn nằm ngay đó để bôi đen. Bắn
             * một toast lỗi cho một thứ không ai yêu cầu là làm phiền.
             */
          }
        })();
      }}
    >
      {done ? '✓' : '⧉'}
    </button>
  );
}
