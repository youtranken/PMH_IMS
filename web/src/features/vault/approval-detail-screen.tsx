import { useState } from 'react';
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
  useBreakGlassActions,
  type BreakGlassRow,
} from '@/ui/break-glass';
import { isStepUpCancelled } from '@/ui/use-step-up-retry';
import { useConfirm } from '@/ui/confirm-provider';
import { SpecList } from '@/ui/detail-facts';
import { DetailHeader } from '@/ui/detail-header';
import { DetailLoadFailed, Loading } from '@/ui/load-state';
import { StickyActionBar } from '@/ui/sticky-action-bar';
import { useToast } from '@/ui/toast';
import { useNow } from '@/ui/use-now';

const ROLE_LABEL: Record<string, string> = {
  sa: 'accounts.roleSa',
  admin: 'accounts.roleAdmin',
  member: 'accounts.roleMember',
};

/**
 * Trang chi tiết MỘT phiếu break-glass — đích của nút "Xem yêu cầu" trong thư.
 *
 * Không có nút Duyệt (Q-30): người duyệt đồng ý bằng cách đọc mã trong thư cho người xin. Trang
 * này để xem người xin, đối tượng, lý do, số giờ, và Từ chối / Thu hồi sớm. Phiếu đã có người xử
 * lý thì hiện trạng thái cuối; phiếu của chính mình thì chỉ rút được.
 */
export function ApprovalDetailScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const actions = useBreakGlassActions(me.csrfToken);
  const canDecide = me.role === 'sa' || me.role === 'admin';
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

  if (detail.isLoading) return <Loading />;
  if (detail.isError) {
    // Link trong thư có thể trỏ tới phiếu không còn: giữ đường về danh sách, tách 404 khỏi lỗi máy chủ.
    return (
      <DetailLoadFailed
        error={detail.error}
        onRetry={() => void detail.refetch()}
        backTo={PATHS.approvals}
        backLabel={t(canDecide ? 'nav.approvals' : 'nav.approvalsMine')}
      />
    );
  }
  // Mất mạng ⇒ `fetchStatus:'paused'`: không lỗi, không dữ liệu — xem `devices/device-detail.tsx`.
  if (!detail.data) return <Loading />;
  const row = detail.data;

  const own = row.requester.toLowerCase() === me.email.toLowerCase();
  const pending = row.state === 'pending';
  const decidable = pending && canDecide && !own;
  const asked = row.payload?.hours;

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
    }
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

      {/* Một thẻ bốn dòng, không bốn khung: người duyệt mở từ thư trên điện thoại thấy ngay
          "Từ chối" mà không phải cuộn (UX-E16). */}
      <section className="card">
        <SpecList
          label={t('approvals.detailTitle')}
          items={[
            {
              label: t('approvals.requesterBlock'),
              present: true,
              value: (
                <>
                  <strong>{row.requesterName}</strong>
                  {row.requesterName !== row.requester ? <span className="muted"> · {row.requester}</span> : null}
                  {row.requesterRole ? (
                    <>
                      {' '}
                      <span className="tag">{t(ROLE_LABEL[row.requesterRole] ?? row.requesterRole)}</span>
                    </>
                  ) : null}
                  {/* Chỉ con số: người duyệt nhận ra người xin quá thường mà không phải mở nhật ký. */}
                  {typeof row.recentCount === 'number' && row.recentWindowDays ? (
                    <span className="cell-sub">
                      {row.recentCount <= 1
                        ? t('approvals.recentFirst', { days: row.recentWindowDays })
                        : t('approvals.recentNth', { count: row.recentCount, days: row.recentWindowDays })}
                    </span>
                  ) : null}
                </>
              ),
            },
            { label: t('approvals.subject'), present: true, value: <BreakGlassSubject row={row} /> },
            { label: t('approvals.reasonBlock'), value: <span className="approval-reason">{row.reason}</span>, present: Boolean(row.reason) },
            {
              label: t('approvals.durationBlock'),
              present: true,
              value: (
                <>
                  {asked !== undefined ? t('approvals.hours', { hours: asked }) : t('approvals.hoursUnknown')}
                  {row.approver ? <span className="cell-sub">{t('approvals.chosenApprover', { approver: row.approver })}</span> : null}
                </>
              ),
            },
          ]}
        />
      </section>

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

      {/* Phía người xin (Q-15, Q-30): mã nhập ở khung Két của đúng hồ sơ — nút ở thanh đáy. */}
      {own && pending ? (
        <p className="muted" role="status">
          {t('approvals.enterCodeAtVault')}
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
        <StickyActionBar label={t('approvals.decisionBar')} note={t('approvals.byCodeHint')}>
          <button
            type="button"
            className="btn danger-ghost"
            disabled={busy}
            onClick={() => setDialogMode('deny')}
          >
            {t('approvals.deny')}
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
          {row.subjectLabel ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => navigate(`${OWNER_PATH[row.subjectType](row.subjectId)}?tab=vault`)}
            >
              {t('approvals.enterCode')}
            </button>
          ) : null}
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
