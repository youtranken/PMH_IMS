import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorCode, errorMessage, useApiMutation } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { formatDateTime, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { Dialog, DialogTitle } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { RevealDialog } from '@/ui/reveal-dialog';
import { StepUpDialog } from '@/ui/step-up-dialog';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';

export type SecretOwnerType = 'device' | 'software';
export type SecretKind = 'password' | 'license_key' | 'other';

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
  const [revealed, setRevealed] = useState<
    { label: string; value: string; seconds: number } | null
  >(null);

  // Chỉ SA/Admin có quyền tới endpoint két sắt (AD-9). Member thấy lời giải thích, không
  // thấy bảng trống kèm một lỗi 403 lặng lẽ trong console.
  const allowed = me.role === 'sa' || me.role === 'admin';
  const queryKey = ['vault', ownerType, ownerId];

  const secrets = useQuery({
    queryKey,
    queryFn: () =>
      apiFetch<SecretMeta[]>(
        `/api/v1/vault/secrets?ownerType=${ownerType}&ownerId=${encodeURIComponent(ownerId)}`,
      ),
    enabled: allowed,
  });

  const revoke = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/vault/secrets/${input.id}`,
    { method: 'DELETE', csrfToken: me.csrfToken, refreshMe: false, body: () => undefined },
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  /**
   * Mở két. KHÔNG tự đoán "còn trong grace hay chưa" ở client: cứ gọi, gặp
   * `STEPUP_REQUIRED` thì hỏi mã rồi thử lại đúng secret đó. Đồng hồ máy người dùng lệch,
   * hay admin vừa đổi `secret.stepup_grace_minutes`, đều không làm sai luồng này.
   */
  const openSecret = useCallback(
    async (secret: SecretMeta, afterStepUp = false) => {
      try {
        const opened = await apiFetch<{ value: string; revealSeconds: number }>(
          `/api/v1/vault/secrets/${secret.id}/reveal`,
          { method: 'POST', csrfToken: me.csrfToken },
        );
        setRevealed({ label: secret.label, value: opened.value, seconds: opened.revealSeconds });
      } catch (error) {
        if (!afterStepUp && errorCode(error) === 'STEPUP_REQUIRED') {
          setPendingStepUp(secret);
          return;
        }
        toast({ message: errorMessage(error), tone: 'error' });
      }
    },
    [me.csrfToken, toast],
  );

  if (!allowed) return <p className="alert">{t('vault.noPermission')}</p>;

  const rows = secrets.data ?? [];

  return (
    <div className="attachment-panel">
      <p className="muted">{t('vault.intro')}</p>

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
        <LoadError onRetry={() => void secrets.refetch()} />
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
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => void openSecret(secret)}
                      >
                        {t('vault.reveal')}
                      </button>
                      {canEdit ? (
                        <>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setEditing({ secret })}
                        >
                          {t('vault.edit')}
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setRotating(secret)}
                        >
                          {t('vault.rotate')}
                        </button>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={() => {
                            void (async () => {
                              const ok = await askConfirm({
                                message: t('vault.confirmRevoke', { label: secret.label }),
                                danger: true,
                              });
                              if (!ok) return;
                              revoke.mutate(
                                { id: secret.id },
                                {
                                  onSuccess: () => {
                                    toast({ message: t('vault.revoked') });
                                    void refresh();
                                  },
                                  onError: (error) =>
                                    toast({ message: errorMessage(error), tone: 'error' }),
                                },
                              );
                            })();
                          }}
                        >
                          {t('vault.revoke')}
                        </button>
                        </>
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
          onClose={() => setRevealed(null)}
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

  return (
    <Dialog open onOpenChange={onClose} maxWidth={560}>
      <DialogTitle>{isEdit ? t('vault.edit') : t('vault.add')}</DialogTitle>
      <form
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
          save.mutate(
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
            {
              onSuccess: () => {
                setValue('');
                onSaved();
              },
              onError: (err) => setError(errorMessage(err)),
            },
          );
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

        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={save.isPending}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </form>
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

  return (
    <Dialog open onOpenChange={onClose} maxWidth={480}>
      <DialogTitle>{t('vault.rotateTitle', { label: secret.label })}</DialogTitle>
      <form
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!value) {
            setError(t('vault.valueRequired'));
            return;
          }
          rotate.mutate(
            { value },
            {
              onSuccess: () => {
                setValue('');
                onSaved();
              },
              onError: (err) => setError(errorMessage(err)),
            },
          );
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
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--space-3)' }}>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={rotate.isPending}>
            {rotate.isPending ? t('common.loading') : t('vault.rotate')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

