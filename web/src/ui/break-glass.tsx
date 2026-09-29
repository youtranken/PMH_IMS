import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorCode, errorMessage } from '@/lib/api';
import { agoParts, formatDateTime } from '@/lib/format';
import { OWNER_PATH } from '@/lib/routes';
import { SECRET_OWNER_KIND_KEY, type SecretOwnerType } from '@/lib/secret-owner-kinds';
import { Dialog, DialogDescription } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { grantHoursCheck, hourSteps, requestedHours } from '@/ui/grant-hours';
import { useFormErrors } from '@/ui/use-form-errors';
import { useStepUpRetry } from '@/ui/use-step-up-retry';
import { useToast } from '@/ui/toast';
import { useNow } from '@/ui/use-now';

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
  /**
   * Chỉ trang chi tiết, chỉ người duyệt: vai người xin và số lần họ đã xin trong
   * `recentWindowDays` ngày (tính cả phiếu này). Người xin tự đọc thì `null`.
   */
  requesterRole?: string | null;
  recentCount?: number | null;
  recentWindowDays?: number | null;
  /** Chỉ trang chi tiết, chỉ người duyệt: từng bước quyết, cũ trước. */
  timeline?: { state: string; actor: string; at: string; note: string | null }[] | null;
  /** Lần đổi trạng thái cuối — với phiếu đã thu hồi thì là lúc quyền bị cắt. */
  updatedAt?: string;
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

/**
 * "Gửi 4 phút trước" — độ gấp của phiếu nằm ở khoảng CHỜ, không ở giờ tuyệt đối. Giờ tuyệt đối
 * vẫn ở `title`/`dateTime`. Tự trôi mỗi phút khi màn để mở.
 */
