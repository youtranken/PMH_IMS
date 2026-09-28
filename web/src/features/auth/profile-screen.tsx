import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router-dom';
import { errorMessage, useApiMutation } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { formatDate, formatDateTime, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { useConfirm } from '@/ui/confirm-provider';
import { Dialog } from '@/ui/dialog';
import { LoadError, Loading } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { SessionList, type SessionItem } from '@/ui/session-list';
import { ThemeChoice } from '@/ui/theme-choice';
import { useToast } from '@/ui/toast';
import { ChangePasswordForm } from './change-password-form';
import { TotpEnrollDialog } from './totp-enroll-dialog';

type MySession = SessionItem & { current: boolean };

const TOTP_SECTION_ID = 'xac-thuc-2-lop';
const SESSIONS_KEY = ['auth', 'my-sessions'] as const;

/**
 * Hồ sơ của tôi (Q-14): người dùng tự đổi mật khẩu, tự bật / cài lại 2 lớp, xem và đóng các
 * phiên KHÁC của chính mình, chọn giao diện. Màn ĐỌC — chạy được ở 390px (một cột thẻ).
 *
 * Vào từ menu tài khoản; `?open=password` mở thẳng hộp đổi mật khẩu, `#xac-thuc-2-lop` cuộn tới
 * thẻ 2 lớp — hai mục tương ứng trong menu dẫn tới đây chứ không dựng màn riêng.
 */
export function ProfileScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  // Đổi mật khẩu / cài lại 2 lớp đều đá các phiên khác — danh sách phiên phải hỏi lại.
  const refreshSessions = () => void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const [enrollMode, setEnrollMode] = useState<'enable' | 'reenroll' | null>(null);
  const passwordOpen = params.get('open') === 'password';

  const setPasswordOpen = (open: boolean) => {
    const next = new URLSearchParams(params);
    if (open) next.set('open', 'password');
    else next.delete('open');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (hash === `#${TOTP_SECTION_ID}`) {
      document.getElementById(TOTP_SECTION_ID)?.scrollIntoView({ block: 'start' });
    }
  }, [hash]);

  const roleKey =
    me.role === 'sa' ? 'accounts.roleSa' : me.role === 'admin' ? 'accounts.roleAdmin' : 'accounts.roleMember';

  return (
    <div className="profile-page">
      <PageHeader title={t('profile.title')} subtitle={t('profile.subtitle')} />

      <section className="card profile-card" aria-labelledby="profile-info">
        <h2 id="profile-info">{t('profile.infoTitle')}</h2>
        <dl className="profile-dl">
          <dt>{t('profile.fullName')}</dt>
          <dd>{me.fullName}</dd>
          <dt>{t('profile.email')}</dt>
          <dd className="mono">{me.email}</dd>
          <dt>{t('profile.role')}</dt>
          <dd>{t(roleKey)}</dd>
        </dl>
        <p className="muted">{t('profile.infoHint')}</p>
      </section>

      <section className="card profile-card" aria-labelledby="profile-password">
        <h2 id="profile-password">{t('profile.passwordTitle')}</h2>
        <p className="muted">{t('profile.passwordHint')}</p>
        <div>
          <button type="button" className="btn" onClick={() => setPasswordOpen(true)}>
            {t('profile.changePassword')}
          </button>
        </div>
      </section>

      <section
        className="card profile-card"
        id={TOTP_SECTION_ID}
        aria-labelledby="profile-totp"
      >
        <h2 id="profile-totp">{t('profile.totpTitle')}</h2>
        <p data-testid="profile-totp-status">
          {me.totpEnrolled
            ? me.totpEnrolledAt
              ? t('profile.totpOnSince', { date: formatDate(me.totpEnrolledAt) })
              : t('profile.totpOn')
            : t('profile.totpOff')}
        </p>
        <div>
          <button
            type="button"
            className={me.totpEnrolled ? 'btn' : 'btn primary'}
            onClick={() => setEnrollMode(me.totpEnrolled ? 'reenroll' : 'enable')}
          >
            {me.totpEnrolled ? t('profile.totpReEnroll') : t('profile.totpEnable')}
          </button>
        </div>
      </section>

      <MySessionsCard csrfToken={me.csrfToken} />

      <section className="card profile-card" aria-labelledby="profile-appearance">
        <h2 id="profile-appearance">{t('profile.appearanceTitle')}</h2>
        <ThemeChoice label={t('profile.appearanceTitle')} />
      </section>

      {passwordOpen ? (
        <Dialog
          open
          onOpenChange={(open) => setPasswordOpen(open)}
          maxWidth={480}
          title={t('profile.changePassword')}
        >
          <ChangePasswordForm
            csrfToken={me.csrfToken}
            variant="dialog"
            submitLabel={t('profile.changePassword')}
            onChanged={() => {
              setPasswordOpen(false);
              refreshSessions();
              toast({ message: t('profile.passwordChanged') });
            }}
          />
        </Dialog>
      ) : null}

      {enrollMode ? (
        <TotpEnrollDialog
          mode={enrollMode}
          csrfToken={me.csrfToken}
          onClose={() => setEnrollMode(null)}
          onDone={() => {
            toast({
              message: t(enrollMode === 'reenroll' ? 'profile.totpReEnrolled' : 'profile.totpEnrolled'),
            });
            setEnrollMode(null);
            refreshSessions();
          }}
        />
      ) : null}
    </div>
  );
}

