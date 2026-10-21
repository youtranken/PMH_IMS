import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BREAKPOINTS } from '@/ui/breakpoints';
import { useAnnounce } from '@/ui/live-region';
import { useMediaQuery } from '@/ui/use-media-query';

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

/**
 * Khung chờ cho một DANH SÁCH chưa có bảng nào để chèn dòng vào (màn danh sách dựng
 * `<Loading variant="table" />` trước khi có dữ liệu): vài vạch xám có vệt sáng quét, cao gần
 * bằng dòng bảng, để lúc dữ liệu về bảng hiện ra đúng chỗ thay vì đẩy cả trang.
 *
 * Trình đọc màn hình không thấy vạch nào (`aria-hidden`), chỉ nghe "Đang tải…" như trước: chữ
 * nằm ẩn thị giác trong khối và lời loan báo vẫn đi qua vùng sống chung.
 */
export function SkeletonTable({ label, rows = 6 }: { label?: string; rows?: number }) {
  const { t } = useTranslation();
  const text = label ?? t('app.loading');
  useAnnounce(text);
  const shown = useShownAfterDelay();
  // Điện thoại: danh sách thật là THẺ (DataTable mobileCard) — khung xương cũng là thẻ (ST-03).
  const narrow = useMediaQuery(BREAKPOINTS.cards);
  if (narrow) return <SkeletonCards />;
  /* Dòng vẽ NGAY để giữ chỗ (ST-03): chờ 300ms mới vẽ thì trang trống trơn rồi nhảy. Chỉ vạch xám
     hiện sau mốc đó (`data-shown`), để tải nhanh không chớp. */
  return (
    <div className="skeleton-table" aria-busy="true" data-shown={shown ? 'true' : undefined}>
      <span className="sr-only">{text}</span>
      <div aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skeleton-line">
            <span className="skeleton sk-bar sk-lead" />
            <span className="skeleton sk-bar" />
            <span className="skeleton sk-bar sk-narrow" />
          </div>
        ))}
      </div>
    </div>
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
