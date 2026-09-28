import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnnounce } from '@/ui/live-region';

/** Tải nhanh hơn mốc này thì không vẽ khung xương — tránh chớp một nhịp rồi biến mất. */
const SHOW_AFTER_MS = 300;

function useShownAfterDelay(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return shown;
}

/**
 * Khung xương cho bảng đang tải (AD-15) — các dòng xám đúng chiều cao dòng bảng thay cho một
 * vòng xoay nhỏ giữa khoảng trống: dữ liệu về thì bảng "đầy lên" tại chỗ thay vì nhảy cả trang.
 *
 * Chữ "Đang tải…" vẫn còn (ẩn thị giác) và vẫn được loan báo qua vùng sống chung, nên trình đọc
 * màn hình và bài kiểm tìm theo chữ không mất gì.
 */
export function SkeletonRows({ columns, rows = 6 }: { columns: number; rows?: number }) {
  const { t } = useTranslation();
  const text = t('app.loading');
  useAnnounce(text);
  const shown = useShownAfterDelay();
  return (
    <>
      <tr className="skeleton-label">
        <td colSpan={columns}>
          <span className="sr-only">{text}</span>
        </td>
      </tr>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="skeleton-row" aria-hidden="true">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c}>{shown ? <span className="skeleton sk-bar" /> : null}</td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Bản thẻ cho danh sách ≤600px (`DataTable mobileCard`). */
export function SkeletonCards({ count = 3 }: { count?: number }) {
  const { t } = useTranslation();
  const text = t('app.loading');
  useAnnounce(text);
  const shown = useShownAfterDelay();
  return (
    <div className="skeleton-cards" aria-busy="true">
      <span className="sr-only">{text}</span>
      {shown
        ? Array.from({ length: count }, (_, i) => (
            <div key={i} className="skeleton-card" aria-hidden="true">
              <span className="skeleton sk-bar sk-wide" />
              <span className="skeleton sk-bar sk-narrow" />
            </div>
          ))
        : null}
    </div>
  );
}
