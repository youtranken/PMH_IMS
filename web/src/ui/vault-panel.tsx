import { useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorCode, errorMessage, useApiMutation } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { formatDateTime, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import type { SecretOwnerType } from '@/lib/secret-owner-kinds';
import { Dialog } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { RowActions } from '@/ui/row-actions';
import { Select } from '@/ui/select';
import { RevealDialog } from '@/ui/reveal-dialog';
import { SecretStrengthMeter } from '@/ui/secret-strength-meter';
import { StepUpDialog } from '@/ui/step-up-dialog';
import { useStepUpRetry } from '@/ui/use-step-up-retry';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';

/*
 * Danh sách loại chủ thể đã dọn về `lib/secret-owner-kinds.ts` (12/09) — ở đó nó đứng cạnh
 * bảng nhãn và có bài điểm danh đối chiếu thẳng mã nguồn API. Re-export để mọi nơi đang
 * `import type { SecretOwnerType } from '@/ui/vault-panel'` vẫn đúng, mà chỉ còn MỘT khai báo.
 */
export type { SecretOwnerType };
export type SecretKind = 'password' | 'license_key' | 'other';

export interface AccessVerdict {
  tier: 'whitelist' | 'needs_approval' | 'denied';
  tierLabel: string;
  canReveal: boolean;
  canRequest: boolean;
  grant: { id: string; expiresAt: string | null } | null;
  pending: { id: string } | null;
}

export interface SecretMeta {
  id: string;
  ownerType: SecretOwnerType;
  ownerId: string;
  kind: SecretKind;
  label: string;
  username: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function secretsKey(ownerType: SecretOwnerType, ownerId: string) {
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
   * "Tôi làm được gì với chủ thể này" (story 6.3) — MỘT lần gọi, server phán.
   *
   * Client không tự suy từ vai: quyền của Member đến từ ma trận 6.2 cộng với grant còn
   * hạn, và cả hai đổi được bất cứ lúc nào mà trình duyệt không hay biết.
   */
  const verdict = useQuery({
    queryKey: ['vault', 'verdict', ownerType, ownerId],
    queryFn: () =>
      apiFetch<AccessVerdict>(
        `/api/v1/vault/secrets/verdict?ownerType=${ownerType}&ownerId=${encodeURIComponent(ownerId)}`,
      ),
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
 * Két sắt dùng chung (story 4.1, FR-021/FR-026, AD-15).
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
}: {
  ownerType: SecretOwnerType;
  ownerId: string;
  me: Me;
  canEdit?: boolean;
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
  const [requesting, setRequesting] = useState(false);
  const [revealed, setRevealed] = useState<
    { label: string; value: string; seconds: number; stepUpSecondsLeft: number } | null
  >(null);
  const openingRef = useRef<string | null>(null);

  const queryKey = secretsKey(ownerType, ownerId);
  const { verdict, secrets, allowed, isAdmin } = useOwnerSecrets(ownerType, ownerId, me);

  const revoke = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/vault/secrets/${input.id}`,
    { method: 'DELETE', csrfToken: me.csrfToken, refreshMe: false, body: () => undefined },
  );

  /** Ghi vào két nay đòi step-up (C2) — hook lo phần hỏi mã rồi làm lại. */
  const writeStepUp = useStepUpRetry(me.csrfToken);

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
          revealSeconds: number;
          /** Grace step-up còn lại — server tính, client không tự đoán được (xem session-policy). */
          stepUpSecondsLeft: number;
        }>(
          `/api/v1/vault/secrets/${secret.id}/reveal`,
          { method: 'POST', csrfToken: me.csrfToken },
        );
        setRevealed({
          label: secret.label,
          value: opened.value,
          seconds: opened.revealSeconds,
          stepUpSecondsLeft: opened.stepUpSecondsLeft,
        });
      } catch (error) {
        if (!afterStepUp && errorCode(error) === 'STEPUP_REQUIRED') {
          setPendingStepUp(secret);
          return;
        }
        toast({ message: errorMessage(error), tone: 'error' });
      } finally {
        openingRef.current = null;
        setOpening(null);
      }
    },
    [me.csrfToken, toast],
  );

  if (verdict.isLoading) return <Loading />;
  /**
   * Lỗi tải verdict KHÔNG được rơi xuống thành "bạn không có quyền".
   *
   * Đúng cái bẫy vừa gặp: URL sai → 404 → `verdict.data` undefined → panel nói "chỉ Quản trị
   * xem được", và thông điệp đó nghe hợp lý tới mức che mất một lỗi 404. Sai vì thiếu quyền
   * và sai vì hỏng phải nói ra hai câu khác nhau.
   */
  if (verdict.isError) return <LoadError error={verdict.error} onRetry={() => void verdict.refetch()} />;
  if (!allowed) return <p className="alert">{t('vault.noPermission')}</p>;

  const rows = secrets.data ?? [];

  return (
    <div className="attachment-panel">
      <p className="muted">{t('vault.intro')}</p>

      {/* Member phải THẤY mình đang ở tầng nào — không thì họ bấm Xem, bị từ chối, và
          không hiểu vì sao. */}
      {!isAdmin && verdict.data ? (
        <p className={verdict.data.canReveal ? 'alert' : 'alert warn'}>
          {verdict.data.grant
            ? t('vault.grantUntil', {
                until: formatDateTime(verdict.data.grant.expiresAt ?? ''),
              })
            : t(`vault.tierNote_${verdict.data.tier}`)}
        </p>
      ) : null}

      {canEdit ? (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => setEditing({ secret: null })}
          >
            {t('vault.add')}
          </button>
        </div>
      ) : null}

      {secrets.isLoading ? (
        <Loading />
      ) : secrets.isError ? (
        <LoadError error={secrets.error} onRetry={() => void secrets.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('vault.empty')} hint={t('vault.emptyHint')} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('vault.label')}</th>
                <th>{t('vault.kind')}</th>
                <th>{t('vault.username')}</th>
                <th>{t('vault.note')}</th>
                <th>{t('vault.updatedAt')}</th>
                <th className="col-center">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((secret) => (
                <tr key={secret.id}>
                  <td data-label={t('vault.label')}>{secret.label}</td>
                  <td data-label={t('vault.kind')}>{t(`vault.kind_${secret.kind}`)}</td>
                  <td data-label={t('vault.username')}>
                    <span className="mono">{orDash(secret.username)}</span>
                  </td>
                  <td data-label={t('vault.note')}>{orDash(secret.note)}</td>
                  <td data-label={t('vault.updatedAt')}>{formatDateTime(secret.updatedAt)}</td>
                  <td>
                    <div className="action-cell">
                      {/* Xem được kể cả khi hồ sơ đã khóa: thiết bị thanh lý rồi vẫn có lúc
                          phải tra mật khẩu cũ để gỡ cấu hình. Khóa là khóa GHI. */}
                      {isAdmin || verdict.data?.canReveal ? (
                        <button
                          type="button"
                          className="btn sm"
                          disabled={opening !== null}
                          onClick={() => void openSecret(secret)}
                        >
                          {opening === secret.id ? t('common.loading') : t('vault.reveal')}
                        </button>
                      ) : verdict.data?.canRequest ? (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setRequesting(true)}
                        >
                          {t('vault.request')}
                        </button>
                      ) : (
                        <span className="badge warn">{t('vault.awaitingApproval')}</span>
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
                          items={[
                            {
                              key: 'edit',
                              label: t('vault.edit'),
                              onSelect: () => setEditing({ secret }),
                            },
                            {
                              key: 'rotate',
                              label: t('vault.rotate'),
                              onSelect: () => setRotating(secret),
                            },
                            {
                              key: 'revoke',
                              label: t('vault.revoke'),
                              danger: true,
                              disabled: revoke.isPending,
                              onSelect: () => {
                                void (async () => {
                                  const ok = await askConfirm({
                                    message: t('vault.confirmRevoke', { label: secret.label }),
                                    danger: true,
                                    confirmLabel: t('vault.revoke'),
                                  });
                                  if (!ok) return;
                                  try {
                                    // Thu hồi nay đòi step-up (C2): gặp `STEPUP_REQUIRED` thì
                                    // hỏi mã rồi làm lại chính việc này.
                                    await writeStepUp.run(() =>
                                      revoke.mutateAsync({ id: secret.id }),
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
        </div>
      )}

      {editing ? (
        <SecretForm
          secret={editing.secret}
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

      {pendingStepUp ? (
        <StepUpDialog
          csrfToken={me.csrfToken}
          onClose={() => setPendingStepUp(null)}
          onDone={() => {
            const secret = pendingStepUp;
            setPendingStepUp(null);
            // `afterStepUp` = true: gõ mã xong mà vẫn bị đòi mã nữa thì đó là lỗi thật,
            // không phải chuyện để hỏi lại vòng hai — nếu không sẽ thành vòng lặp hộp thoại.
            void openSecret(secret, true);
          }}
        />
      ) : null}

      {revealed ? (
        <RevealDialog
          label={revealed.label}
          value={revealed.value}
          seconds={revealed.seconds}
          stepUpSecondsLeft={revealed.stepUpSecondsLeft}
          onClose={() => setRevealed(null)}
        />
      ) : null}

      {requesting ? (
        <BreakGlassDialog
          ownerType={ownerType}
          ownerId={ownerId}
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
            toast({ message: t('vault.rotated') });
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

const KINDS: SecretKind[] = ['password', 'license_key', 'other'];

/**
 * Thêm mới mang theo plaintext; SỬA thì không.
 *
 * Tách hẳn hai đường (sửa nhãn ≠ xoay giá trị) để form đổi một cái ghi chú không bao giờ phải
 * cầm mật khẩu trong state — và cũng không cần tải plaintext về chỉ để hiện lại trong ô.
 */
function SecretForm({
  secret,
  ownerType,
  ownerId,
  csrfToken,
  onClose,
  onSaved,
}: {
  secret: SecretMeta | null;
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

  const save = useApiMutation<Record<string, unknown>, unknown>(
    isEdit ? `/api/v1/vault/secrets/${secret.id}` : '/api/v1/vault/secrets',
    { method: isEdit ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );
  /** Cất/sửa bí mật nay đòi step-up (C2). */
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
      title={isEdit ? t('vault.edit') : t('vault.add')}
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
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!label.trim()) {
            setError(t('vault.labelRequired'));
            return;
          }
          if (!isEdit && !value) {
            setError(t('vault.valueRequired'));
            return;
          }
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
        <Field label={t('vault.label')} required htmlFor="secret-label">
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
            hint={t('vault.valueHint')}
            htmlFor="secret-value"
          >
            <input
              id="secret-value"
              className="inp mono"
              type="password"
              autoComplete="new-password"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <SecretStrengthMeter value={value} />
          </Field>
        ) : null}

        {/* FR-035: ghi chú KHÔNG được chứa mật khẩu — nói thẳng ngay tại ô nhập. */}
        <Field label={t('vault.note')} hint={t('vault.noteHint')} htmlFor="secret-note">
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
      {/* Hộp hỏi mã 6 số khi server đòi step-up (C2) — chỉ hiện khi cần. */}
      {stepUp.dialog}
    </Dialog>
  );
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

  const rotate = useApiMutation<{ value: string }, unknown>(
    `/api/v1/vault/secrets/${secret.id}/rotate`,
    { csrfToken, refreshMe: false },
  );
  /** Xoay bí mật nay đòi step-up (C2). */
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
      title={t('vault.rotateTitle', { label: secret.label })}
      footer={
        <>
          <button type="button" className="btn" disabled={rotate.isPending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="rotate-form" className="btn primary" disabled={rotate.isPending}>
            {rotate.isPending ? t('common.loading') : t('vault.rotate')}
          </button>
        </>
      }
    >
      <form
        id="rotate-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!value) {
            setError(t('vault.valueRequired'));
            return;
          }
          void (async () => {
            try {
              await stepUp.run(() => rotate.mutateAsync({ value }));
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
        <Field label={t('vault.newValue')} required htmlFor="secret-new-value">
          <input
            id="secret-new-value"
            className="inp mono"
            type="password"
            autoComplete="new-password"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {/* Xoay mật khẩu là lúc người ta ĐẶT một giá trị mới, không phải chép lại cái đang
              có — nên thanh đo ở đây còn đáng nói hơn ở ô cất lần đầu. */}
          <SecretStrengthMeter value={value} />
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      {/* Hộp hỏi mã 6 số khi server đòi step-up (C2) — chỉ hiện khi cần. */}
      {stepUp.dialog}
    </Dialog>
  );
}

/**
 * Xin quyền xem tạm thời (story 6.3, FR-023).
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
  csrfToken,
  onClose,
  onSent,
}: {
  ownerType: SecretOwnerType;
  ownerId: string;
  csrfToken: string;
  onClose: () => void;
  onSent: (info: { askedHours: number; grantedHours: number }) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('4');
  const [error, setError] = useState<string | null>(null);

  const send = useApiMutation<Record<string, unknown>, { hours: number }>(
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
      title={t('vault.requestTitle')}
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
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const trimmedReason = reason.trim();
          // `minLength` của trình duyệt báo lỗi bằng tiếng Anh — validate tay để dùng câu
          // tiếng Việt đã có sẵn trong vi.ts (vault.requestReasonRequired).
          if (trimmedReason.length < REQUEST_REASON_MIN_LEN) {
            setError(t('vault.requestReasonRequired'));
            return;
          }
          const askedHours = Number(hours) || 4;
          send.mutate(
            { ownerType, ownerId, reason: trimmedReason, hours: askedHours },
            {
              onSuccess: (result) => onSent({ askedHours, grantedHours: result.hours }),
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        <p className="muted">{t('vault.requestHint')}</p>

        <Field label={t('vault.requestReason')} required htmlFor="bg-reason">
          <textarea
            id="bg-reason"
            className="inp"
            rows={2}
            placeholder={t('vault.requestReasonPlaceholder')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        <Field label={t('vault.requestHours')} required hint={t('vault.requestHoursHint')} htmlFor="bg-hours">
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
