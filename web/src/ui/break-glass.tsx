import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage } from '@/lib/api';
import { OWNER_PATH } from '@/lib/routes';
import { SECRET_OWNER_KIND_KEY, type SecretOwnerType } from '@/lib/secret-owner-kinds';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { grantHoursCheck, requestedHours } from '@/ui/grant-hours';
import { useStepUpRetry } from '@/ui/use-step-up-retry';

/**
 * Luồng quyết phiếu break-glass dùng chung — màn Duyệt yêu cầu, trang chi tiết một phiếu, khối
 * "Cần bạn duyệt" của bảng điều khiển và khung Két của hồ sơ (rút yêu cầu).
 *
 * Một bản duy nhất vì Duyệt và Thu hồi sớm ĐÒI STEP-UP: bản nào tự gọi API mà quên bọc
 * `useStepUpRetry` thì người duyệt đã đăng nhập quá 10 phút gặp lỗi "nhập mã 6 số" mà không
 * có ô nào để nhập — ngõ cụt đúng lúc 2 giờ sáng.
 */

export interface BreakGlassRow {
  id: string;
  kind: string;
  state: string;
  requester: string;
  requesterName: string;
  subjectType: SecretOwnerType;
  subjectId: string;
  /** `mã · tên · site`; `null` khi hồ sơ đã bị xoá. */
  subjectLabel: string | null;
  /** Số ngăn két — chỉ người duyệt nhận. */
  secretCount: number | null;
  reason: string;
  payload: { hours?: number } | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** Server tính bằng đồng hồ (AD-6) — client không tự so giờ. */
  active: boolean;
}

export const BREAK_GLASS_KEY = ['break-glass'] as const;

/** Người dùng đóng hộp hỏi mã = huỷ, không phải lỗi để báo. */
export function isStepUpCancelled(error: unknown): boolean {
  return (error as Error | null)?.message === 'STEPUP_CANCELLED';
}

const STATE_LABEL: Record<string, string> = {
  pending: 'approvals.statePending',
  approved: 'approvals.stateApproved',
  denied: 'approvals.stateDenied',
  cancelled: 'approvals.stateCancelled',
  expired: 'approvals.stateExpired',
  revoked: 'approvals.stateRevoked',
};

const STATE_TONE: Record<string, string> = {
  pending: 'warn',
  approved: 'ok',
  denied: 'muted',
  cancelled: 'muted',
  expired: 'muted',
  revoked: 'danger',
};

/**
 * Phiếu ĐÃ DUYỆT nhưng quyền đã hết hiệu lực. `state` ghi một quyết định và không đổi nữa; còn
 * "có đang xem được không" là câu của ĐỒNG HỒ, server đưa xuống qua `active` (AD-6).
 */
export function expiredGrant(row: { state: string; active: boolean }): boolean {
  return row.state === 'approved' && !row.active;
}

/** Huy hiệu trạng thái — quyền đã tự cắt thì không được đeo màu xanh của quyền đang chạy. */
export function BreakGlassStateBadge({ row }: { row: { state: string; active: boolean } }) {
  const { t } = useTranslation();
  return (
    <span className={`badge ${expiredGrant(row) ? 'muted' : STATE_TONE[row.state] ?? 'muted'}`}>
      {expiredGrant(row) ? t('approvals.stateApprovedOver') : t(STATE_LABEL[row.state] ?? row.state)}
    </span>
  );
}

