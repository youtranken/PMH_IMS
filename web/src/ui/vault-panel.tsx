import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorCode, errorMessage, useApiMutation } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { formatDateTime, orDash, remainingParts } from '@/lib/format';
import type { Me } from '@/lib/me';
import type { SecretOwnerType } from '@/lib/secret-owner-kinds';
import { noteContainsSecret, noteLooksLikeSecret } from '@/lib/note-secret';
import { Dialog } from '@/ui/dialog';
import { useDisabledReason } from '@/ui/disabled-reason';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { useSupportContact } from '@/ui/use-support-contact';
import { Field } from '@/ui/page-header';
import { RowActions } from '@/ui/row-actions';
import { TableWrap } from '@/ui/data-table';
import { Select } from '@/ui/select';
import { RevealDialog, RevealStep, type TotpReveal } from '@/ui/reveal-dialog';
import { SecretStrengthMeter } from '@/ui/secret-strength-meter';
import { SecretValueInput } from '@/ui/secret-value-input';
import { StepUpDialog, StepUpStep } from '@/ui/step-up-dialog';
import { hourSteps } from '@/ui/grant-hours';
import { useStepUpRetry } from '@/ui/use-step-up-retry';
import { secretTextRule, useFormErrors } from '@/ui/use-form-errors';
import { useBreakGlassActions, type BreakGlassRow } from '@/ui/break-glass';
import { PATHS } from '@/lib/routes';
import { Link } from 'react-router-dom';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import { useNow } from '@/ui/use-now';
import { SecretDue } from '@/ui/secret-due';
import { Chevron } from '@/ui/chevron';

/*
 * Danh sách loại chủ thể nằm ở `lib/secret-owner-kinds.ts` — ở đó nó đứng cạnh
 * bảng nhãn và có bài điểm danh đối chiếu thẳng mã nguồn API. Re-export để mọi nơi đang
 * `import type { SecretOwnerType } from '@/ui/vault-panel'` vẫn đúng, mà chỉ còn MỘT khai báo.
 */
export type { SecretOwnerType };
/* Bản sao của `SECRET_KINDS` (api) và `secret_kind_check` (DB) — thêm loại sửa đủ ba chỗ. */
type SecretKind = 'password' | 'license_key' | 'totp' | 'other';

export interface AccessVerdict {
  tier: 'whitelist' | 'needs_approval' | 'denied';
  tierLabel: string;
  canReveal: boolean;
  canRequest: boolean;
  grant: { id: string; expiresAt: string | null } | null;
  pending: { id: string; createdAt?: string } | null;
  /**
   * Đã duyệt nhưng chưa xem lần nào (Q-15): lần bấm Xem đầu tiên (qua mã 6 số) gắn quyền vào
   * phiên đang xem. `canReveal` đã là `true` trong trường hợp này.
   */
  claimable?: { id: string; expiresAt: string | null } | null;
  /** Số người duyệt được đã nhận thư báo phiếu đang treo — chỉ con số. */
  notifiedApprovers?: number | null;
  /** Giây còn lại của quyền (đang chạy hoặc chờ xem lần đầu), tính từ lúc duyệt — server tính (AD-6). */
  grantSecondsLeft?: number | null;
  /** `breakglass.pending_expire_hours` — phiếu treo quá chừng này thì tự hết hạn. */
  pendingExpireHours?: number | null;
  /** Trần giờ cấp (`breakglass.max_grant_hours`) — hộp Xin chọn nấc trong trần này. */
  maxGrantHours?: number | null;
  /** Phiếu mới nhất của chính người xem trên hồ sơ này bị từ chối — lúc nào, ghi chú gì. */
  lastDenied?: { at: string | null; note: string | null } | null;
  /** Quyền của chính người xem đang gắn ở một phiên đăng nhập khác — phải xin lại (Q-15). */
  otherSessionHeld?: boolean;
}

/**
 * Đang có phiếu treo thì hỏi lại verdict định kỳ: người xin đang ngồi chờ, và quyết định đến
 * từ máy người khác — không làm mới thì họ phải F5 mới biết đã được duyệt.
 */
const PENDING_REFETCH_MS = 15_000;

export interface SecretMeta {
  id: string;
  ownerType: SecretOwnerType;
  ownerId: string;
  kind: SecretKind;
  label: string;
  username: string | null;
  /** `null` cả khi ngăn có ghi chú mà người xem chưa mở được ngăn — server giấu (SEC-20). */
  note: string | null;
  /** Ngăn có ghi chú hay không, kể cả khi `note` bị giấu. */
  hasNote?: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Lúc giá trị đổi lần cuối + ai đổi — sửa ghi chú không chạm (khác `updatedAt`). */
  valueChangedAt?: string;
  valueChangedBy?: string;
  /** Tuổi giá trị và đã quá ngưỡng `dashboard.secret_stale_days` chưa — server tính. */
  valueAgeDays?: number;
  valueStale?: boolean;
  /** Còn bao nhiêu ngày tới hạn đổi (âm = đã quá) — server tính theo cùng ngưỡng (Q-15). */
  dueInDays?: number;
}

function secretsKey(ownerType: SecretOwnerType, ownerId: string) {
  return ['vault', ownerType, ownerId];
}

/**
 * Két của một chủ thể + phán quyết quyền — MỘT định nghĩa, hai nơi dùng.
 *
 * Panel dưới đây cần cả danh sách; nhãn tab của trang chi tiết chỉ cần cái `length`. Tách ra
 * đây vì luật "được xem danh sách hay không" KHÔNG được nằm ở hai chỗ: bản sao thứ hai sẽ
 * quên `enabled: allowed`, và mỗi lần mở trang chi tiết là một cú 403 cho Member không có
 * quyền — đúng thứ mà `verdict` sinh ra để tránh.
 *
 * SA/Admin không chờ `verdict`: `isAdmin` đã đủ, bắt họ đợi thêm một lượt mạng nữa là vô ích.
 *
 * Số secret vì thế là `undefined` chứ không phải 0 khi người xem không có quyền — "không biết"
 * và "không có ngăn nào" là hai câu khác hẳn, và nhãn tab đề số 0 cho một két đầy là nói dối.
 */