export function BreakGlassSentAgo({ at }: { at: string }) {
  const { t } = useTranslation();
  const now = useNow(60_000);
  const ago = agoParts(at, now);
  return (
    <time dateTime={at} title={formatDateTime(at)}>
      {ago ? t(`approvals.sentAgo_${ago.unit}`, { count: ago.count }) : formatDateTime(at)}
    </time>
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
    revoke: (id: string, note?: string) =>
      stepUp.run(() => post(id, 'revoke', note ? { note } : {})),
    cancel: (id: string) => post(id, 'cancel'),
    /** Người xin tự trả quyền đang chạy (VLT-055) — không đòi mã: bỏ bớt quyền không mở gì thêm. */
    release: (id: string) => post(id, 'release'),
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

/** Người xin đọc ghi chú này trong thư — một chữ "không" không cho họ biết phải sửa gì. */
const NOTE_MIN_LEN = 5;

/**
 * Phiếu đã có người khác xử lý, hoặc đã bị rút (người xin tự rút / phiên người xin kết thúc),
 * trong lúc hộp đang mở — không phải lỗi của người đang bấm.
 */
const RACE_CODES = new Set([
  'APPROVAL_ALREADY_DECIDED',
  'APPROVAL_TRANSITION_INVALID',
  'BREAK_GLASS_WITHDRAWN',
]);

/**
 * Hộp Duyệt / Từ chối / Thu hồi sớm.
 *
 * Duyệt: nấc giờ chọn nhanh ≤ số xin + ô giờ sửa được — người duyệt cấp vừa đủ việc, không phải
 * bấm đồng ý với con số người xin tự đặt. Từ chối và Thu hồi: ghi chú BẮT BUỘC, vì người xin
 * đọc nó trong thư; thiếu lý do thì họ gửi lại y nguyên.
 *
 * Tiêu đề ngắn (một dòng ở 390px); thân hộp nhắc lại người xin · lúc gửi · đối tượng · lý do ·
 * số giờ xin, để người trực mở ba phiếu liền không quyết nhầm phiếu. Ghi chú là ô nhiều dòng:
 * Enter trong ô một dòng là gửi luôn quyết định trước khi kịp xem lại số giờ.
 */
export function DecisionDialog({
  row,
  approve,
  revoke = false,
  csrfToken,
  onClose,
  onDone,
}: {
  row: BreakGlassRow;
  approve: boolean;
  /** Thu hồi sớm một quyền ĐANG chạy — thắng `approve`. */
  revoke?: boolean;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const actions = useBreakGlassActions(csrfToken);
  const mode: 'approve' | 'deny' | 'revoke' = revoke ? 'revoke' : approve ? 'approve' : 'deny';
  const requested = requestedHours(row.payload);
  const [hours, setHours] = useState(String(requested ?? 4));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* Không âm thầm rơi về một con số mặc định: "2 tiếng" hay "0" phải bị báo, không được thành
     một quyền mở két dài hơn người duyệt định cấp. */
  // Số giờ: số nguyên dương và KHÔNG vượt số giờ người xin (kẹp lại ở API) — xem grant-hours.ts.
  const hoursCheck = grantHoursCheck(hours, requested);
  const noteRequired = mode !== 'approve';
  const check = useFormErrors({
    hours:
      mode === 'approve' &&
      hoursCheck.reason !== null &&
      t(hoursCheck.reason === 'aboveAsked' ? 'approvals.grantHoursAboveAsked' : 'approvals.grantHoursInvalid', {
        hours: requested,
      }),
    note:
      noteRequired &&
      note.trim().length < NOTE_MIN_LEN &&
      t(mode === 'revoke' ? 'approvals.revokeNoteRequired' : 'approvals.denyNoteRequired', {
        min: NOTE_MIN_LEN,
      }),
  });

  const submit = async () => {
    setError(null);
    if (!check.check()) return;
    const trimmed = note.trim();
    setBusy(true);
    try {
      if (mode === 'approve') {
        await actions.approve(row.id, { hours: hoursCheck.value ?? 0, note: trimmed });
      } else if (mode === 'revoke') await actions.revoke(row.id, trimmed);
      else await actions.deny(row.id, trimmed);
      void actions.refresh();
      onDone();
    } catch (err) {
      if (isStepUpCancelled(err)) return;
      /* Người khác vừa quyết phiếu này: đóng hộp, nói ra, nạp lại danh sách — giữ hộp mở với
         một câu lỗi thì người trực bấm lại lần nữa vào một phiếu đã xong. */
      if (RACE_CODES.has(errorCode(err) ?? '')) {
        toast({ message: errorMessage(err), tone: 'warn' });
        void actions.refresh();
        onClose();
        return;
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitLabel =
    mode === 'approve'
      ? hoursCheck.value !== null
        ? t('approvals.approveHours', { hours: hoursCheck.value })
        : t('approvals.approve')
      : mode === 'revoke'
        ? t('approvals.revoke')
        : t('approvals.deny');

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì không cho đóng: hộp biến mất nhưng lượt ghi vẫn chạy, người dùng tưởng đã
         huỷ trong khi quyết định đã vào sổ. */
      dismissible={!busy}
      guardUnsaved
      maxWidth={460}
      title={t(
        mode === 'approve'
          ? 'approvals.approveTitle'
          : mode === 'revoke'
            ? 'approvals.revokeTitle'
            : 'approvals.denyTitle',
      )}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="decision-form"
            className={mode === 'approve' ? 'btn primary' : 'btn danger'}
            disabled={busy}
          >
            {busy ? t('common.loading') : submitLabel}
          </button>
        </>
      }
    >
      <form
        id="decision-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {/* Khối tóm tắt là MÔ TẢ của hộp (aria-describedby qua Radix): trình đọc màn hình đọc
            người xin + đối tượng + lý do ngay khi hộp mở, trước ô nhập. */}
        <DialogDescription asChild>
          <div className="decision-summary">
            <p>
              <strong>{row.requesterName}</strong>
              {row.requesterName !== row.requester ? (
                <>
                  {' · '}
                  <span className="muted">{row.requester}</span>
                </>
              ) : null}
              {' · '}
              <span className="muted">
                <BreakGlassSentAgo at={row.createdAt} />
              </span>
            </p>
            <BreakGlassSubject row={row} />
            <p className="approval-reason">{row.reason}</p>
            <p className="muted">
              {mode === 'revoke' && row.expiresAt
                ? t('approvals.revokeEndsAt', { at: formatDateTime(row.expiresAt) })
                : requested !== null
                  ? t('approvals.askedHours', { hours: requested })
                  : t('approvals.hoursUnknown')}
            </p>
          </div>
        </DialogDescription>

        {mode === 'approve' ? (
          <>
            <div className="segmented" role="group" aria-label={t('approvals.durationBlock')}>
              {hourSteps(requested).map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={hoursCheck.value === h}
                  onClick={() => setHours(String(h))}
                >
                  {h === requested
                    ? t('approvals.durationAsked', { hours: h })
                    : t('approvals.hours', { hours: h })}
                </button>
              ))}
            </div>
            <Field
              label={t('approvals.grantHours')}
              required
              hint={
                requested !== null
                  ? t('approvals.grantHoursHintMax', { hours: requested })
                  : t('approvals.grantHoursHint')
              }
              error={check.error('hours')}
            >
              <input
                className="inp"
                required
                inputMode="numeric"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </Field>
            {/* Ước tính để người duyệt hình dung — hạn thật do server đặt lúc duyệt (AD-6). */}
            {hoursCheck.value !== null ? (
              <p className="muted">
                {t('approvals.endsAtAbout', {
                  at: formatDateTime(new Date(Date.now() + hoursCheck.value * 3_600_000)),
                })}
              </p>
            ) : null}
          </>
        ) : mode === 'deny' ? (
          <div className="chip-list" role="group" aria-label={t('approvals.denyQuickPick')}>
            {DENY_QUICK.map((key) => (
              <button key={key} type="button" className="btn sm" onClick={() => setNote(t(key))}>
                {t(key)}
              </button>
            ))}
          </div>
        ) : (
          <p className="alert warn">{t('approvals.revokeWarn')}</p>
        )}

        <Field
          label={t(
            mode === 'approve'
              ? 'approvals.note'
              : mode === 'revoke'
                ? 'approvals.revokeNoteLabel'
                : 'approvals.denyNoteLabel',
          )}
          required={noteRequired}
          error={check.error('note')}
        >
          <textarea
            className="inp"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
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
