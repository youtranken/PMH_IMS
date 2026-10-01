import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { agoParts, formatDateTime } from '@/lib/format';
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
import { DetailHeader } from '@/ui/detail-header';
import { LoadError, Loading } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { SegmentedRadio } from '@/ui/segmented-radio';
import { StickyActionBar } from '@/ui/sticky-action-bar';
import { useToast } from '@/ui/toast';
import { useNow } from '@/ui/use-now';
import { hourSteps } from '@/ui/grant-hours';

/** Nút "Duyệt" phải chạm lần hai trong khoảng này mới cấp — sau đó tự trở về. */
const CONFIRM_WINDOW_MS = 3_000;

const ROLE_LABEL: Record<string, string> = {
  sa: 'accounts.roleSa',
  admin: 'accounts.roleAdmin',
  member: 'accounts.roleMember',
};

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
  /** Hộp Từ chối / Thu hồi sớm — cả hai bắt ghi lý do vì người xin đọc nó trong thư. */
  const [dialogMode, setDialogMode] = useState<'deny' | 'revoke' | null>(null);
  // "Gửi 4 phút trước" phải tự trôi khi người duyệt để màn mở — một phút một lần là đủ.
  const now = useNow(60_000);

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
  const choices = hourSteps(asked);
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
      () =>
        actions.approve(
          row.id,
          { hours: granted, note: note.trim() },
          t('approvals.stepUpApprove', { name: row.requesterName }),
        ),
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

  const sentAgo = agoParts(row.createdAt, now);
  const who = row.decidedBy ?? '—';
  const at = formatDateTime(row.decidedAt);
  const finalText =
    row.state === 'approved' && row.active
      ? t('approvals.grantedTo', { member: row.requesterName, until: formatDateTime(row.expiresAt) })
      : row.state === 'expired' && row.expiresAt === null
        ? /* Grant đã duyệt luôn có hạn; hết hạn mà không có hạn = hết hạn CHỜ, chưa từng được cấp. */
          t('approvals.finalPendingExpired')
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
      <DetailHeader
        crumbs={[
          { label: t(canDecide ? 'nav.approvals' : 'nav.approvalsMine'), to: PATHS.approvals },
          { label: t('approvals.detailTitle') },
        ]}
        name={t('approvals.detailTitle')}
        subline={
          /* Người trực cần biết phiếu đã chờ BAO LÂU; giờ tuyệt đối vẫn ở `title` và `dateTime`. */
          <time dateTime={row.createdAt} title={formatDateTime(row.createdAt)}>
            {sentAgo ? t(`approvals.sentAgo_${sentAgo.unit}`, { count: sentAgo.count }) : null}
          </time>
        }
        actions={<BreakGlassStateBadge row={row} />}
      />

      <section className="card" aria-label={t('approvals.requesterBlock')}>
        <p className="approval-detail-label">{t('approvals.requesterBlock')}</p>
        <strong>{row.requesterName}</strong>
        {row.requesterName !== row.requester ? (
          <span className="muted"> · {row.requester}</span>
        ) : null}
        {row.requesterRole ? (
          <span className="badge plain">{t(ROLE_LABEL[row.requesterRole] ?? row.requesterRole)}</span>
        ) : null}
        {/* Chỉ con số: người duyệt nhận ra người xin quá thường mà không phải mở nhật ký. */}
        {typeof row.recentCount === 'number' && row.recentWindowDays ? (
          <p className="muted">
            {row.recentCount <= 1
              ? t('approvals.recentFirst', { days: row.recentWindowDays })
              : t('approvals.recentNth', { count: row.recentCount, days: row.recentWindowDays })}
          </p>
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
          <SegmentedRadio
            label={t('approvals.durationBlock')}
            value={String(granted)}
            onChange={(next) => {
              setHours(Number(next));
              setArmed(false);
            }}
            options={choices.map((h) => ({
              value: String(h),
              label:
                h === asked
                  ? t('approvals.durationAsked', { hours: h })
                  : t('approvals.hours', { hours: h }),
            }))}
          />
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

      {row.timeline && row.timeline.length > 0 ? (
        /* `decidedBy` chỉ giữ người duyệt đầu tiên — không có dòng này thì phiếu đã thu hồi
           không nói được ai cắt quyền, lúc nào. */
        <section className="card" aria-label={t('approvals.timelineTitle')}>
          <p className="approval-detail-label">{t('approvals.timelineTitle')}</p>
          <ol className="approval-timeline">
            <li>
              {t('approvals.timelineSent')} · {row.requesterName} ·{' '}
              <span className="muted">{formatDateTime(row.createdAt)}</span>
            </li>
            {row.timeline.map((step) => (
              <li key={`${step.state}-${step.at}`}>
                {t(`approvals.timelineStep_${step.state}`, step.state)} · {step.actor} ·{' '}
                <span className="muted">{formatDateTime(step.at)}</span>
                {step.note ? <span className="cell-sub">{step.note}</span> : null}
              </li>
            ))}
          </ol>
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

      {/* Phía người xin (Q-15): chờ thì không phải canh trang; được duyệt thì không có nút riêng —
          mở lại đối tượng và bấm "Xem", lần xem đầu gắn quyền vào phiên đó. */}
      {own && pending ? (
        <p className="muted" role="status">
          {t('vault.pendingCanLeave')}
        </p>
      ) : own && row.state === 'approved' && row.active ? (
        <p className="muted" role="status">
          {row.claimedAt
            ? t('vault.sessionBound')
            : t('approvals.readyToView', {
                subject: row.subjectLabel ?? t('approvals.subjectGone'),
              })}
        </p>
      ) : null}

      {decidable ? (
        <StickyActionBar label={t('approvals.decisionBar')}>
          <button
            type="button"
            className="btn danger-ghost"
            disabled={busy}
            onClick={() => setDialogMode('deny')}
          >
            {t('approvals.deny')}
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={onApprove}>
            {busy
              ? t('common.working')
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
              onClick={() => setDialogMode('revoke')}
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

      {dialogMode ? (
        <DecisionDialog
          row={row}
          approve={false}
          revoke={dialogMode === 'revoke'}
          csrfToken={me.csrfToken}
          onClose={() => setDialogMode(null)}
          onDone={() => {
            setDialogMode(null);
            toast({ message: t(dialogMode === 'revoke' ? 'approvals.revoked' : 'approvals.denied') });
          }}
        />
      ) : null}
    </div>
  );
}
