import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { agoParts, formatDateTime } from '@/lib/format';
import { PATHS } from '@/lib/routes';
import { RowActions, type RowAction } from '@/ui/row-actions';
import { NODE_TYPE_KEY, statusLabel, type DiagramNode, type DiagramStatus } from './diagram-api';
import { newerOfficialSeq } from './diagram-presentation';

export const STATUS_TONE: Record<DiagramStatus, string> = {
  empty: 'badge muted',
  draft: 'badge warn',
  official: 'badge ok',
  official_draft: 'badge info',
  pending: 'badge brand',
};

/**
 * Thẻ một bản vẽ trên màn cây (Q-23): tên, loại, trạng thái, lần lưu cuối — KHÔNG ảnh thu nhỏ, vì
 * xem cây không cần mã còn ảnh là nội dung bản vẽ. Tên là link mở (cùng đích nút "Mở"); "Sửa"
 * mở thẳng chế độ sửa, ẩn khi màn hẹp (sửa chỉ làm trên máy tính).
 */
export function DiagramCard({
  node,
  self,
  now,
  canEdit,
  items,
}: {
  node: DiagramNode;
  /** Thẻ "Bản vẽ này" — bản vẽ đang chọn trên cây, đứng đầu danh sách. */
  self?: boolean;
  now: number;
  canEdit: boolean;
  items: RowAction[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const latest = node.latestVersion;
  const ago = latest ? agoParts(latest.savedAt, now) : null;
  const newer = node.kind === 'presentation' ? newerOfficialSeq(node.source) : null;
  const titleId = `diagram-card-${node.id}`;
  return (
    <li className="board-card" aria-labelledby={titleId} data-self={self ? 'true' : undefined}>
      <div className="board-card-head">
        <div className="board-card-title">
          {self ? <span className="board-card-kicker">{t('diagrams.board.thisDiagram')}</span> : null}
          <h3 id={titleId}>
            <Link to={PATHS.diagram(node.id)}>{node.name}</Link>
          </h3>
        </div>
        <RowActions label={t('diagrams.actionsOf', { name: node.name })} items={items} />
      </div>
      <div className="board-card-badges">
        {node.kind === 'presentation' ? (
          <span className="badge brand">{t('diagrams.presentation.badge')}</span>
        ) : (
          <span className="badge outline">{t(NODE_TYPE_KEY[node.nodeType])}</span>
        )}
        {node.kind === 'presentation' ? null : <span className={STATUS_TONE[node.status]}>{statusLabel(node, t)}</span>}
        {node.driftCount ? <span className="badge warn">{t('diagrams.drift.treeBadge', { count: node.driftCount })}</span> : null}
        {newer ? <span className="badge warn">{t('diagrams.presentation.newer', { seq: newer })}</span> : null}
      </div>
      {node.kind === 'presentation' ? (
        <p className="board-card-meta">
          {node.source?.name && node.source.seq
            ? t('diagrams.presentation.fromSource', { name: node.source.name, seq: node.source.seq })
            : t('diagrams.presentation.fromSourceGone')}
        </p>
      ) : null}
      {latest ? (
        <p className="board-card-meta">
          {t('diagrams.board.version', { seq: latest.seq, by: latest.savedByName ?? latest.savedBy })}
          {ago ? (
            <>
              {' · '}
              <time dateTime={latest.savedAt} title={formatDateTime(latest.savedAt)}>
                {ago.unit === 'days' && ago.count > 30 ? formatDateTime(latest.savedAt) : t(`diagrams.board.ago_${ago.unit}`, { count: ago.count })}
              </time>
            </>
          ) : null}
        </p>
      ) : (
        <p className="board-card-meta">{t('diagrams.board.never')}</p>
      )}
      <div className="board-card-actions">
        <button type="button" className="btn sm" aria-label={t('diagrams.board.openOf', { name: node.name })} onClick={() => navigate(PATHS.diagram(node.id))}>
          {t('diagrams.board.open')}
        </button>
        {canEdit ? (
          <button
            type="button"
            className="btn sm ghost"
            aria-label={t('diagrams.board.editOf', { name: node.name })}
            onClick={() => navigate(`${PATHS.diagram(node.id)}?mode=edit`)}
          >
            {t('diagrams.board.edit')}
          </button>
        ) : null}
      </div>
    </li>
  );
}