export function useOwnerSecrets(ownerType: SecretOwnerType, ownerId: string, me: Me) {
  const isAdmin = me.role === 'sa' || me.role === 'admin';

  /**
   * "Tôi làm được gì với chủ thể này" — MỘT lần gọi, server phán.
   *
   * Client không tự suy từ vai: quyền của Member đến từ ma trận truy cập cộng với grant còn
   * hạn, và cả hai đổi được bất cứ lúc nào mà trình duyệt không hay biết.
   */
  const verdict = useQuery({
    queryKey: ['vault', 'verdict', ownerType, ownerId],
    queryFn: () =>
      apiFetch<AccessVerdict>(
        `/api/v1/vault/secrets/verdict?ownerType=${ownerType}&ownerId=${encodeURIComponent(ownerId)}`,
      ),
    refetchInterval: (query) => (query.state.data?.pending ? PENDING_REFETCH_MS : false),
  });

  const tier = verdict.data?.tier;
  const allowed = isAdmin || (tier !== undefined && tier !== 'denied');

  const secrets = useQuery({
    queryKey: secretsKey(ownerType, ownerId),
    queryFn: () =>
      apiFetch<SecretMeta[]>(
        `/api/v1/vault/secrets?ownerType=${ownerType}&ownerId=${encodeURIComponent(ownerId)}`,
      ),
    enabled: allowed,
  });

  return { verdict, secrets, allowed, isAdmin };
}

/**
 * Két sắt dùng chung (FR-021/FR-026, AD-15).
 *
 * Gắn vào chủ thể qua `ownerType`/`ownerId` — thiết bị và phần mềm dùng CHUNG panel này.
 * Hai màn tự viết hai bản là hai lần phải nhớ "đừng bao giờ hiện giá trị ở bảng", và sẽ có
 * màn quên.
 *
 * Bảng CHỈ có metadata: nhãn, loại, tên đăng nhập. Giá trị chỉ hiện khi bấm Xem và gõ TOTP
 * (4.2), hiện đúng một secret, tự ẩn sau `secret.reveal_seconds`. Không có nút "xuất tất cả":
 * FR-026 cấm ở mọi quyền.
 */
