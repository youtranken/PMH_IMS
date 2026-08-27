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
  /** Chiếu theo NGƯỜI hay theo NHÓM ĐỐI TƯỢNG — cùng dữ liệu, hai câu hỏi khác nhau. */
  const [view, setView] = useState<'member' | 'scope'>('member');
  const [grantingScope, setGrantingScope] = useState<ScopeOption | null>(null);

  const rules = useQuery({
    queryKey: ['vault', 'access'],
    queryFn: () => apiFetch<AccessRule[]>('/api/v1/vault/access'),
  });

  // Danh sách nhóm đối tượng dùng cho CẢ chiều nhìn thứ hai lẫn hộp gán — tải sẵn ở đây để
  // chiều "theo nhóm" hiện được cả nhóm CHƯA ai được gán (chỗ hổng cần thấy nhất).
  const scopes = useQuery({
    queryKey: ['vault', 'access', 'scopes'],
    queryFn: () => apiFetch<ScopeOption[]>('/api/v1/vault/access/scopes'),
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

  /**
   * Gỡ một dòng quyền — dùng CHUNG cho cả hai chiều nhìn (AD-15).
   *
   * Hai bản sao sẽ trôi khác nhau đúng lúc câu xác nhận đổi, và một bên sẽ quên hỏi.
   */
  const removeRule = async (rule: AccessRule) => {
    const ok = await askConfirm({
      message: t('access.confirmRemove', { member: rule.memberEmail, scope: rule.scopeLabel }),
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
        onError: (error) => toast({ message: errorMessage(error), tone: 'error' }),
      },
    );
  };

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

  /**
   * Chiều nhìn thứ hai: gom theo NHÓM ĐỐI TƯỢNG.
   *
   * Màn này vốn chỉ gom theo người, nên câu "site PMH-HO ai đang xem được" không trả lời
   * được — phải rà mắt qua từng thẻ người rồi tự cộng lại trong đầu. Mà đó chính là câu hỏi
   * lúc rà soát: gỡ một site khỏi vòng an toàn thì phải biết trước ai mất quyền.
   *
   * Cùng MỘT tập dữ liệu, chỉ chiếu theo trục khác — không gọi thêm API, và hai chiều không
   * thể nói lệch nhau.
   */
  const scopeGroups = useMemo(() => {
    const map = new Map<string, { label: string; whitelist: AccessRule[]; needsApproval: AccessRule[] }>();
    for (const scope of scopes.data ?? []) {
      map.set(`${scope.scopeType}|${scope.scopeRef}`, {
        label: scope.label,
        whitelist: [],
        needsApproval: [],
      });
    }
    for (const rule of rules.data ?? []) {
      const key = `${rule.scopeType}|${rule.scopeRef}`;
      // Nhóm đã bị xoá khỏi danh mục nhưng quyền còn treo: vẫn phải HIỆN, không được giấu —
      // quyền mồ côi là đúng thứ cần thấy để đi gỡ.
      const entry = map.get(key) ?? { label: rule.scopeLabel, whitelist: [], needsApproval: [] };
      (rule.tier === 'whitelist' ? entry.whitelist : entry.needsApproval).push(rule);
      map.set(key, entry);
    }
    const term = search.trim().toLowerCase();
    return [...map.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .filter((group) => !term || group.label.toLowerCase().includes(term))
      .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
  }, [rules.data, scopes.data, search]);

  const totalRules = (rules.data ?? []).length;
  /*
   * Đếm trên TOÀN BỘ nhóm, không phải trên tập đang lọc.
   *
   * Dòng tổng hiện ở cả hai chiều nhìn và đọc như một con số TOÀN CỤC. Tính từ `scopeGroups`
   * (đã lọc theo ô tìm) thì gõ một chữ vào ô tìm là con số tụt xuống theo — một con số rà
   * soát mà lại nói về một lát cắt, không ai biết.
   */
  const scopedRules = new Set(
    (rules.data ?? []).map((rule) => `${rule.scopeType}|${rule.scopeRef}`),
  );
  const allScopes = scopes.data ?? [];
  /*
   * Số tài khoản cũng phải TOÀN CỤC, cùng lý do với `scopedRules` ngay trên.
   *
   * Dòng tổng ghép bốn con số vào một câu. Ba con số kia đếm trên toàn bộ dữ liệu, riêng
   * `people` lại lấy từ danh sách ĐÃ LỌC theo ô tìm — nên gõ "hùng" vào ô tìm là câu đó thành
   * "1 tài khoản · 47 dòng quyền", đọc như thể 47 dòng quyền đang thuộc về một người.
   */
  const totalPeople = (accounts.data?.items ?? []).length;
  const emptyScopes = allScopes.filter(
    (scope) => !scopedRules.has(`${scope.scopeType}|${scope.scopeRef}`),
  ).length;

  return (
    <>
      <PageHeader title={t('access.title')} subtitle={t('access.subtitle')} />

      {/* Hai chiều nhìn cùng một tập quyền. "Anh Hùng xem được gì" và "site này ai xem được"
          là hai câu hỏi khác nhau, và bản cũ chỉ trả lời được câu đầu. */}
      <div className="segmented" role="group" aria-label={t('access.viewLabel')}>
        <button
          type="button"
          className={view === 'member' ? 'on' : undefined}
          aria-pressed={view === 'member'}
          onClick={() => setView('member')}
        >
          {t('access.viewByMember')}
        </button>
        <button
          type="button"
          className={view === 'scope' ? 'on' : undefined}
          aria-pressed={view === 'scope'}
          onClick={() => setView('scope')}
        >
          {t('access.viewByScope')}
        </button>
      </div>

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t(view === 'member' ? 'access.search' : 'access.searchScope')}
      />

      <p className="alert">{t('access.defaultDenied')}</p>

      {/* Một dòng tổng: lỗ hổng của ma trận là những nhóm CHƯA ai được gán, mà thứ đó không
          nhìn ra được khi phải rà từng thẻ. */}
      {/* Chỉ hiện dòng tổng khi CẢ HAI truy vấn đã xong và không lỗi. `scopes` hỏng thì
          `allScopes` rỗng và dòng này nói "0 nhóm chưa gán cho ai" — trên đúng cái màn sinh
          ra để soi chỗ hổng, một request hỏng lại đọc thành giấy chứng nhận sạch sẽ. */}
      {/* Gác CẢ HAI truy vấn. `rules` hỏng thì `totalRules` = 0 và `scopedRules` rỗng, nên
          dòng này vẽ ra "0 dòng quyền · M nhóm, trong đó M nhóm chưa gán cho ai" ngay phía
          trên khối báo lỗi — một con số kiểm toán bịa ra, đúng kiểu hỏng mà chú thích bên
          cạnh đã mô tả cho `scopes`. */}
      {/* Gác cả `accounts` nữa: nó hỏng thì `totalPeople` = 0 và câu tổng mở đầu bằng
          "0 tài khoản", cùng loại số bịa như hai truy vấn kia. */}
      {!rules.isLoading &&
      !rules.isError &&
      !scopes.isLoading &&
      !scopes.isError &&
      !accounts.isLoading &&
      !accounts.isError ? (
        <p className="muted">
          {t('access.summary', {
            people: totalPeople,
            rules: totalRules,
            scopes: allScopes.length,
            empty: emptyScopes,
          })}
        </p>
      ) : null}

      {rules.isLoading || accounts.isLoading || scopes.isLoading ? (
        <Loading />
      ) : rules.isError ? (
        <LoadError onRetry={() => void rules.refetch()} />
      ) : scopes.isError ? (
        // Chiều "theo nhóm" DỰNG TỪ `scopes`: thiếu nó thì mọi nhóm chưa ai được gán biến
        // mất — đúng tập mà chiều nhìn này sinh ra để chỉ ra.
        <LoadError onRetry={() => void scopes.refetch()} />
      ) : accounts.isError ? (
        // Chiều "theo người" DỰNG TỪ `accounts`: thiếu nó thì màn vẽ ra "Không có tài khoản
        // nào khớp" — nghe như hệ thống chưa có ai, chứ không phải một request hỏng. Và hộp
        // Gán quyền cũng lấy danh sách người từ đây, mở ra sẽ rỗng không lý do.
        <LoadError onRetry={() => void accounts.refetch()} />
      ) : view === 'scope' ? (
        scopeGroups.length === 0 ? (
          <EmptyState title={t('access.noScopes')} />
        ) : (
          <div className="access-matrix">
            {scopeGroups.map((group) => (
              <section key={group.key} className="card device-panel">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h2 className="form-section-title">{group.label}</h2>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      const [scopeType, scopeRef] = group.key.split('|');
                      setGrantingScope({
                        scopeType: scopeType as ScopeType,
                        scopeRef,
                        label: group.label,
                      });
                    }}
                  >
                    {t('access.addPeople')}
                  </button>
                </div>

                {group.whitelist.length + group.needsApproval.length === 0 ? (
                  <p className="muted">{t('access.scopeEmpty')}</p>
                ) : (
                  <div className="scope-tiers">
                    <TierColumn
                      title={t('access.tier_whitelist')}
                      tone="ok"
                      rules={group.whitelist}
                      onRemove={(rule) => void removeRule(rule)}
                    />
                    <TierColumn
                      title={t('access.tier_needs_approval')}
                      tone="warn"
                      rules={group.needsApproval}
                      onRemove={(rule) => void removeRule(rule)}
                    />
                  </div>
                )}
              </section>
            ))}
          </div>
        )
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
                          onClick={() => void removeRule(rule)}
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

      {grantingScope ? (
        <GrantToScopeDialog
          scope={grantingScope}
          members={(accounts.data?.items ?? []).filter((account) => account.role === 'member')}
          csrfToken={me.csrfToken}
          onClose={() => setGrantingScope(null)}
          onSaved={({ granted, failures }) => {
            setGrantingScope(null);
            toast({ message: t('access.grantedMany', { count: granted }) });
            for (const failure of failures) toast({ message: failure, tone: 'warn' });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

/** Một cột tầng quyền trong thẻ nhóm đối tượng: mỗi người là một chip có ✕ để gỡ. */
function TierColumn({
  title,
  tone,
  rules,
  onRemove,
}: {
  title: string;
  tone: 'ok' | 'warn';
  rules: AccessRule[];
  onRemove: (rule: AccessRule) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <span className={`badge ${tone}`}>
        {title} {rules.length}
      </span>
      {rules.length === 0 ? (
        <p className="muted">{t('access.tierEmpty')}</p>
      ) : (
        <ul className="chip-list">
          {rules.map((rule) => (
            <li key={rule.id} className="chip">
              <span>{rule.memberEmail}</span>
              <button
                type="button"
                aria-label={t('access.removeOf', {
                  member: rule.memberEmail,
                  scope: rule.scopeLabel,
                })}
                onClick={() => onRemove(rule)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Gán MỘT nhóm đối tượng cho NHIỀU người một lượt — chiều ngược của `GrantDialog`.
 *
 * Mở vòng an toàn cho một site thường là việc của cả một nhóm người ("ba anh trực đêm"), mà
 * hộp cũ chỉ nhận một người một lần: ba lần mở hộp, ba lần chọn lại đúng nhóm đó, và lần thứ
 * ba rất dễ chọn nhầm tầng quyền.
 */
function GrantToScopeDialog({
  scope,
  members,
  csrfToken,
  onClose,
  onSaved,
}: {
  scope: ScopeOption;
  members: AccountRow[];
  csrfToken: string;
  onClose: () => void;
  onSaved: (result: { granted: number; failures: string[] }) => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string[]>([]);
  const [tier, setTier] = useState<Tier>('needs_approval');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useApiMutation<Record<string, unknown>, unknown>('/api/v1/vault/access', {
    csrfToken,
    refreshMe: false,
  });

  const toggle = (email: string) =>
    setPicked((current) =>
      current.includes(email) ? current.filter((item) => item !== email) : [...current, email],
    );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={560}
      title={t('access.grantScopeTitle', { scope: scope.label })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="grant-scope-form" className="btn primary" disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="grant-scope-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (picked.length === 0) {
            setError(t('access.pickPeople'));
            return;
          }
          void (async () => {
            setSaving(true);
            let done = 0;
            const failures: string[] = [];
            for (const memberEmail of picked) {
              try {
                await save.mutateAsync({
                  memberEmail,
                  scopeType: scope.scopeType,
                  scopeRef: scope.scopeRef,
                  tier,
                  note: note.trim(),
                });
                done += 1;
              } catch (err) {
                failures.push(`${memberEmail}: ${errorMessage(err)}`);
              }
            }
            setSaving(false);
            if (done === 0) {
              setError(failures.join(' '));
              return;
            }
            /*
             * Người GÁN HỎNG phải được nói ra, kể cả khi có người gán được.
             *
             * Chọn 5 người mà 3 người đã có luật trên nhóm đó (POST từ chối trùng): bản cũ
             * đóng hộp, báo "đã gán cho 2 người", và ba lỗi biến mất — SA tin là cả 5 đã có
             * quyền. Cùng cách làm với form NAT: đẩy cả lỗi lên cho nơi gọi báo riêng.
             */
            onSaved({ granted: done, failures });
          })();
        }}
      >
        {members.length === 0 ? (
          <p className="muted">{t('access.noMembers')}</p>
        ) : (
          <fieldset className="ff-contents">
            <legend className="lbl-t">{t('access.people')}</legend>
            <ul className="pick-list">
              {members.map((member) => (
                <li key={member.id}>
                  <label className="row" style={{ gap: 'var(--space-3)' }}>
                    <input
                      type="checkbox"
                      checked={picked.includes(member.email)}
                      onChange={() => toggle(member.email)}
                    />
                    <span>
                      {member.fullName} <span className="muted mono">{member.email}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}

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

        <Field label={t('access.note')} htmlFor="grant-scope-note">
          <input
            id="grant-scope-note"
            className="inp"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {/* Nói TRƯỚC sẽ ghi mấy dòng — gán một lượt cho năm người là chuyện dễ đếm nhầm. */}
        {picked.length > 1 ? (
          <p className="alert">{t('access.willGrant', { count: picked.length })}</p>
        ) : null}

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
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
