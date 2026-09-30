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
 *
 * Ngoại lệ duy nhất: khoá cài 2 lớp ở `features/auth/totp-setup.tsx`. Trên điện thoại, chép rồi
 * dán vào ứng dụng xác thực là CÁCH cài đặt (không quét được QR trên chính màn hình mình), và
 * khoá đó đang hiện nguyên văn ngay cạnh nút — chép không lộ thêm gì. Cùng lý do cho ngăn két
 * "Mã 2 lớp" (`TotpBody` trong `reveal-dialog.tsx`): chép khoá để cài trên chính điện thoại đang
 * mở két, và chép mã 6 số vốn tự hết hạn sau một chu kỳ.
 */
export function CopyButton({
  value,
  label,
  inline = false,
}: {
  value: string;
  label?: string;
  /**
   * Nút nhỏ canh theo dòng chữ (dòng phụ trong ô bảng, dòng định danh dưới tiêu đề): nút vuông
   * 24px mặc định nhô xuống dưới đường chân chữ và làm dòng cao lên.
   */
  inline?: boolean;
}) {
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
      className={inline ? 'copy-btn inline' : 'copy-btn'}
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
