import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { usePendingDiagramReviews, type PendingDiagramReview } from '@/shell/use-pending-diagram-reviews';

/**
 * Bản vẽ đang chờ người này duyệt (D-07), đứng đầu màn Sơ đồ mạng — nơi badge nav dẫn tới
 * (UX-E07). Duyệt đi trên chính màn bản vẽ ("Duyệt…"), nên khối này chỉ là lối vào: tên, phiên
 * bản, ai gửi, lúc nào. Không có gì chờ thì không bày khối.
 */
export function DiagramReviewQueue({ me }: { me: Me }) {
  const { t } = useTranslation();
  const { rows } = usePendingDiagramReviews(me);
  if (rows.length === 0) return null;
  return (
    <section className="card diagram-review-queue">
      <h2>{t('diagrams.reviewQueue.title', { count: rows.length })}</h2>
      <p className="muted">{t('diagrams.reviewQueue.hint')}</p>
      <ul className="diagram-review-queue-list">
        {rows.map((row: PendingDiagramReview) => (
          <li key={row.approvalId}>
            <Link to={PATHS.diagram(row.diagramId)} aria-label={t('diagrams.reviewQueue.open', { name: row.name })}>
              {row.name}
            </Link>
            {row.seq !== null ? <span className="badge warn">{t('diagrams.reviewQueue.version', { seq: row.seq })}</span> : null}
            <span className="muted">
              {t('diagrams.reviewQueue.sentBy', { name: row.requesterName, at: formatDateTime(row.submittedAt) })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
