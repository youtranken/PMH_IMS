import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { Dialog } from '@/ui/dialog';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';

type ScopeType = 'device_site' | 'device_type' | 'software_kind';
type Tier = 'whitelist' | 'needs_approval';

interface AccessRule {
  id: string;
  memberEmail: string;
  scopeType: ScopeType;
  scopeRef: string;
  scopeLabel: string;
  tier: Tier;
  grantedBy: string;
  note: string | null;
}

interface ScopeOption {
  scopeType: ScopeType;
  scopeRef: string;
  label: string;
}

interface AccountRow {
  id: string;
  email: string;
  fullName: string;
  role: 'sa' | 'admin' | 'member';
}

/**
 * Ma trận quyền xem secret (story 6.2, FR-023).
 *
 * Nhóm theo NGƯỜI chứ không theo nhóm đối tượng: câu hỏi thật của SA là "anh Hùng xem được
 * những gì", và câu hỏi của auditor là "vì sao người này xem được cái kia". Cả hai đều bắt
 * đầu từ một con người.
 *
 * Người chưa có dòng nào vẫn HIỆN, kèm chữ "chưa có quyền nào" — ẩn họ đi thì SA không biết
 * là mình chưa gán, và sẽ tưởng đã gán rồi.
 */
export function AccessMatrixScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<string | null>(null);

  const rules = useQuery({
    queryKey: ['vault', 'access'],
    queryFn: () => apiFetch<AccessRule[]>('/api/v1/vault/access'),
  });

  const accounts = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: () => apiFetch<{ items: AccountRow[] }>('/api/v1/accounts?limit=200'),
  });

  const remove = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/vault/access/${input.id}`,
    { method: 'DELETE', csrfToken: me.csrfToken, refreshMe: false, body: () => undefined },
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vault', 'access'] });

  const byMember = useMemo(() => {
    const map = new Map<string, AccessRule[]>();
    for (const account of accounts.data?.items ?? []) {
      map.set(account.email.toLowerCase(), []);
    }
    for (const rule of rules.data ?? []) {
      const key = rule.memberEmail.toLowerCase();
      map.set(key, [...(map.get(key) ?? []), rule]);
    }
    return map;
  }, [rules.data, accounts.data]);

  const people = (accounts.data?.items ?? []).filter((account) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      account.email.toLowerCase().includes(term) ||
      account.fullName.toLowerCase().includes(term)
    );
  });

  return (
    <>
      <PageHeader title={t('access.title')} subtitle={t('access.subtitle')} />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('access.search')}
      />

      <p className="alert">{t('access.defaultDenied')}</p>

      {rules.isLoading || accounts.isLoading ? (
        <Loading />
      ) : rules.isError ? (
        <LoadError onRetry={() => void rules.refetch()} />
      ) : people.length === 0 ? (
        <EmptyState title={t('access.noPeople')} />
      ) : (
        <div className="access-matrix">
          {people.map((account) => {
            const own = byMember.get(account.email.toLowerCase()) ?? [];
            return (
              <section key={account.id} className="card device-panel">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <h2 className="form-section-title">{account.fullName}</h2>
                    <span className="muted mono">{account.email}</span>
                  </div>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => setAdding(account.email)}
                  >
                    {t('access.add')}
                  </button>
                </div>

                {/* SA/Admin đã xem được mọi thứ qua vai — ma trận này chỉ dành cho Member. */}
                {account.role !== 'member' ? (
                  <p className="muted">{t('access.adminNote')}</p>
                ) : own.length === 0 ? (
                  <p className="muted">{t('access.none')}</p>
                ) : (
                  <ul className="access-rules">
                    {own.map((rule) => (
                      <li key={rule.id} className="row" style={{ gap: 'var(--space-3)' }}>
                        <span className={`badge ${rule.tier === 'whitelist' ? 'ok' : 'warn'}`}>
                          {t(`access.tier_${rule.tier}`)}
                        </span>
                        <span>{rule.scopeLabel}</span>
                        <span className="muted">{orDash(rule.note)}</span>
                        <button
                          type="button"
                          className="btn sm danger"
                          disabled={remove.isPending}
                          onClick={() => {
                            void (async () => {
                              const ok = await askConfirm({
                                message: t('access.confirmRemove', {
                                  member: account.fullName,
                                  scope: rule.scopeLabel,
                                }),
                                danger: true,
                                confirmLabel: t('access.remove'),
                              });
                              if (!ok) return;
                              remove.mutate(
                                { id: rule.id },
                                {
                                  onSuccess: () => {
                                    toast({ message: t('access.removed') });
                                    void refresh();
                                  },
                                  onError: (error) =>
                                    toast({ message: errorMessage(error), tone: 'error' }),
                                },
                              );
                            })();
                          }}
                        >
                          {t('access.remove')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {adding ? (
        <GrantDialog
          memberEmail={adding}
          csrfToken={me.csrfToken}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            toast({ message: t('access.granted') });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

function GrantDialog({
  memberEmail,
  csrfToken,
  onClose,
  onSaved,
}: {
  memberEmail: string;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [scopeKey, setScopeKey] = useState('');
  const [tier, setTier] = useState<Tier>('needs_approval');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const scopes = useQuery({
    queryKey: ['vault', 'access', 'scopes'],
    queryFn: () => apiFetch<ScopeOption[]>('/api/v1/vault/access/scopes'),
  });

  const save = useApiMutation<Record<string, unknown>, unknown>('/api/v1/vault/access', {
    csrfToken,
    refreshMe: false,
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={520}
      title={t('access.grantTitle', { member: memberEmail })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="grant-form" className="btn primary" disabled={save.isPending}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="grant-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const [scopeType, scopeRef] = scopeKey.split('|');
          if (!scopeType || !scopeRef) {
            setError(t('access.scopeRequired'));
            return;
          }
          save.mutate(
            { memberEmail, scopeType, scopeRef, tier, note: note.trim() },
            { onSuccess: onSaved, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <Field label={t('access.scope')} required hint={t('access.scopeHint')}>
          <Select
            value={scopeKey}
            onChange={setScopeKey}
            ariaLabel={t('access.scope')}
            placeholder={t('access.scopePlaceholder')}
            options={(scopes.data ?? []).map((scope) => ({
              value: `${scope.scopeType}|${scope.scopeRef}`,
              label: scope.label,
            }))}
          />
        </Field>

        <Field label={t('access.tier')} hint={t('access.tierHint')}>
          <Select
            value={tier}
            onChange={(next) => setTier(next as Tier)}
            ariaLabel={t('access.tier')}
            options={[
              { value: 'needs_approval', label: t('access.tier_needs_approval') },
              { value: 'whitelist', label: t('access.tier_whitelist') },
            ]}
          />
        </Field>

        <Field label={t('access.note')} htmlFor="access-note">
          <input
            id="access-note"
            className="inp"
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
    </Dialog>
  );
}
