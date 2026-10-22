import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { ISO_KEY, useIncident } from './iso-api';
import { IncidentDialog } from './incident-dialog';
import { IncidentPaper, STATUS_LABEL } from './iso-paper';
import { monthKey, monthLabel, shortDay } from './iso-rules';
import { INCIDENT_STATUS_TONE, type Incident } from './iso-types';

/**
 * Trang một phiếu 0206: bản phiếu đúng mẫu, ô ✗ đã gắn, bản ký. Lập và sửa đều đi qua
 * `IncidentDialog` (cùng hộp mở từ lưới 0203 / 0208); link sâu `/iso/incidents/new?cell=…` cũ
 * chuyển về danh sách sự cố và mở hộp lập phiếu ở đó.
 */
export function IncidentScreen({ me }: { me: Me }) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const isNew = !id || id === 'new';
  const incident = useIncident(isNew ? null : id);
  if (isNew) {
    const cell = params.get('cell');
    return <Navigate to={`${PATHS.isoIncidents}?new=1${cell ? `&cell=${encodeURIComponent(cell)}` : ''}`} replace />;
  }
  if (incident.isLoading) return <Loading />;
  if (incident.isError || !incident.data) return <LoadError error={incident.error} onRetry={() => void incident.refetch()} />;
  return <IncidentView me={me} incident={incident.data} />;
}

/**
 * Phiếu đã khoá theo kỳ: in, tải bản ký riêng của phiếu. Kỳ đang Chờ duyệt: chỉ xem (bản ký nhận
 * sau khi kỳ được duyệt chốt). Còn lại người có quyền sửa được tới khi kỳ chốt (Q-28).
 */
function IncidentView({ me, incident }: { me: Me; incident: Incident }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const readOnly = incident.locked || incident.inReview;
  const canEdit = !readOnly && incident.canWrite === true;
  const period = monthLabel(incident.year, incident.month);
  return (
    <>
      <div className="no-print">
        <PageHeader
          title={t('iso.incident.viewTitle', { code: incident.code })}
          /* Phụ đề một ý (PW-B11): sửa được hay không là việc của băng ngay dưới — nói ở cả hai
             chỗ thì lặp, và câu "sửa được" sai với người không phụ trách. */
          subtitle={t('iso.incident.belongsTo', { period })}
          actions={
            <>
              <Link to={PATHS.isoIncidents}>{t('iso.incident.backToList')}</Link>
              <button type="button" className="btn" onClick={() => window.print()}>
                {t('iso.print')}
              </button>
              {canEdit ? (
                <button type="button" className="btn primary" onClick={() => setEditing(true)}>
                  {t('iso.incident.edit')}
                </button>
              ) : null}
            </>
          }
        />
        <p className="alert info">
          <span className={`badge ${INCIDENT_STATUS_TONE[incident.status]}`}>{STATUS_LABEL[incident.status]}</span>{' '}
          {readOnly
            ? t(incident.inReview ? 'iso.incident.reviewShort' : 'iso.incident.lockedShort')
            : incident.canWrite === false
              ? t('iso.incident.noWriteHint')
              : t(incident.status === 'in_progress' ? 'iso.incident.inProgressNote' : 'iso.incident.editableNote')}{' '}
          <Link to={PATHS.isoPeriod(incident.governing[0], monthKey(incident.year, incident.month))}>{t('iso.openPeriods')}</Link>
        </p>
      </div>
      <div className="sheet-split">
        <IncidentPaper incident={incident} />
        <aside className="no-print">
          <section className="card" aria-labelledby="iso-inc-cells">
            <h2 id="iso-inc-cells">{t('iso.incident.cellsTitle')}</h2>
            {incident.cells.length === 0 ? (
              <p className="muted small">{t('iso.incident.noCells')}</p>
            ) : (
              <ul className="sheet-checks">
                {incident.cells.map((c) => (
                  <li key={c.form === '0203' ? `${c.lineId}:${c.day}` : c.issueId}>
                    <span className="sheet-mark" data-state="fail-linked" aria-hidden="true">
                      ✗
                    </span>
                    <span>
                      <Link to={c.form === '0203' ? PATHS.isoBackupAt(c.day.slice(0, 7)) : PATHS.isoAntivirusAt(c.day.slice(0, 7))}>{c.label}</Link>
                      <span className="cell-sub">
                        {c.form} · {shortDay(c.day)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">{t('iso.incident.createdAt', { at: formatDateTime(incident.createdAt) })}</p>
          </section>
          {readOnly ? (
            <section className="card" aria-labelledby="iso-inc-signed">
              <h2 id="iso-inc-signed">{t('iso.signedTitle')}</h2>
              <p className="muted small">{incident.signedCurrent ? t('iso.signedHas') : t('iso.signedMissing')}</p>
              <AttachmentPanel
                ownerType="iso_incident"
                ownerId={incident.id}
                csrfToken={me.csrfToken}
                canEdit={incident.canWrite === true && incident.locked}
                accept=".pdf,.jpg,.jpeg,.png"
                staleBefore={incident.contentUpdatedAt}
                onChanged={() => void queryClient.invalidateQueries({ queryKey: ISO_KEY })}
              />
            </section>
          ) : null}
        </aside>
      </div>
      {editing ? <IncidentDialog me={me} incidentId={incident.id} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} /> : null}
    </>
  );
}