function MySessionsCard({ csrfToken }: { csrfToken: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const sessions = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => apiFetch<MySession[]>('/api/v1/auth/sessions'),
  });
  const revoke = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/auth/sessions/${input.id}/revoke`,
    { csrfToken, refreshMe: false, body: () => undefined },
  );
  const revokeOthers = useApiMutation<undefined, { revokedSessions: number }>(
    '/api/v1/auth/sessions/revoke-others',
    { csrfToken, refreshMe: false },
  );
  const others = (sessions.data ?? []).filter((s) => !s.current);

  return (
    <section className="card profile-card" aria-labelledby="profile-sessions">
      <h2 id="profile-sessions">{t('profile.sessionsTitle')}</h2>
      <p className="muted">{t('profile.sessionsHint')}</p>
      {sessions.isLoading ? (
        <Loading />
      ) : sessions.isError ? (
        // "Không có máy nào khác" chỉ được nói khi đã hỏi được — đây là màn người ta mở lúc nghi
        // tài khoản bị chiếm.
        <LoadError error={sessions.error} onRetry={() => void sessions.refetch()} />
      ) : (
        <>
          <SessionList
            sessions={sessions.data ?? []}
            currentLabel={t('profile.sessionCurrent')}
            endLabel={t('profile.sessionRevoke')}
            busy={revoke.isPending}
            onEnd={(session) => {
              void (async () => {
                const ok = await askConfirm({
                  title: t('profile.sessionRevokeTitle'),
                  message: `${orDash(session.ip)} — ${t('profile.sessionLastSeen', {
                    time: formatDateTime(session.lastSeenAt),
                  })}. ${t('profile.sessionRevokeBody')}`,
                  danger: true,
                  confirmLabel: t('profile.sessionRevoke'),
                });
                if (!ok) return;
                revoke.mutate(
                  { id: session.id },
                  {
                    onSuccess: () => {
                      toast({ message: t('profile.sessionRevoked') });
                      void sessions.refetch();
                    },
                    onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
                  },
                );
              })();
            }}
          />
          {others.length === 0 ? (
            <p className="muted">{t('profile.noOtherSessions')}</p>
          ) : (
            <div>
              <button
                type="button"
                className="btn danger"
                disabled={revokeOthers.isPending}
                onClick={() => {
                  void (async () => {
                    const ok = await askConfirm({
                      title: t('profile.revokeOthersTitle'),
                      message: t('profile.revokeOthersBody'),
                      danger: true,
                      confirmLabel: t('profile.revokeOthers'),
                    });
                    if (!ok) return;
                    revokeOthers.mutate(undefined, {
                      onSuccess: (result) => {
                        toast({
                          message: t('profile.revokeOthersDone', { count: result.revokedSessions }),
                        });
                        void sessions.refetch();
                      },
                      onError: (err) => toast({ message: errorMessage(err), tone: 'error' }),
                    });
                  })();
                }}
              >
                {t('profile.revokeOthers')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
