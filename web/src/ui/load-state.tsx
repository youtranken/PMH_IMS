import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { describeLoadError } from '@/lib/load-error-text';

/**
 * Hợp đồng loading/empty/error dùng chung (review nguyên tắc #8): mọi màn fetch phải PHÂN BIỆT
 * "đang tải" ≠ "rỗng" ≠ "lỗi". Trước đây nhiều màn nuốt lỗi thành 0 hoặc kẹt "…" vô hạn (P0).
 * (fetchJson tách sang ./fetch-json để file này chỉ export component — fast-refresh.)
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

/** Màn 404 khi vào route không tồn tại (thay cho redirect câm về "/"). */
export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="error-state">
      <div className="error-code">404</div>
      <h1>{t('app.notFoundTitle', 'Không tìm thấy trang')}</h1>
      <p className="muted">
        {t('app.notFoundHint', 'Trang bạn tìm không tồn tại hoặc đã được chuyển.')}
      </p>
      <Link to="/">
        <button type="button" className="primary">
          {t('app.backHome', 'Về trang chủ')}
        </button>
      </Link>
    </div>
  );
}

/** Khối "đang tải" dùng chung — phân biệt với rỗng/lỗi (S1). role=status + aria-busy cho SR. */
export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="load-state" role="status" aria-busy="true">
      <span className="spinner" aria-hidden="true" />
      <span className="muted">{label ?? t('app.loading', 'Đang tải…')}</span>
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
