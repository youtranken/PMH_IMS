import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { OWNER_PATH, PATHS } from '@/lib/routes';
import {
  BREAK_GLASS_KEY,
  BreakGlassStateBadge,
  BreakGlassSubject,
  DecisionDialog,
  isStepUpCancelled,
  useBreakGlassActions,
  type BreakGlassRow,
} from '@/ui/break-glass';
import { useConfirm } from '@/ui/confirm-provider';
import { LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { StickyActionBar } from '@/ui/sticky-action-bar';
import { useToast } from '@/ui/toast';

/** Nấc giờ gợi ý — người duyệt chỉ RÚT NGẮN được so với số xin, không cấp thêm. */
const HOUR_STEPS = [1, 2, 4, 8, 24];

/** Nút "Duyệt" phải chạm lần hai trong khoảng này mới cấp — sau đó tự trở về. */
const CONFIRM_WINDOW_MS = 3_000;

/** Các nấc ≤ số xin, luôn có đúng số xin ở cuối. Không rõ số xin thì chỉ đưa các nấc ngắn. */
function hourChoices(asked: number | undefined): number[] {
  if (!asked || asked <= 0) return [1, 2, 4];
  return [...new Set([...HOUR_STEPS.filter((h) => h < asked), asked])];
}

/**
 * Trang chi tiết MỘT phiếu break-glass — đích của nút "Xem và duyệt" trong thư.
 *
 * Mục tiêu là quyết trên điện thoại mà không cuộn, không tìm: người xin, đối tượng, lý do, thời
 * hạn, rồi thanh quyết định dính đáy. Phiếu đã có người xử lý thì hiện trạng thái cuối thay vì
 * nút; phiếu của chính mình thì chỉ rút được (bốn mắt — FR-023).
 */
export function ApprovalDetailScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const actions = useBreakGlassActions(me.csrfToken);
  const canDecide = me.role === 'sa' || me.role === 'admin';
  const [hours, setHours] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [denying, setDenying] = useState(false);

  const detail = useQuery({
    queryKey: [...BREAK_GLASS_KEY, 'detail', id],
    queryFn: () => apiFetch<BreakGlassRow>(`/api/v1/vault/break-glass/${id}`),
    retry: false,
  });

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (detail.isLoading) return <Loading />;
  if (detail.isError) {
    return <LoadError error={detail.error} onRetry={() => void detail.refetch()} />;
  }
  if (!detail.data) return <Loading />;
  const row = detail.data;

  const own = row.requester.toLowerCase() === me.email.toLowerCase();
  const pending = row.state === 'pending';
  const decidable = pending && canDecide && !own;
  const asked = row.payload?.hours;
  const choices = hourChoices(asked);
  const granted = hours ?? choices[choices.length - 1];

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast({ message: t(done) });
      void actions.refresh();
    } catch (error) {
      if (!isStepUpCancelled(error)) toast({ message: errorMessage(error), tone: 'error' });
    } finally {
      setBusy(false);
      setArmed(false);
    }
  };

  const onApprove = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    void run(
      () => actions.approve(row.id, { hours: granted, note: note.trim() }),
      'approvals.approved',
    );
  };

  const onCancel = async () => {
    const ok = await askConfirm({
      title: t('common.titleOf', {
        action: t('approvals.cancel'),
        subject: row.subjectLabel ?? t('approvals.subjectGone'),
      }),
      message: t('approvals.confirmCancel'),
      danger: true,
      confirmLabel: t('approvals.cancel'),
    });
    if (ok) await run(() => actions.cancel(row.id), 'approvals.cancelled');
  };

  const onRevoke = async () => {
    const ok = await askConfirm({
      title: t('common.titleOf', { action: t('approvals.revoke'), subject: row.requester }),
      message: t('approvals.confirmRevoke', { member: row.requester }),
      danger: true,
      confirmLabel: t('approvals.revoke'),
    });
    if (ok) await run(() => actions.revoke(row.id), 'approvals.revoked');
  };

  const who = row.decidedBy ?? '—';
  const at = formatDateTime(row.decidedAt);
  const finalText =
    row.state === 'approved' && row.active
      ? t('approvals.grantedTo', { member: row.requesterName, until: formatDateTime(row.expiresAt) })
      : row.state === 'approved' || row.state === 'expired'
        ? t('approvals.finalExpired')
        : row.state === 'denied'
          ? t('approvals.finalDenied', { who, at })
          : row.state === 'revoked'
            ? t('approvals.finalRevoked', { who })
            : row.state === 'cancelled'
              ? t('approvals.finalCancelled')
              : null;

  return (
    <div className="approval-detail">
      <Link to={PATHS.approvals}>{t('approvals.backToList')}</Link>
      <PageHeader
        title={t('approvals.detailTitle')}
        subtitle={t('approvals.sentAt', { at: formatDateTime(row.createdAt) })}
        actions={<BreakGlassStateBadge row={row} />}
      />

      <section className="card" aria-label={t('approvals.requesterBlock')}>
        <p className="approval-detail-label">{t('approvals.requesterBlock')}</p>
        <strong>{row.requesterName}</strong>
        {row.requesterName !== row.requester ? (
          <span className="muted"> · {row.requester}</span>
        ) : null}
      </section>

      <section className="card" aria-label={t('approvals.subject')}>
        <p className="approval-detail-label">{t('approvals.subject')}</p>
        <BreakGlassSubject row={row} />
      </section>

      <section className="card" aria-label={t('approvals.reasonBlock')}>
        <p className="approval-detail-label">{t('approvals.reasonBlock')}</p>
        <blockquote className="approval-reason">{row.reason}</blockquote>
      </section>

      {decidable ? (
        <section className="card" aria-label={t('approvals.durationBlock')}>
          <p className="approval-detail-label">{t('approvals.durationBlock')}</p>
          <div className="segmented" role="group" aria-label={t('approvals.durationBlock')}>
            {choices.map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={h === granted}
                onClick={() => {
                  setHours(h);
                  setArmed(false);
                }}
              >
                {h === asked ? t('approvals.durationAsked', { hours: h }) : t('approvals.hours', { hours: h })}
              </button>
            ))}
          </div>
          {/* Chỉ để người duyệt hình dung — hạn thật do server đặt lúc duyệt (AD-6). */}
          <p className="muted">
            {t('approvals.endsAt', {
              at: formatDateTime(new Date(Date.now() + granted * 3_600_000)),
            })}
          </p>
          <Field label={t('approvals.approveNoteLabel')}>
            <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </section>
      ) : null}

      {finalText ? (
        <p className={row.state === 'approved' && row.active ? 'alert ok' : 'alert'} role="status">
          {finalText}
          {row.state === 'approved' && row.decidedBy ? (
            <>
              {' '}
              {t('approvals.finalApproved', { who, at })}
            </>
          ) : null}
          {row.decisionNote ? (
            <>
              <br />
              {row.decisionNote}
            </>
          ) : null}
        </p>
      ) : null}

      {decidable ? (
        <StickyActionBar label={t('approvals.decisionBar')}>
          <button
            type="button"
            className="btn danger-ghost"
            disabled={busy}
            onClick={() => setDenying(true)}
          >
            {t('approvals.deny')}
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={onApprove}>
            {busy
              ? t('common.loading')
              : armed
                ? t('approvals.approveConfirm', { hours: granted })
                : t('approvals.approveHours', { hours: granted })}
          </button>
        </StickyActionBar>
      ) : pending && own ? (
        <StickyActionBar
          label={t('approvals.decisionBar')}
          note={
            <>
              <strong>{t('approvals.ownRequest')}</strong> · {t('approvals.ownRequestHint')}
            </>
          }
        >
          <button
            type="button"
            className="btn danger-ghost"
            disabled={busy}
            onClick={() => void onCancel()}
          >
            {t('approvals.cancel')}
          </button>
        </StickyActionBar>
      ) : row.state === 'approved' && row.active && (canDecide || own) ? (
        <StickyActionBar label={t('approvals.decisionBar')}>
          {canDecide && !own ? (
            <button
              type="button"
              className="btn danger-ghost"
              disabled={busy}
              onClick={() => void onRevoke()}
            >
              {t('approvals.revoke')}
            </button>
          ) : null}
          {own && row.subjectLabel ? (
            /* Nút chứ không phải link trần: trong thanh đáy nó phải to 48px như nút cạnh nó. */
            <button
              type="button"
              className="btn primary"
              onClick={() => navigate(`${OWNER_PATH[row.subjectType](row.subjectId)}?tab=vault`)}
            >
              {t('approvals.openVault')}
            </button>
          ) : null}
        </StickyActionBar>
      ) : null}

      {actions.dialog}

      {denying ? (
        <DecisionDialog
          row={row}
          approve={false}
          csrfToken={me.csrfToken}
          onClose={() => setDenying(false)}
          onDone={() => {
            setDenying(false);
            toast({ message: t('approvals.denied') });
          }}
        />
      ) : null}
    </div>
  );
}