export function VaultPanel({
  ownerType,
  ownerId,
  me,
  canEdit = true,
  stepsInline = false,
  ownerLabel,
  locked = false,
}: {
  ownerType: SecretOwnerType;
  ownerId: string;
  me: Me;
  canEdit?: boolean;
  /** Mã hồ sơ chủ — tiêu đề hộp "Cất mật khẩu/khóa — SW-CORE-01" nói cất vào MÁY NÀO (DEV-035). */
  ownerLabel?: string;
  /**
   * Hồ sơ đã khóa (thanh lý): két chỉ còn để đọc, câu rỗng không mời "cất vào đây" nữa (DEV-057).
   */
  locked?: boolean;
  /**
   * Khung này đang nằm TRONG một hộp (vd popup của trang Két tổng): bước gõ mã 6 số và bước
   * hiện giá trị thay chỗ danh sách ngăn ngay trong hộp đó, không mở hộp chồng lên (VLT-062).
   * Trên trang hồ sơ (không có hộp bao ngoài) thì để mặc định — mỗi lúc chỉ có một hộp.
   */
  stepsInline?: boolean;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ secret: SecretMeta | null } | null>(null);
  const [rotating, setRotating] = useState<SecretMeta | null>(null);
  const [pendingStepUp, setPendingStepUp] = useState<SecretMeta | null>(null);
  /** Secret đang mở dở — chặn bấm đúp đẻ ra hai lần giải mã, hai dòng audit. */
  const [opening, setOpening] = useState<string | null>(null);
  /* Mở MỘT ngăn là mọi nút "Xem" khác xám hết, và không gì nói vì sao — người dùng đọc ra
     "mình không có quyền". Một câu dùng chung cho cả bảng, gắn vào từng nút đang xám. */
  const busyReason = useDisabledReason(opening !== null ? t('vault.revealBusy') : null);
  const [requesting, setRequesting] = useState(false);
  const [revealed, setRevealed] = useState<
    {
      label: string;
      username: string | null;
      value: string;
      totp?: TotpReveal;
      seconds: number;
      stepUpSecondsLeft: number;
    } | null
  >(null);
  const openingRef = useRef<string | null>(null);

  const queryKey = secretsKey(ownerType, ownerId);
  const { verdict, secrets, allowed, isAdmin } = useOwnerSecrets(ownerType, ownerId, me);

  /*
   * Đếm lùi quyền đang chạy TỪ con số server đưa (mốc = lúc nhận phản hồi), không tự trừ theo
   * đồng hồ máy so với `expiresAt` — máy người dùng lệch giờ thì chữ đếm lùi cũng không nói sai.
   * Về 0 thì hỏi lại server: nó mới là nơi nói quyền đã cắt.
   */
  const grantSecondsLeft = verdict.data?.grantSecondsLeft ?? null;
  const grantDeadline =
    grantSecondsLeft === null ? null : verdict.dataUpdatedAt + grantSecondsLeft * 1000;
  const now = useNow(1000, grantDeadline !== null);
  const grantLeft =
    grantDeadline === null ? null : Math.max(0, Math.round((grantDeadline - now) / 1000));
  const { refetch: refetchVerdict } = verdict;
  useEffect(() => {
    if (grantLeft !== 0) return;
    const timer = window.setTimeout(() => void refetchVerdict(), 1000);
    return () => window.clearTimeout(timer);
  }, [grantLeft, refetchVerdict]);

  const revoke = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/vault/secrets/${input.id}`,
    { method: 'DELETE', csrfToken: me.csrfToken, refreshMe: false, body: () => undefined },
  );

  /** Ghi vào két đòi step-up — hook lo phần hỏi mã rồi làm lại. */
  const writeStepUp = useStepUpRetry(me.csrfToken);
  const breakGlass = useBreakGlassActions(me.csrfToken);
  const [cancelling, setCancelling] = useState(false);
  const [releasing, setReleasing] = useState(false);

  /** Trả quyền sớm (VLT-055): qua hộp xác nhận, vì trả rồi muốn xem lại là phải chờ duyệt lại. */
  const releaseGrant = async (grantId: string) => {
    const ok = await askConfirm({
      title: t('common.titleOf', { action: t('vault.release'), subject: t('vault.tab') }),
      message: t('vault.releaseConfirm'),
      danger: true,
      confirmLabel: t('vault.release'),
    });
    if (!ok) return;
    setReleasing(true);
    try {
      await breakGlass.release(grantId);
      toast({ message: t('vault.released') });
      void breakGlass.refresh();
    } catch (error) {
      toast({ message: errorMessage(error), tone: 'error' });
    } finally {
      setReleasing(false);
    }
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  /**
   * Mở két. KHÔNG tự đoán "còn trong grace hay chưa" ở client: cứ gọi, gặp
   * `STEPUP_REQUIRED` thì hỏi mã rồi thử lại đúng secret đó. Đồng hồ máy người dùng lệch,
   * hay admin vừa đổi `secret.stepup_grace_minutes`, đều không làm sai luồng này.
   */
  const openSecret = useCallback(
    async (secret: SecretMeta, afterStepUp = false) => {
      // Chốt bằng ref chứ không bằng state: hai lần bấm liên tiếp rơi vào cùng một nhịp
      // render thì cả hai cùng đọc `opening === null` và cùng đi tiếp. Ref đổi ngay lập tức.
      if (openingRef.current) return;
      openingRef.current = secret.id;
      setOpening(secret.id);
      try {
        const opened = await apiFetch<{
          value: string;
          /** Chỉ ngăn "Mã 2 lớp": QR + mã hiện tại, server sinh lại mỗi lần mở (Q-18). */
          totp?: TotpReveal;
          revealSeconds: number;
          /** Grace step-up còn lại — server tính, client không tự đoán được (xem session-policy). */
          stepUpSecondsLeft: number;
        }>(
          `/api/v1/vault/secrets/${secret.id}/reveal`,
          { method: 'POST', csrfToken: me.csrfToken },
        );
        setRevealed({
          label: secret.label,
          username: secret.username,
          value: opened.value,
          totp: opened.totp,
          seconds: opened.revealSeconds,
          stepUpSecondsLeft: opened.stepUpSecondsLeft,
        });
        /* Lần xem đầu sau khi được duyệt vừa gắn quyền vào phiên này (Q-15): hỏi lại verdict để
           khung "Đã được duyệt" chuyển sang khung quyền đang chạy, và tải lại danh sách — ghi
           chú ngăn chỉ về khi quyền đã gắn phiên (SEC-20). */
        if (!isAdmin) {
          void refetchVerdict();
          void queryClient.invalidateQueries({ queryKey: secretsKey(ownerType, ownerId) });
        }
      } catch (error) {
        const code = errorCode(error);
        if (!afterStepUp && code === 'STEPUP_REQUIRED') {
          setPendingStepUp(secret);
          return;
        }
        toast({ message: errorMessage(error), tone: 'error' });
        // Quyền vừa bị phiên khác giữ / vừa hết: khung phải nói đúng trạng thái mới.
        if (code === 'BREAK_GLASS_OTHER_SESSION' || code === 'BREAK_GLASS_REQUIRED') {
          void refetchVerdict();
        }
      } finally {
        openingRef.current = null;
        setOpening(null);
      }
    },
    [me.csrfToken, toast, isAdmin, refetchVerdict, queryClient, ownerType, ownerId],
  );

  // Ngoài danh sách: chỉ đường tới người gán quyền được (VLT-056). Gọi TRƯỚC các nhánh thoát
  // bên dưới — hook không được nằm sau một `return`.
  const noAccess = !isAdmin && verdict.data !== undefined && !allowed;
  const contact = useSupportContact(noAccess);

  /*
   * BA CHỐT NÀY CHỈ ÁP CHO NGƯỜI CẦN `verdict`.
   *
   * `useOwnerSecrets` tính `allowed = isAdmin || …`: SA/Admin không chờ `verdict`. Đặt ba chốt
   * này lên trước mọi thứ thì `/vault/secrets/verdict` trả 500 là SA/Admin MẤT SẠCH panel Két
   * sắt — dù quyền của họ không hề phụ thuộc vào câu trả lời ấy, và `secrets`
   * (`enabled: allowed`) đã tải xong.
   */
  if (!isAdmin) {
    if (verdict.isLoading) return <Loading />;
    /**
     * Lỗi tải verdict KHÔNG được rơi xuống thành "bạn không có quyền".
     *
     * Đúng cái bẫy vừa gặp: URL sai → 404 → `verdict.data` undefined → panel nói "chỉ Quản trị
     * xem được", và thông điệp đó nghe hợp lý tới mức che mất một lỗi 404. Sai vì thiếu quyền
     * và sai vì hỏng phải nói ra hai câu khác nhau.
     */
    if (verdict.isError)
      return <LoadError error={verdict.error} onRetry={() => void verdict.refetch()} />;
    if (!allowed) {
      return (
        <EmptyState
          title={t('vault.noPermissionTitle')}
          hint={t('vault.noPermission')}
          action={
            contact.data?.contact ? (
              <span>
                <strong>{t('auth.supportContactLabel')}:</strong> {contact.data.contact}
              </span>
            ) : undefined
          }
        />
      );
    }
  }

  const rows = secrets.data ?? [];

  const stepUpPurpose = pendingStepUp
    ? t('vault.stepUpPurpose', { label: pendingStepUp.label })
    : undefined;
  const afterStepUp = () => {
    const secret = pendingStepUp;
    setPendingStepUp(null);
    // `afterStepUp` = true: gõ mã xong mà vẫn bị đòi mã nữa thì đó là lỗi thật,
    // không phải chuyện để hỏi lại vòng hai — nếu không sẽ thành vòng lặp hộp thoại.
    if (secret) void openSecret(secret, true);
  };
  /* Hết giờ thì NÓI RA. Hộp biến mất không một lời là thứ khiến người dùng bấm "Xem"
     lần nữa cho chắc — và mỗi lần bấm là thêm một dòng nhật ký mở két. */
  const onRevealExpire = () => toast({ message: t('vault.autoHidden') });

  if (stepsInline && (pendingStepUp || revealed)) {
    return (
      <div className="attachment-panel">
        {revealed ? (
          <RevealStep
            label={revealed.label}
            username={revealed.username}
            value={revealed.value}
            totp={revealed.totp}
            seconds={revealed.seconds}
            stepUpSecondsLeft={revealed.stepUpSecondsLeft}
            onClose={() => setRevealed(null)}
            onExpire={onRevealExpire}
          />
        ) : pendingStepUp ? (
          <StepUpStep
            csrfToken={me.csrfToken}
            purpose={stepUpPurpose}
            graceMinutes={me.config?.stepUpGraceMinutes}
            backLabel={t('vault.stepBack')}
            onBack={() => setPendingStepUp(null)}
            onDone={afterStepUp}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="attachment-panel">
      {/* Đoạn giới thiệu két chỉ cần lúc két còn trống — hồ sơ nào cũng lặp lại hai dòng này
          là đẩy bảng xuống cho một câu người dùng đã thuộc. */}
      {secrets.isSuccess && rows.length === 0 ? <p className="muted">{t('vault.intro')}</p> : null}

      {/* Member phải THẤY mình đang ở tầng nào — không thì họ bấm Xem, bị từ chối, và
          không hiểu vì sao. */}
      {verdict.data?.pending ? (
        /* Phiếu đang treo: nói gửi lúc nào, cho rút lại — việc xong trước khi ai kịp duyệt thì
           phiếu treo vẫn nhắc người duyệt và chặn người xin gửi phiếu mới cho cùng đối tượng. */
        <div className="alert warn" role="status">
          <p>
            {t('vault.pendingSince', { at: formatDateTime(verdict.data.pending.createdAt) })}
          </p>
          {/* Yêu cầu chờ không gắn phiên (Q-15): người xin được đi làm việc khác, chờ thư. Phiếu
              chờ có hạn — nói trước để họ không chờ một phiếu đã tự hết hạn. */}
          <p className="muted">
            {t('vault.pendingCanLeave')}
            {typeof verdict.data.pendingExpireHours === 'number'
              ? ` ${t('vault.pendingExpiresIn', { hours: verdict.data.pendingExpireHours })}`
              : null}
          </p>
          {/* Người xin ngồi chờ lúc 2 giờ sáng cần biết có ai được báo không — chỉ con số. */}
          {typeof verdict.data.notifiedApprovers === 'number' ? (
            <p>
              {verdict.data.notifiedApprovers > 0
                ? t('vault.pendingNotified', { count: verdict.data.notifiedApprovers })
                : t('vault.pendingNoApprover')}
            </p>
          ) : null}
          <div className="row" style={{ gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <Link to={PATHS.approval(verdict.data.pending.id)}>{t('vault.pendingDetail')}</Link>
            <button
              type="button"
              className="btn sm danger-ghost"
              disabled={cancelling}
              onClick={() => {
                const pendingId = verdict.data?.pending?.id;
                if (!pendingId) return;
                void (async () => {
                  const ok = await askConfirm({
                    title: t('common.titleOf', {
                      action: t('approvals.cancel'),
                      subject: t('vault.tab'),
                    }),
                    message: t('approvals.confirmCancel'),
                    danger: true,
                    confirmLabel: t('approvals.cancel'),
                  });
                  if (!ok) return;
                  setCancelling(true);
                  try {
                    await breakGlass.cancel(pendingId);
                    toast({ message: t('approvals.cancelled') });
                    void breakGlass.refresh();
                  } catch (error) {
                    toast({ message: errorMessage(error), tone: 'error' });
                  } finally {
                    setCancelling(false);
                  }
                })();
              }}
            >
              {t('approvals.cancel')}
            </button>
          </div>
        </div>
      ) : !isAdmin && verdict.data?.claimable ? (
        /* Đã duyệt, chưa xem lần nào (Q-15): không có nút riêng — bấm "Xem" ở ngăn như thường,
           lần xem đầu (qua mã 6 số) gắn quyền vào phiên này. Giờ đếm từ lúc duyệt. */
        <div className="alert ok" role="status">
          <p>
            <strong>{t('vault.approvedReady')}</strong>
          </p>
          {verdict.data.claimable.expiresAt && grantLeft !== null ? (
            <p>
              {t('vault.approvedReadyLeft', {
                left: leftText(grantLeft, t),
                until: formatDateTime(verdict.data.claimable.expiresAt),
              })}
            </p>
          ) : null}
          <p className="muted">{t('vault.approvedReadyNote')}</p>
          <div className="row" style={{ gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn sm danger-ghost"
              disabled={releasing}
              onClick={() => {
                const grantId = verdict.data?.claimable?.id;
                if (grantId) void releaseGrant(grantId);
              }}
            >
              {t('vault.release')}
            </button>
          </div>
        </div>
      ) : !isAdmin && verdict.data?.canRequest ? (
        /* MỘT lối xin cho cả két: quyền cấp theo HỒ SƠ, không theo ngăn — nút ở từng dòng làm
           người ta tưởng phải xin từng ngăn, hoặc xin ngăn A thì chỉ xem được A. */
        <div className="alert warn" role="status">
          {verdict.data.lastDenied ? (
            <p>
              {t('vault.lastDenied', { at: formatDateTime(verdict.data.lastDenied.at) })}
              {verdict.data.lastDenied.note ? (
                <>
                  {' '}
                  <strong>{verdict.data.lastDenied.note}</strong>
                </>
              ) : null}
            </p>
          ) : null}
          {verdict.data.otherSessionHeld ? <p>{t('vault.otherSessionHeld')}</p> : null}
          <p>{t('vault.requestBlock', { count: rows.length })}</p>
          <button type="button" className="btn primary" onClick={() => setRequesting(true)}>
            {t('vault.request')}
          </button>
        </div>
      ) : !isAdmin && verdict.data?.grant ? (
        /* Quyền đang chạy: đếm lùi + câu "hết khi đăng xuất" (Q-15) + lối tự trả quyền. */
        <div className="alert ok" role="status">
          <p>
            {/* `expiresAt` rỗng thì `formatDateTime` trả dấu gạch và câu thành "được xem tới —"
                — tự mâu thuẫn. Quyền không hạn thì nói là không hạn. */}
            {verdict.data.grant.expiresAt
              ? grantLeft !== null
                ? t('vault.grantUntilLeft', {
                    until: formatDateTime(verdict.data.grant.expiresAt),
                    left: leftText(grantLeft, t),
                  })
                : t('vault.grantUntil', { until: formatDateTime(verdict.data.grant.expiresAt) })
              : t('vault.grantNoLimit')}
          </p>
          <p className="muted">{t('vault.sessionBound')}</p>
          <div className="row" style={{ gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn sm danger-ghost"
              disabled={releasing}
              onClick={() => {
                const grantId = verdict.data?.grant?.id;
                if (grantId) void releaseGrant(grantId);
              }}
            >
              {t('vault.release')}
            </button>
          </div>
        </div>
      ) : !isAdmin && verdict.data ? (
        <p className={verdict.data.canReveal ? 'alert ok' : 'alert warn'}>
          {t(`vault.tierNote_${verdict.data.tier}`)}
        </p>
      ) : null}

      {/* Thanh công cụ của tab như Sơ đồ cổng: tiêu đề + số ngăn bên trái, nút cất bên phải,
          cùng hàng (DEV-079). Nút thường: nút chính của màn là ở đầu trang (SW-015). */}
      <div className="section-bar">
        <h3 className="form-section-title">{t('vault.sectionTitle')}</h3>
        {secrets.data ? <span className="section-count">{rows.length}</span> : null}
        {canEdit ? (
          <button type="button" className="btn" onClick={() => setEditing({ secret: null })}>
            {t('vault.add')}
          </button>
        ) : null}
      </div>

      {secrets.isLoading ? (
        <Loading />
      ) : secrets.isError ? (
        <LoadError error={secrets.error} onRetry={() => void secrets.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('vault.empty')}
          hint={
            canEdit ? t('vault.emptyHint') : locked ? t('vault.emptyLockedHint') : undefined
          }
        />
      ) : (
        <>
          {busyReason.hint}
          {/*
            BỐN CỘT, cột thao tác DÍNH PHẢI. Sáu cột ở cột nội dung ~640px đẩy nút "Xem" — lý do
            duy nhất người ta mở tab này — ra ngoài khung; Member vừa được duyệt mở ra không
            thấy nút. Loại và ghi chú là dòng phụ. "Đổi lần cuối" là cột riêng (Q-15): người đi
            xoay mật khẩu dò theo cột đó để biết ngăn nào tới hạn.
          */}
          <TableWrap>
          <table className="table table-stack vault-table">
            <thead>
              <tr>
                <th>{t('vault.label')}</th>
                <th>{t('vault.username')}</th>
                <th>{t('vault.changedCol')}</th>
                <th className="col-center col-sticky-end">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((secret) => (
                <tr key={secret.id}>
                  <td data-label={t('vault.label')} className="col-name">
                    {secret.label}
                    <span className="cell-sub">{t(`vault.kind_${secret.kind}`)}</span>
                    <SecretNote secret={secret} />
                  </td>
                  <td data-label={t('vault.username')}>
                    <span className="mono">{orDash(secret.username)}</span>
                  </td>
                  {/* Mốc đổi GIÁ TRỊ, không phải lần sửa ghi chú gần nhất — cùng hạn với khối
                      "két lâu chưa đổi" của bảng điều khiển, số ngày do server tính. */}
                  <td data-label={t('vault.changedCol')}>
                    <SecretDue changedAt={secret.valueChangedAt} dueInDays={secret.dueInDays} />
                    <span className="cell-sub">
                      {t('vault.changedBy', { who: secret.valueChangedBy ?? secret.createdBy })}
                    </span>
                  </td>
                  <td data-label={t('common.actions')} className="col-sticky-end">
                    <div className="action-cell">
                      {/* Xem được kể cả khi hồ sơ đã khóa: thiết bị thanh lý rồi vẫn có lúc
                          phải tra mật khẩu cũ để gỡ cấu hình. Khóa là khóa GHI. */}
                      {isAdmin || verdict.data?.canReveal ? (
                        <button
                          type="button"
                          className="btn sm vault-reveal"
                          disabled={opening !== null}
                          {...(opening !== secret.id ? busyReason.buttonProps : {})}
                          onClick={() => void openSecret(secret)}
                        >
                          {opening === secret.id ? t('common.loading') : t('vault.reveal')}
                        </button>
                      ) : verdict.data?.canRequest ? (
                        // Nút xin nằm MỘT chỗ ở đầu khung — dòng chỉ nói trạng thái.
                        <span className="badge warn">{t('vault.needsApproval')}</span>
                      ) : verdict.data?.pending ? (
                        /*
                         * ĐỌC `pending`, KHÔNG SUY BẰNG PHÉP LOẠI TRỪ.
                         *
                         * Để "Đang chờ duyệt" làm nhánh `else` cuối thì hôm nay vẫn
                         * đúng, vì server tính `canRequest = grant === null && pending === null`
                         * nên phần còn lại vừa khít "có phiếu treo". Nhưng đó là một sự TRÙNG
                         * KHỚP giữa hai module, không phải một hợp đồng: ngày nào
                         * `break-glass.service.ts` thêm một lý do thứ ba làm `canRequest` sai
                         * (trần số phiếu, chủ thể bị đóng băng, người dùng bị khoá) thì badge
                         * nói dối — im lặng, và không gì đỏ.
                         *
                         * Server đã gửi hẳn `pending` sang. Đọc nó là đọc sự thật.
                         */
                        <span className="badge warn">{t('vault.awaitingApproval')}</span>
                      ) : (
                        <span className="badge">{t('vault.cannotReveal')}</span>
                      )}
                      {/*
                        "Xem" ở NGOÀI, ba việc còn lại vào menu — mẫu "nút chính + tràn".
                        Xem chính là lý do người ta mở tab két sắt; giấu nó sau một cú bấm là
                        trả giá đúng chỗ không nên trả. Còn Sửa · Xoay · Xóa là việc thỉnh
                        thoảng, và ba nút xám cạnh nhau làm mờ luôn cái nút quan trọng nhất.
                      */}
                      {canEdit ? (
                        <RowActions
                          label={t('common.actionsOf', { subject: secret.label })}
                          subject={secret.label}
                          items={[
                            {
                              key: 'edit',
                              label: t('vault.edit'),
                              onSelect: () => setEditing({ secret }),
                            },
                            {
                              key: 'rotate',
                              label: t(`vault.rotate_${secret.kind}`),
                              onSelect: () => setRotating(secret),
                            },
                            {
                              key: 'revoke',
                              label: t('vault.revoke'),
                              danger: true,
                              disabled: revoke.isPending,
                              onSelect: () => {
                                void (async () => {
                                  /* Không hoàn tác được — một cú bấm trên menu ⋯ không được
                                     đủ để mất một mật khẩu: gõ lại đúng tên ngăn. */
                                  const ok = await askConfirm({
                                    title: t('common.titleOf', {
                                      action: t('vault.revoke'),
                                      subject: secret.label,
                                    }),
                                    message: t('vault.confirmRevoke', { label: secret.label }),
                                    danger: true,
                                    confirmLabel: t('vault.revoke'),
                                    typeToConfirm: {
                                      expected: secret.label,
                                      label: t('vault.typeLabelToConfirm', { label: secret.label }),
                                    },
                                  });
                                  if (!ok) return;
                                  try {
                                    // Thu hồi đòi step-up: gặp `STEPUP_REQUIRED` thì
                                    // hỏi mã rồi làm lại chính việc này.
                                    await writeStepUp.run(
                                      () => revoke.mutateAsync({ id: secret.id }),
                                      t('vault.stepUpRevoke', { label: secret.label }),
                                    );
                                    toast({ message: t('vault.revoked') });
                                    void refresh();
                                  } catch (error) {
                                    // Người dùng đóng hộp hỏi mã = hủy, không phải lỗi.
                                    if ((error as Error).message === 'STEPUP_CANCELLED') return;
                                    toast({ message: errorMessage(error), tone: 'error' });
                                  }
                                })();
                              },
                            },
                          ]}
                        />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableWrap>
        </>
      )}

      {editing ? (
        <SecretForm
          secret={editing.secret}
          ownerLabel={ownerLabel}
          ownerType={ownerType}
          ownerId={ownerId}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast({ message: t('vault.saved') });
            void refresh();
          }}
        />
      ) : null}

      {writeStepUp.dialog}

      {pendingStepUp && !stepsInline ? (
        <StepUpDialog
          csrfToken={me.csrfToken}
          purpose={stepUpPurpose}
          graceMinutes={me.config?.stepUpGraceMinutes}
          onClose={() => setPendingStepUp(null)}
          onDone={afterStepUp}
        />
      ) : null}

      {revealed && !stepsInline ? (
        <RevealDialog
          label={revealed.label}
          username={revealed.username}
          value={revealed.value}
          totp={revealed.totp}
          seconds={revealed.seconds}
          stepUpSecondsLeft={revealed.stepUpSecondsLeft}
          onClose={() => setRevealed(null)}
          onExpire={onRevealExpire}
        />
      ) : null}

      {requesting ? (
        <BreakGlassDialog
          ownerType={ownerType}
          ownerId={ownerId}
          secretCount={rows.length}
          maxGrantHours={verdict.data?.maxGrantHours ?? null}
          csrfToken={me.csrfToken}
          onClose={() => setRequesting(false)}
          onSent={({ askedHours, grantedHours }) => {
            setRequesting(false);
            // Trần hệ thống có thể kẹp số giờ xuống thấp hơn số người dùng gõ — im lặng
            // toast chung chung thì họ tưởng mình được đúng số giờ đã xin.
            toast(
              grantedHours !== askedHours
                ? { message: t('vault.requestHoursClamped', { hours: grantedHours }), tone: 'warn' }
                : { message: t('vault.requestSent') },
            );
            void queryClient.invalidateQueries({ queryKey: ['vault', 'verdict'] });
          }}
        />
      ) : null}

      {rotating ? (
        <RotateForm
          secret={rotating}
          csrfToken={me.csrfToken}
          onClose={() => setRotating(null)}
          onSaved={() => {
            setRotating(null);
            toast({ message: t(`vault.rotated_${rotating.kind}`) });
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

const KINDS: SecretKind[] = ['password', 'license_key', 'totp', 'other'];

/**
 * Thêm mới mang theo plaintext; SỬA thì không.
 *
 * Tách hẳn hai đường (sửa nhãn ≠ xoay giá trị) để form đổi một cái ghi chú không bao giờ phải
 * cầm mật khẩu trong state — và cũng không cần tải plaintext về chỉ để hiện lại trong ô.
 */
function SecretForm({
  secret,
  ownerLabel,
  ownerType,
  ownerId,
  csrfToken,
  onClose,
  onSaved,
}: {
  secret: SecretMeta | null;
  ownerLabel?: string;
  ownerType: SecretOwnerType;
  ownerId: string;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(secret?.label ?? '');
  const [kind, setKind] = useState<SecretKind>(secret?.kind ?? 'password');
  const [username, setUsername] = useState(secret?.username ?? '');
  const [note, setNote] = useState(secret?.note ?? '');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isEdit = secret !== null;
  /* Báo ngay khi gõ chứ không đợi bấm Lưu: bấm Lưu là qua mã 6 số rồi mới bị server từ chối.
     Server vẫn là nơi phán (Q-18) — đây là bản chép có cổng của cùng luật. */
  const noteError = noteContainsSecret(note, value)
    ? t('vault.noteContainsSecret')
    : noteLooksLikeSecret(note)
      ? t('vault.noteLooksLikeSecret')
      : null;
  const check = useFormErrors({
    label: !label.trim() && t('vault.labelRequired'),
    value: !isEdit && !value && t('vault.valueRequired'),
    note: noteError,
  });

  const save = useApiMutation<Record<string, unknown>, unknown>(
    isEdit ? `/api/v1/vault/secrets/${secret.id}` : '/api/v1/vault/secrets',
    { method: isEdit ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );
  /** Cất/sửa bí mật đòi step-up. */
  const stepUp = useStepUpRetry(csrfToken);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền / bấm Hủy: hộp biến mất nhưng lượt
         ghi vẫn chạy tiếp, `onSaved()` không bao giờ chạy — không toast, không refresh — nên
         người dùng tin là đã hủy trong khi secret đã vào két. */
      dismissible={!save.isPending}
      maxWidth={560}
      /* Một mẫu tiêu đề cho mọi hộp: "{Việc} — {chủ thể}" (DEV-035). */
      title={
        isEdit
          ? t('common.titleOf', { action: t('vault.edit'), subject: secret.label })
          : ownerLabel
            ? t('common.titleOf', { action: t('vault.add'), subject: ownerLabel })
            : t('vault.add')
      }
      footer={
        <>
          <button type="button" className="btn" disabled={save.isPending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="secret-form" className="btn primary" disabled={save.isPending}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="secret-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          void (async () => {
            try {
              await stepUp.run(() =>
                save.mutateAsync(
                  isEdit
                    ? { label: label.trim(), username: username.trim(), note: note.trim() }
                    : {
                        ownerType,
                        ownerId,
                        kind,
                        label: label.trim(),
                        username: username.trim(),
                        note: note.trim(),
                        value,
                      },
                ),
                t(isEdit ? 'vault.stepUpEdit' : 'vault.stepUpSave', { label: label.trim() }),
              );
              setValue('');
              onSaved();
            } catch (err) {
              if ((err as Error).message === 'STEPUP_CANCELLED') return;
              setError(errorMessage(err));
            }
          })();
        }}
      >
        {check.summary}
        <Field label={t('vault.label')} required htmlFor="secret-label" error={check.error('label')}>
          <input
            id="secret-label"
            className="inp"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>

        {!isEdit ? (
          <Field label={t('vault.kind')}>
            <Select
              value={kind}
              onChange={(next) => setKind(next as SecretKind)}
              ariaLabel={t('vault.kind')}
              options={KINDS.map((item) => ({ value: item, label: t(`vault.kind_${item}`) }))}
            />
          </Field>
        ) : null}

        <Field label={t('vault.username')} htmlFor="secret-username">
          <input
            id="secret-username"
            className="inp"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>

        {!isEdit ? (
          <Field
            label={t('vault.value')}
            required
            hint={t(kind === 'totp' ? 'vault.totpValueHint' : 'vault.valueHint')}
            htmlFor="secret-value"
            error={check.error('value')}
          >
            {/* Nhiều con (ô + nút + thanh đo) nên `Field` không tự gắn được — nối tay theo đúng
                id nó sinh. License key thì hiện sẵn: 25 ký tự gõ mù gần như chắc sai. */}
            <SecretValueInput
              key={kind}
              id="secret-value"
              value={value}
              onChange={setValue}
              invalid={Boolean(check.error('value'))}
              describedBy={
                check.error('value') ? 'secret-value-error secret-value-hint' : 'secret-value-hint'
              }
              initiallyShown={kind === 'license_key'}
              allowGenerate={kind === 'password'}
              qrImport={kind === 'totp'}
            />
            {kind === 'password' ? <SecretStrengthMeter value={value} /> : null}
          </Field>
        ) : null}

        {/* FR-035: ghi chú KHÔNG được chứa mật khẩu — nói thẳng ngay tại ô nhập. */}
        <Field
          label={t('vault.note')}
          hint={t('vault.noteHint')}
          htmlFor="secret-note"
          error={noteError ?? undefined}
        >
          <textarea
            id="secret-note"
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
      {/* Hộp hỏi mã 6 số khi server đòi step-up — chỉ hiện khi cần. */}
      {stepUp.dialog}
    </Dialog>
  );
}

/**
 * Ghi chú của một ngăn — gập sẵn, bấm mới mở (SEC-20).
 *
 * Không in thẳng dưới tên ngăn: bảng két hay được mở trước mặt người khác, và ghi chú là cột
 * dạng rõ. Nút mang chữ "Ghi chú" chứ không phải "Xem ghi chú": các bài kiểm và người dùng tìm
 * nút "Xem" (mở giá trị) theo tên, hai nút cùng chữ "Xem" trên một dòng là nhầm nút.
 * Không dùng `title`: rê chuột mới đọc được, bàn phím và cảm ứng không bao giờ thấy.
 */
function SecretNote({ secret }: { secret: SecretMeta }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelId = `secret-note-${secret.id}`;
  if (secret.note) {
    return (
      <>
        <button
          type="button"
          className="btn sm ghost with-icon"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        >
          {t('vault.noteToggle')}
          <Chevron direction={open ? 'up' : 'down'} />
        </button>
        {/* Dựng khi mở chứ không dùng `hidden`: `.cell-sub { display: block }` đè luật
            `[hidden]` của trình duyệt, chữ sẽ hiện dù đang "ẩn". */}
        {open ? (
          <span id={panelId} className="cell-sub">
            {secret.note}
          </span>
        ) : null}
      </>
    );
  }
  return secret.hasNote ? <span className="cell-sub">{t('vault.noteHidden')}</span> : null;
}

function RotateForm({
  secret,
  csrfToken,
  onClose,
  onSaved,
}: {
  secret: SecretMeta;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const check = useFormErrors({
    value: !value
      ? t('vault.valueRequired')
      : noteContainsSecret(secret.note, value) && t('vault.rotateValueInNote'),
  });

  const rotate = useApiMutation<{ value: string }, unknown>(
    `/api/v1/vault/secrets/${secret.id}/rotate`,
    { csrfToken, refreshMe: false },
  );
  /** Xoay bí mật đòi step-up. */
  const stepUp = useStepUpRetry(csrfToken);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Hộp nguy hiểm nhất trong ba hộp: xoay xong là giá trị CŨ không đọc lại được nữa. Đóng
         nhầm lúc POST đang bay = người dùng tin là đã hủy, trong khi mật khẩu họ đang dán vào
         cấu hình thiết bị vừa hết hiệu lực. */
      dismissible={!rotate.isPending}
      maxWidth={480}
      title={t('common.titleOf', { action: t(`vault.rotate_${secret.kind}`), subject: secret.label })}
      footer={
        <>
          <button type="button" className="btn" disabled={rotate.isPending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="rotate-form" className="btn primary" disabled={rotate.isPending}>
            {rotate.isPending ? t('common.loading') : t(`vault.rotate_${secret.kind}`)}
          </button>
        </>
      }
    >
      <form
        id="rotate-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          void (async () => {
            try {
              await stepUp.run(
                () => rotate.mutateAsync({ value }),
                t(`vault.stepUpRotate_${secret.kind}`),
              );
              setValue('');
              onSaved();
            } catch (err) {
              if ((err as Error).message === 'STEPUP_CANCELLED') return;
              setError(errorMessage(err));
            }
          })();
        }}
      >
        <p className="muted">{t('vault.rotateHint')}</p>
        {/* Thứ tự an toàn: đổi trên hệ thống thật và đăng nhập thử TRƯỚC, rồi mới lưu ở đây —
            lưu trước mà đổi trên máy hỏng là mất cả giá trị cũ lẫn đường vào thiết bị. Nhắc
            với MỌI loại ngăn (Q-15): IMS không nối tới đâu, license key cũng phải đổi ở nơi
            cấp trước. Chỉ cảnh báo, không bắt tick. */}
        <p className="alert warn">{t('vault.rotateOrder')}</p>
        <Field
          label={t('vault.newValue')}
          required
          htmlFor="secret-new-value"
          error={check.error('value')}
        >
          {/* Nhiều con (ô + nút + thanh đo) nên `Field` không tự gắn được — nối tay theo đúng id. */}
          <SecretValueInput
            id="secret-new-value"
            value={value}
            onChange={setValue}
            invalid={Boolean(check.error('value'))}
            describedBy={check.error('value') ? 'secret-new-value-error' : undefined}
            initiallyShown={secret.kind === 'license_key'}
            allowGenerate={secret.kind === 'password'}
            qrImport={secret.kind === 'totp'}
          />
          {/* Đổi mật khẩu là lúc người ta ĐẶT một giá trị mới, không phải chép lại cái đang
              có — nên thanh đo ở đây còn đáng nói hơn ở ô cất lần đầu. */}
          {secret.kind === 'password' ? <SecretStrengthMeter value={value} /> : null}
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      {/* Hộp hỏi mã 6 số khi server đòi step-up — chỉ hiện khi cần. */}
      {stepUp.dialog}
    </Dialog>
  );
}

/** "3 giờ 52 phút" / "12 phút" / "45 giây" — đơn vị lớn nhất còn khác 0 quyết định cách nói. */
function leftText(seconds: number, t: (key: string, options?: Record<string, unknown>) => string) {
  const parts = remainingParts(seconds);
  if (parts.hours > 0) return t('vault.leftHm', parts);
  if (parts.minutes > 0) return t('vault.leftM', parts);
  return t('vault.leftS', parts);
}

/**
 * Xin quyền xem tạm thời (FR-023).
 *
 * Hai ô, và cả hai đều bắt buộc vì cả hai đều là thứ người duyệt cần để quyết: LÝ DO (xin để
 * làm gì) và THỜI HẠN (bao lâu là đủ). Trần thật nằm ở `breakglass.max_grant_hours` và server
 * KẸP theo nó — người xin gõ 72 thì được 24 và được nói rõ, chứ không bị từ chối rồi phải
 * đoán lại con số đúng.
 */
/** Server đọc lại giới hạn — client chỉ cần khớp con số tối thiểu để không hỏi lại người dùng vô ích. */
const REQUEST_REASON_MIN_LEN = 5;

function BreakGlassDialog({
  ownerType,
  ownerId,
  secretCount,
  maxGrantHours,
  csrfToken,
  onClose,
  onSent,
}: {
  ownerType: SecretOwnerType;
  ownerId: string;
  /** Số ngăn của két — quyền cấp cho CẢ két, nên tiêu đề nói rõ đang xin bao nhiêu ngăn. */
  secretCount: number;
  /** Trần giờ server đưa; `null` = chưa biết, chỉ đưa các nấc ngắn. */
  maxGrantHours: number | null;
  csrfToken: string;
  onClose: () => void;
  onSent: (info: { askedHours: number; grantedHours: number }) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('4');
  const [error, setError] = useState<string | null>(null);
  /* Không âm thầm đổi "2 tiếng" thành 4 giờ: người xin phải biết con số mình gửi đi. */
  const askedHours = Number(hours.trim());
  const check = useFormErrors({
    reason:
      (reason.trim().length < REQUEST_REASON_MIN_LEN && t('vault.requestReasonRequired')) ||
      secretTextRule(t, reason),
    hours: (!Number.isInteger(askedHours) || askedHours <= 0) && t('vault.requestHoursInvalid'),
  });

  /* Server trả về PHIẾU vừa tạo — số giờ (đã kẹp theo trần) nằm ở `payload.hours`. */
  const send = useApiMutation<Record<string, unknown>, Pick<BreakGlassRow, 'id' | 'payload'>>(
    '/api/v1/vault/break-glass',
    { csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đóng lúc yêu cầu đang bay thì phiếu vẫn được tạo và Quản trị vẫn nhận email, nhưng
         người xin không thấy toast nào — họ gửi lại lần nữa, và người duyệt nhận hai phiếu. */
      dismissible={!send.isPending}
      maxWidth={480}
      title={t('vault.requestTitleCount', { count: secretCount })}
      footer={
        <>
          <button type="button" className="btn" disabled={send.isPending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="break-glass-form" className="btn primary" disabled={send.isPending}>
            {send.isPending ? t('common.loading') : t('vault.requestSend')}
          </button>
        </>
      }
    >
      <form
        id="break-glass-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          send.mutate(
            { ownerType, ownerId, reason: reason.trim(), hours: askedHours },
            {
              onSuccess: (result) =>
                onSent({ askedHours, grantedHours: result.payload?.hours ?? askedHours }),
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        <p className="muted">{t('vault.requestHint')}</p>
        <p className="muted">{t('vault.requestSessionNote')}</p>

        <Field
          label={t('vault.requestReason')}
          required
          htmlFor="bg-reason"
          error={check.error('reason')}
        >
          <textarea
            id="bg-reason"
            className="inp"
            rows={2}
            placeholder={t('vault.requestReasonPlaceholder')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {/* Bộ đếm để người xin biết còn thiếu bao nhiêu trước khi bấm Gửi, không phải sau. */}
        <p className="field-hint" aria-live="polite">
          {t('vault.requestReasonCount', {
            count: reason.trim().length,
            min: REQUEST_REASON_MIN_LEN,
          })}
        </p>

        <div className="segmented" role="group" aria-label={t('vault.requestHoursQuick')}>
          {hourSteps(maxGrantHours).map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={askedHours === h}
              onClick={() => setHours(String(h))}
            >
              {t('approvals.hours', { hours: h })}
            </button>
          ))}
        </div>

        <Field
          label={t('vault.requestHours')}
          required
          hint={
            maxGrantHours
              ? t('vault.requestHoursHintMax', { hours: maxGrantHours })
              : t('vault.requestHoursHint')
          }
          htmlFor="bg-hours"
          error={check.error('hours')}
        >
          <input
            id="bg-hours"
            className="inp"
            required
            inputMode="numeric"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