/** Dòng đối tượng: link tới hồ sơ + loại + số ngăn. Hồ sơ đã xoá thì nói ra, không in uuid. */
export function BreakGlassSubject({
  row,
}: {
  row: Pick<BreakGlassRow, 'subjectType' | 'subjectId' | 'subjectLabel' | 'secretCount'>;
}) {
  const { t } = useTranslation();
  return (
    <span className="approval-subject">
      {row.subjectLabel ? (
        <Link to={OWNER_PATH[row.subjectType](row.subjectId)}>{row.subjectLabel}</Link>
      ) : (
        <span className="muted">{t('approvals.subjectGone')}</span>
      )}
      <span className="badge plain">{t(SECRET_OWNER_KIND_KEY[row.subjectType])}</span>
      {row.secretCount ? (
        <span className="badge muted">
          {t('approvals.secretCount', { count: row.secretCount })}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Bốn lệnh của phiếu. `approve`/`revoke` tự hỏi mã 6 số khi server đòi step-up rồi làm lại
 * đúng lệnh đó — đặt `dialog` vào cây JSX. `refresh` làm mới mọi nơi đang hiện phiếu (danh sách,
 * badge menu, bảng điều khiển, khung Két của hồ sơ).
 */
export function useBreakGlassActions(csrfToken: string) {
  const stepUp = useStepUpRetry(csrfToken);
  const queryClient = useQueryClient();
  const post = (id: string, action: string, body: Record<string, unknown> = {}) =>
    apiFetch<BreakGlassRow>(`/api/v1/vault/break-glass/${id}/${action}`, {
      method: 'POST',
      csrfToken,
      body: JSON.stringify(body),
    });

  return {
    approve: (id: string, input: { hours: number; note?: string }) =>
      stepUp.run(() => post(id, 'approve', input)),
    deny: (id: string, note: string) => post(id, 'deny', { note }),
    revoke: (id: string) => stepUp.run(() => post(id, 'revoke')),
    cancel: (id: string) => post(id, 'cancel'),
    refresh: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: BREAK_GLASS_KEY }),
        queryClient.invalidateQueries({ queryKey: ['vault', 'verdict'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ]),
    dialog: stepUp.dialog,
  };
}

const DENY_QUICK = ['approvals.denyQuickVague', 'approvals.denyQuickHours', 'approvals.denyQuickNotNeeded'];

/**
 * Hộp Duyệt / Từ chối.
 *
 * Duyệt: ô giờ điền sẵn số người xin, sửa được — người duyệt cấp vừa đủ việc, không phải bấm
 * đồng ý với con số người xin tự đặt. Từ chối: ghi chú BẮT BUỘC, vì người xin đọc nó trong thư;
 * thiếu lý do thì họ gửi lại y nguyên. Xong việc thì hộp tự làm mới mọi nơi đang hiện phiếu.
 */
export function DecisionDialog({
  row,
  approve,
  csrfToken,
  onClose,
  onDone,
}: {
  row: BreakGlassRow;
  approve: boolean;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const actions = useBreakGlassActions(csrfToken);
  const requested = requestedHours(row.payload);
  const [hours, setHours] = useState(String(requested ?? 4));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const trimmed = note.trim();
    let asked = 0;
    if (approve) {
      const check = grantHoursCheck(hours, requested);
      if (check.reason) {
        const key =
          check.reason === 'aboveAsked' ? 'approvals.grantHoursAboveAsked' : 'approvals.grantHoursInvalid';
        setError(t(key, { hours: requested }));
        return;
      }
      asked = check.value;
    } else if (!trimmed) {
      setError(t('approvals.denyNoteRequired'));
      return;
    }
    setBusy(true);
    try {
      if (approve) await actions.approve(row.id, { hours: asked, note: trimmed });
      else await actions.deny(row.id, trimmed);
      void actions.refresh();
      onDone();
    } catch (err) {
      if (!isStepUpCancelled(err)) setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì không cho đóng: hộp biến mất nhưng lượt ghi vẫn chạy, người dùng tưởng đã
         huỷ trong khi quyết định đã vào sổ. */
      dismissible={!busy}
      guardUnsaved
      maxWidth={460}
      title={t(approve ? 'approvals.approveTitle' : 'approvals.denyTitle', {
        member: row.requester,
      })}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="decision-form"
            className={approve ? 'btn primary' : 'btn danger'}
            disabled={busy}
          >
            {busy ? t('common.loading') : t(approve ? 'approvals.approve' : 'approvals.deny')}
          </button>
        </>
      }
    >
      <form
        id="decision-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <BreakGlassSubject row={row} />
        <p className="approval-reason">{row.reason}</p>

        {approve ? (
          <Field
            label={t('approvals.grantHours')}
            required
            hint={
              requested !== null
                ? t('approvals.grantHoursHintMax', { hours: requested })
                : t('approvals.grantHoursHint')
            }
          >
            <input
              className="inp"
              required
              inputMode="numeric"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </Field>
        ) : (
          <div className="chip-list" role="group" aria-label={t('approvals.denyQuickPick')}>
            {DENY_QUICK.map((key) => (
              <button key={key} type="button" className="btn sm" onClick={() => setNote(t(key))}>
                {t(key)}
              </button>
            ))}
          </div>
        )}

        <Field
          label={t(approve ? 'approvals.note' : 'approvals.denyNoteLabel')}
          required={!approve}
        >
          <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      {actions.dialog}
    </Dialog>
  );
}
