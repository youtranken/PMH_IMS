import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { describeLoadError } from '@/lib/load-error-text';
import { useAnnounce } from '@/ui/live-region';

/**
 * Hợp đồng loading/empty/error dùng chung (review nguyên tắc #8): mọi màn fetch phải PHÂN BIỆT
 * "đang tải" ≠ "rỗng" ≠ "lỗi". Trước đây nhiều màn nuốt lỗi thành 0 hoặc kẹt "…" vô hạn (P0).
 * (Lượt gọi mạng đi qua `lib/api-client.ts`; file này chỉ export component — fast-refresh.)
 */

/**
 * Empty-state dùng chung: icon + tiêu đề + gợi ý + (tùy) nút hành động. Thay cho
 * `<p className="empty">` khi muốn hướng người dùng bước tiếp (giảm cảm giác "trống trơn").
 */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span>{title}</span>
      {hint && <span className="empty-hint">{hint}</span>}
      {action && <span className="empty-action">{action}</span>}
    </div>
  );
}

/**
 * Khối hiện thay cho một màn vừa ném lỗi lúc render (`ErrorBoundary`). Không dùng router: nó
 * còn được đặt ở gốc app, ngoài `BrowserRouter`.
 */
export function ScreenError() {
  const { t } = useTranslation();
  return (
    <div className="error-state" role="alert">
      <h1>{t('app.screenErrorTitle')}</h1>
      <p className="muted">{t('app.screenErrorHint')}</p>
      <div className="detail-actions">
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          {t('app.reload')}
        </button>
        <button type="button" onClick={() => window.location.assign('/')}>
          {t('app.backHome')}
        </button>
      </div>
    </div>
  );
}

/**
 * Màn 404 khi vào route không tồn tại (thay cho redirect câm về "/").
 *
 * Trang chi tiết truyền `title`/`hint`/`action` riêng: link cũ của một thiết bị đã xoá mà nhận
 * câu về "phần chưa mở trong bản này" là sai ngữ cảnh, và lối ra đúng là về danh sách của nó.
 */
export function NotFound({
  title,
  hint,
  action,
}: {
  title?: string;
  hint?: string;
  action?: React.ReactNode;
} = {}) {
  const { t } = useTranslation();
  return (
    <div className="error-state">
      <div className="error-code">404</div>
      <h1>{title ?? t('app.notFoundTitle')}</h1>
      <p className="muted">{hint ?? t('app.notFoundHint')}</p>
      {action ?? (
        <Link to="/">
          <button type="button" className="primary">
            {t('app.backHome')}
          </button>
        </Link>
      )}
    </div>
  );
}

/**
 * Khối "đang tải" dùng chung — phân biệt với rỗng/lỗi (S1).
 *
 * ===== `role="status"` ĐÃ GỠ KHỎI NODE NÀY (23/09, F-06) =====
 *
 * Nó từng nằm ngay đây, và vì thế KHÔNG BAO GIỜ được đọc lên: node và nội dung của nó sinh ra
 * cùng một lượt, mà trình đọc màn hình chỉ theo dõi những vùng sống đã có mặt TRƯỚC đó. 39 chỗ
 * "đang tải" trên toàn web đều câm — người dùng bấm một nút, nội dung biến mất, và không nghe
 * thấy gì cho tới khi dữ liệu về.
 *
 * Cùng lỗi này đã được nhận ra và vá hai lần ở chỗ khác (`relation-map`, rồi `command-palette`),
 * cả hai lần đều vá TẠI CHỖ; bản dùng chung thì không ai vá. Nay lời loan báo đi qua
 * `useAnnounce` tới một vùng sống thường trực gắn ở shell (`ui/live-region.tsx`).
 *
 * `aria-busy` GIỮ LẠI trên node này: nó nói về chính vùng đang bận, không phải một lời loan báo.
 */
export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation();
  const text = label ?? t('app.loading');
  useAnnounce(text);
  return (
    <div className="load-state" aria-busy="true">
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{text}</span>
    </div>
  );
}

/**
 * Khối "không tải được + Thử lại" dùng chung khi một màn fetch thất bại.
 *
 * `error` là BẮT BUỘC, cố ý. Nó vốn là prop tùy chọn trong đầu — và tùy chọn nghĩa là 38 chỗ
 * gọi sẽ cứ thế bỏ qua, y như chúng đã bỏ qua suốt từ đầu dự án. Bắt buộc thì mỗi chỗ gọi mới
 * là một lỗi biên dịch cho tới khi có người nối cái lỗi thật vào. Truyền `undefined` vẫn được
 * (nhánh hỏng tự dựng, bài kiểm) nhưng phải VIẾT RA, tức là một quyết định chứ không phải
 * một chỗ quên.
 *
 * Bảng nguyên nhân → câu chữ nằm ở `lib/load-error-text.ts` (hàm thuần, có bài kiểm riêng).
 *
 * `role="alert"`: khối này thay chỗ nội dung vừa biến mất, nên trình đọc màn hình phải nghe
 * được ngay — chờ người dùng tự tab tới thì họ chỉ nghe thấy một trang trống.
 */
export function LoadError({ onRetry, error }: { onRetry: () => void; error: unknown }) {
  const { t } = useTranslation();
  const described = describeLoadError(error);
  return (
    <div className="load-error" role="alert" style={{ padding: '1rem 0' }}>
      <p style={{ color: 'var(--danger)', marginBottom: '.5rem' }}>
        {described.text ?? t(described.key)}
      </p>
      <button type="button" className="primary sm" onClick={onRetry}>
        {t('app.retry')}
      </button>
    </div>
  );
}
