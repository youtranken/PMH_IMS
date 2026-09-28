import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import type { Me } from '@/lib/me';
import { Dialog } from '@/ui/dialog';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { ScrollX } from '@/ui/scroll-x';
import { Select } from '@/ui/select';
import { TabPanel, Tabs } from '@/ui/tabs';
import { useConfirm } from '@/ui/confirm-provider';
import { useMediaQuery } from '@/ui/use-media-query';
import { NARROW_QUERY } from '@/ui/use-narrow';
import { useToast } from '@/ui/toast';
import { foldSearch } from '@/lib/search-fold';

/** Phải khớp `SCOPE_TYPES` bên API (`access-tier.ts`) và CHECK ở tầng DB. */
type ScopeType =
  | 'device_site'
  | 'device_type'
  | 'software_kind'
  | 'service_account_kind'
  | 'isp_provider';
type Tier = 'whitelist' | 'needs_approval';

/** Thứ tự họ nhóm — dùng cho cả cột lưới lẫn khối trên thẻ quyền của một người. */
const SCOPE_ORDER: ScopeType[] = [
  'device_site',
  'device_type',
  'software_kind',
  'service_account_kind',
  'isp_provider',
];

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

type View = 'people' | 'matrix';

const scopeKey = (scope: { scopeType: string; scopeRef: string }) =>
  `${scope.scopeType}|${scope.scopeRef}`;

/**
 * Quyền xem két sắt (FR-023) — hai cách nhìn trên CÙNG một sổ quyền.
 *
 * "Theo người" là mô hình chính: việc hằng ngày là "anh A cần xem gì" — chọn người bên trái,
 * bên phải là thẻ quyền của họ gom theo họ nhóm, "+ Thêm quyền" chọn nhiều nhóm một lượt. Lưới
 * 32 cột × N người thì phần lớn là ô trống, phải kéo ngang dài mới tìm ra một nhóm.
 *
 * "Ma trận" vẫn giữ (chỉ màn rộng) cho việc RÀ SOÁT tổng: đọc theo cột ra "nhóm này ai xem
 * được", và chỗ hổng hiện thành mảng ô trống liền nhau.
 *
 * SA/Admin xem được mọi secret theo VAI: họ không có dòng trong lưới hay thẻ để gán (gán cho
 * họ là một quyền không có tác dụng, rồi tưởng là đã siết) — họ nằm trong khối gập "Có toàn
 * quyền theo vai" để người rà vẫn thấy ai đang có quyền.
 *
 * `?user=<id>` mở sẵn người đó (hộp tạo tài khoản dẫn thẳng tới đây), `?view=matrix` mở lưới.
 */
export function AccessMatrixScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const narrow = useMediaQuery(NARROW_QUERY);
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  /** Lọc CỘT của lưới theo họ nhóm đối tượng — '' là xem hết. */
  const [family, setFamily] = useState<'' | ScopeType>('');
  const [grantingScope, setGrantingScope] = useState<ScopeOption | null>(null);
  const [addingFor, setAddingFor] = useState<AccountRow | null>(null);
  /** Ô / chip đang mở để đặt/gỡ quyền. `rule` null = đang gán mới. */
  const [cell, setCell] = useState<{
    account: AccountRow;
    scope: ScopeOption;
    rule: AccessRule | null;
  } | null>(null);

  // Lưới chỉ có ở màn rộng: ở điện thoại vài chục cột là không đọc nổi, còn thẻ theo người thì đọc được.
  const view: View = params.get('view') === 'matrix' && !narrow ? 'matrix' : 'people';
  const selectedId = params.get('user');
  const setParam = (key: string, value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: key === 'user' },
    );

  const rules = useQuery({
    queryKey: ['vault', 'access'],
    queryFn: () => apiFetch<AccessRule[]>('/api/v1/vault/access'),
  });

  // Danh sách nhóm đối tượng — để thấy được cả nhóm CHƯA ai được gán (chỗ hổng cần thấy nhất).
  const scopes = useQuery({
    queryKey: ['vault', 'access', 'scopes'],
    queryFn: () => apiFetch<ScopeOption[]>('/api/v1/vault/access/scopes'),
  });

  // Danh bạ hẹp của module két, KHÔNG phải `/accounts`: màn này mở cho cả Admin, còn
  // `/accounts` chỉ SA và trả đủ hồ sơ nhân sự.
  const accounts = useQuery({
    queryKey: ['vault', 'access', 'people'],
    queryFn: () => apiFetch<AccountRow[]>('/api/v1/vault/access/people'),
  });

  const remove = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/vault/access/${input.id}`,
    { method: 'DELETE', csrfToken: me.csrfToken, refreshMe: false, body: () => undefined },
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vault', 'access'] });

  /** Gỡ một dòng quyền — MỘT bản cho mọi chỗ gỡ trên màn này (AD-15). */
  const removeRule = async (rule: AccessRule) => {
    const ok = await askConfirm({
      title: t('common.titleOf', {
        action: t('access.remove'),
        subject: rule.memberEmail,
      }),
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

  /** `email|scopeType|scopeRef` → luật — `Map` vì lưới là N×M ô, `.find()` mỗi ô là quá nhiều. */
  const ruleAt = useMemo(() => {
    const map = new Map<string, AccessRule>();
    for (const rule of rules.data ?? []) {
      map.set(`${rule.memberEmail.toLowerCase()}|${scopeKey(rule)}`, rule);
    }
    return map;
  }, [rules.data]);

  const rulesOf = useMemo(() => {
    const map = new Map<string, AccessRule[]>();
    for (const rule of rules.data ?? []) {
      const key = rule.memberEmail.toLowerCase();
      map.set(key, [...(map.get(key) ?? []), rule]);
    }
    return map;
  }, [rules.data]);

  /** Cột của lưới, gom theo họ và giữ thứ tự `SCOPE_ORDER`. */
  const columnGroups = useMemo(() => {
    const wanted = (scopes.data ?? []).filter((scope) => !family || scope.scopeType === family);
    return SCOPE_ORDER.map((type) => ({
      type,
      label: t(`access.scope_${type}`),
      scopes: wanted
        .filter((scope) => scope.scopeType === type)
        .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
    })).filter((group) => group.scopes.length > 0);
  }, [scopes.data, family, t]);

  const columns = columnGroups.flatMap((group) => group.scopes);

  const allAccounts = accounts.data ?? [];
  const members = allAccounts.filter((account) => account.role === 'member');
  const roleHolders = allAccounts.filter((account) => account.role !== 'member');
  // Gấp dấu cả hai vế (B-01): gõ `nguyen thi` phải ra `Nguyễn Thị`.
  const term = foldSearch(search.trim());
  const matches = (account: AccountRow) =>
    !term || foldSearch(account.email).includes(term) || foldSearch(account.fullName).includes(term);
  const people = members.filter(matches);

  const selected =
    members.find((account) => account.id === selectedId) ??
    // Màn rộng: chưa chọn ai thì mở sẵn người đầu danh sách — khung phải bên phải không trống.
    (!narrow && !selectedId ? people[0] : undefined) ??
    null;

  /*
   * Dòng tổng đếm trên TOÀN BỘ, không phải tập đang lọc — nó đọc như một con số toàn cục, gõ
   * một chữ vào ô tìm mà mọi con số tụt theo thì không ai biết nó đang nói về lát cắt nào.
   */
  const totalRules = (rules.data ?? []).length;
  const scopedRules = new Set((rules.data ?? []).map(scopeKey));
  const allScopes = scopes.data ?? [];
  const emptyScopes = allScopes.filter((scope) => !scopedRules.has(scopeKey(scope))).length;

  const loading = rules.isLoading || accounts.isLoading || scopes.isLoading;
  const failed = rules.isError || accounts.isError || scopes.isError;

  const tabs = [
    { key: 'people', label: t('access.viewPeople') },
    ...(narrow ? [] : [{ key: 'matrix', label: t('access.viewMatrix') }]),
  ];

  const content = loading ? (
    <Loading />
  ) : rules.isError ? (
    <LoadError error={rules.error} onRetry={() => void rules.refetch()} />
  ) : scopes.isError ? (
    // Thiếu danh sách nhóm thì mọi nhóm chưa ai được gán biến mất — đúng tập màn này phải chỉ ra.
    <LoadError error={scopes.error} onRetry={() => void scopes.refetch()} />
  ) : accounts.isError ? (
    // Thiếu danh sách người thì màn đọc như "hệ thống chưa có ai", chứ không phải request hỏng.
    <LoadError error={accounts.error} onRetry={() => void accounts.refetch()} />
  ) : view === 'people' ? (
    <PeopleView
      people={people}
      selected={selected}
      narrow={narrow}
      rulesOf={rulesOf}
      onSelect={(account) => setParam('user', account ? account.id : null)}
      onAdd={setAddingFor}
      onOpenRule={(account, rule) =>
        setCell({
          account,
          rule,
          scope: { scopeType: rule.scopeType, scopeRef: rule.scopeRef, label: rule.scopeLabel },
        })
      }
    />
  ) : people.length === 0 ? (
    <EmptyState title={t('access.noPeople')} />
  ) : columns.length === 0 ? (
    <EmptyState title={t('access.noScopes')} />
  ) : (
    <>
      {/* Cuộn ngang TRONG khung — cột tên người dính trái, tiêu đề dính trên. Chiều cao theo
          khung nhìn chứ không phải một hộp nhỏ cố định. */}
      <ScrollX ariaLabel={t('access.title')} className="table-wrap access-grid-wrap" testId="access-grid">
        <table className="table access-grid">
          <thead>
            <tr>
              <th className="access-row-head" rowSpan={2}>
                {t('access.person')}
              </th>
              {columnGroups.map((group) => (
                <th key={group.type} colSpan={group.scopes.length} className="access-family">
                  {group.label}
                </th>
              ))}
            </tr>
            <tr>
              {columns.map((scope) => (
                <th key={scopeKey(scope)} className="access-col">
                  {/* Bấm tiêu đề cột = gán nhóm này cho NHIỀU người một lượt. Nhãn trợ năng là câu
                      đầy đủ vì chữ hiện ra đã cắt tiền tố họ. */}
                  <button
                    type="button"
                    className="access-col-btn"
                    aria-label={t('access.addPeopleTo', { scope: scope.label })}
                    title={t('access.addPeopleTo', { scope: scope.label })}
                    onClick={() => setGrantingScope(scope)}
                  >
                    {shortLabel(scope.label)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((account) => (
              <tr key={account.id}>
                <th scope="row" className="access-row-head">
                  <span className="access-person">{account.fullName}</span>
                  <span className="muted mono access-person-mail">{account.email}</span>
                  <button type="button" className="btn sm" onClick={() => setAddingFor(account)}>
                    {t('access.add')}
                  </button>
                </th>
                {columns.map((scope) => {
                  const key = scopeKey(scope);
                  const rule = ruleAt.get(`${account.email.toLowerCase()}|${key}`) ?? null;
                  return (
                    <td key={key} className="access-cell">
                      <button
                        type="button"
                        className={`access-chip ${rule ? rule.tier : 'none'}`}
                        aria-label={t('access.cellLabel', {
                          member: account.fullName,
                          scope: scope.label,
                          tier: t(rule ? `access.tier_${rule.tier}` : 'access.tier_denied'),
                        })}
                        onClick={() => setCell({ account, scope, rule })}
                      >
                        {rule ? (rule.tier === 'whitelist' ? '✓' : '⏳') : '–'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
      <p className="muted access-legend">
        <span className="access-chip whitelist" aria-hidden="true">
          ✓
        </span>{' '}
        {t('access.tier_whitelist')}
        {' · '}
        <span className="access-chip needs_approval" aria-hidden="true">
          ⏳
        </span>{' '}
        {t('access.tier_needs_approval')}
        {' · '}
        <span className="access-chip none" aria-hidden="true">
          –
        </span>{' '}
        {t('access.tier_denied')}
      </p>
    </>
  );

  return (
    <>
      <PageHeader title={t('access.title')} subtitle={t('access.subtitle')} />

      <Tabs
        items={tabs}
        value={view}
        onChange={(key) => setParam('view', key === 'matrix' ? 'matrix' : null)}
        ariaLabel={t('access.title')}
      />

      <TabPanel tabKey={view}>
        <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder={t('access.search')}>
          {/* Lọc CỘT của lưới — chỉ có nghĩa ở tab Ma trận. */}
          {view === 'matrix' ? (
            <Select
              value={family}
              onChange={(value) => setFamily(value as '' | ScopeType)}
              ariaLabel={t('access.columnFilter')}
              placeholder={t('access.allFamilies')}
              options={[
                { value: '', label: t('access.allFamilies') },
                ...SCOPE_ORDER.map((type) => ({ value: type, label: t(`access.scope_${type}`) })),
              ]}
            />
          ) : null}
        </FilterBar>

        <p className="alert">{t('access.defaultDenied')}</p>

        {/* Chỉ hiện khi CẢ BA truy vấn xong và không lỗi — thiếu một cái là mọi con số ở đây
            thành số bịa, đọc như giấy chứng nhận sạch sẽ trên chính màn soi chỗ hổng. */}
        {!loading && !failed ? (
          <p className="muted">
            {t('access.summary', {
              people: members.length,
              rules: totalRules,
              scopes: allScopes.length,
              empty: emptyScopes,
            })}
          </p>
        ) : null}

        {content}

        {!loading && !failed ? <RoleHolders accounts={roleHolders} /> : null}
      </TabPanel>

      {cell ? (
        <CellDialog
          account={cell.account}
          scope={cell.scope}
          rule={cell.rule}
          csrfToken={me.csrfToken}
          onClose={() => setCell(null)}
          onSaved={() => {
            setCell(null);
            toast({ message: t('access.granted') });
            void refresh();
          }}
          onRemove={() => {
            const rule = cell.rule;
            setCell(null);
            if (rule) void removeRule(rule);
          }}
        />
      ) : null}

      {addingFor ? (
        <MultiGrantDialog
          account={addingFor}
          scopes={allScopes}
          existing={rulesOf.get(addingFor.email.toLowerCase()) ?? []}
          csrfToken={me.csrfToken}
          onClose={() => setAddingFor(null)}
          onSaved={({ granted, failures }) => {
            setAddingFor(null);
            toast({ message: t('access.grantedScopes', { count: granted }) });
            for (const failure of failures) toast({ message: failure, tone: 'warn' });
            void refresh();
          }}
        />
      ) : null}

      {grantingScope ? (
        <GrantToScopeDialog
          scope={grantingScope}
          members={members}
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

/**
 * Tab "Theo người": trái là danh sách Thành viên (tìm được, kèm số quyền), phải là thẻ quyền của
 * người đang chọn. Màn hẹp chỉ hiện một nửa mỗi lúc: chưa chọn thì danh sách, chọn rồi thì thẻ
 * kèm nút quay lại.
 */
function PeopleView({
  people,
  selected,
  narrow,
  rulesOf,
  onSelect,
  onAdd,
  onOpenRule,
}: {
  people: AccountRow[];
  selected: AccountRow | null;
  narrow: boolean;
  rulesOf: Map<string, AccessRule[]>;
  onSelect: (account: AccountRow | null) => void;
  onAdd: (account: AccountRow) => void;
  onOpenRule: (account: AccountRow, rule: AccessRule) => void;
}) {
  const { t } = useTranslation();
  const showList = !narrow || !selected;
  const showDetail = selected !== null;

  return (
    <div className="access-people">
      {showList ? (
        people.length === 0 ? (
          <EmptyState title={t('access.noPeople')} />
        ) : (
          <nav aria-label={t('access.memberList')}>
            <ul className="access-member-list">
              {people.map((account) => {
                const count = rulesOf.get(account.email.toLowerCase())?.length ?? 0;
                const current = selected?.id === account.id;
                return (
                  <li key={account.id}>
                    <button
                      type="button"
                      className="access-member"
                      aria-current={current ? 'true' : undefined}
                      onClick={() => onSelect(account)}
                    >
                      <span className="access-member-name">
                        <b>{account.fullName}</b>
                        <span className="muted mono access-person-mail">{account.email}</span>
                      </span>
                      <span className={`badge ${count > 0 ? 'brand' : 'muted'}`}>
                        {t('access.ruleCount', { count })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )
      ) : null}

      {showDetail && selected ? (
        <PersonRules
          account={selected}
          rules={rulesOf.get(selected.email.toLowerCase()) ?? []}
          onBack={narrow ? () => onSelect(null) : undefined}
          onAdd={() => onAdd(selected)}
          onOpenRule={(rule) => onOpenRule(selected, rule)}
        />
      ) : null}
    </div>
  );
}

/** Thẻ quyền của MỘT người, gom theo họ nhóm: "Phần mềm — Chứng chỉ SSL · Xem thẳng". */
function PersonRules({
  account,
  rules,
  onBack,
  onAdd,
  onOpenRule,
}: {
  account: AccountRow;
  rules: AccessRule[];
  onBack?: () => void;
  onAdd: () => void;
  onOpenRule: (rule: AccessRule) => void;
}) {
  const { t } = useTranslation();
  const groups = SCOPE_ORDER.map((type) => ({
    type,
    rules: rules
      .filter((rule) => rule.scopeType === type)
      .sort((a, b) => a.scopeLabel.localeCompare(b.scopeLabel, 'vi')),
  })).filter((group) => group.rules.length > 0);

  return (
    <section className="card access-person-card" aria-labelledby="access-person-title">
      {onBack ? (
        <button type="button" className="btn sm" onClick={onBack}>
          {t('access.backToList')}
        </button>
      ) : null}
      <div className="access-person-head">
        <div>
          <h2 id="access-person-title">{account.fullName}</h2>
          <span className="muted mono">{account.email}</span>
        </div>
        <button type="button" className="btn primary" onClick={onAdd}>
          {t('access.addRules')}
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="muted">{t('access.noRulesYet')}</p>
      ) : (
        groups.map((group) => (
          <div key={group.type} className="access-rule-group">
            <h3>{t(`access.scope_${group.type}`)}</h3>
            <ul className="access-rule-chips">
              {group.rules.map((rule) => (
                <li key={rule.id}>
                  <button
                    type="button"
                    className={`access-rule-chip ${rule.tier}`}
                    aria-label={t('access.cellLabel', {
                      member: account.fullName,
                      scope: rule.scopeLabel,
                      tier: t(`access.tier_${rule.tier}`),
                    })}
                    onClick={() => onOpenRule(rule)}
                  >
                    {shortLabel(rule.scopeLabel)} · {t(`access.tier_${rule.tier}`)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/**
 * SA/Admin xem được mọi secret theo VAI. Không vẽ họ thành dòng trống (người xem tưởng họ không
 * có quyền gì) mà gom vào một khối gập: vẫn thấy AI đang có toàn quyền khi rà soát.
 */
function RoleHolders({ accounts }: { accounts: AccountRow[] }) {
  const { t } = useTranslation();
  if (accounts.length === 0) return null;
  return (
    <details className="card access-role-holders">
      <summary>{t('access.roleHolders', { count: accounts.length })}</summary>
      <p className="muted">{t('access.adminNote')}</p>
      <ul>
        {accounts.map((account) => (
          <li key={account.id}>
            <b>{account.fullName}</b>{' '}
            <span className="badge plain brand">
              {t(account.role === 'sa' ? 'accounts.roleSa' : 'accounts.roleAdmin')}
            </span>{' '}
            <span className="muted mono">{account.email}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Nhãn cột đã cắt tiền tố họ.
 *
 * API trả nhãn đầy đủ ("Thiết bị tại LST", "Phần mềm: License") vì nó còn dùng ở hộp gán, nơi
 * nhãn đứng một mình. Trên lưới thì họ đã nằm ở hàng tiêu đề nhóm ngay trên, nên lặp lại nó
 * trong từng cột chỉ tổ đẩy cột rộng ra gấp ba.
 */
function shortLabel(label: string): string {
  const cut = label.indexOf(': ');
  if (cut >= 0) return label.slice(cut + 2);
  return label.replace(/^Thiết bị (tại|loại) /, '');
}

/**
 * Đặt hoặc gỡ quyền của MỘT người trên MỘT nhóm — hộp mở ra từ một ô của lưới.
 *
 * Cố ý KHÔNG cho bấm-để-đổi-vòng ngay trên ô (trống → xem thẳng → cần duyệt → trống): đây là
 * quyền xem mật khẩu, và một cú bấm nhầm khi đang cuộn ngang là mở quyền cho người không nên
 * có. Một hộp nhỏ, đọc rõ ai — nhóm nào, rồi mới ghi.
 */
function CellDialog({
  account,
  scope,
  rule,
  csrfToken,
  onClose,
  onSaved,
  onRemove,
}: {
  account: AccountRow;
  scope: ScopeOption;
  rule: AccessRule | null;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const askConfirm = useConfirm();
  const [tier, setTier] = useState<Tier>(rule?.tier ?? 'needs_approval');
  const [note, setNote] = useState(rule?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const save = useApiMutation<Record<string, unknown>, unknown>('/api/v1/vault/access', {
    csrfToken,
    refreshMe: false,
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ.
         `guardUnsaved`: chưa bấm Lưu mà lỡ Esc thì hỏi lại, đừng xoá trắng. */
      dismissible={!save.isPending}
      guardUnsaved
      maxWidth={480}
      title={`${account.fullName} — ${scope.label}`}
      footer={
        <>
          {/* Gỡ đứng TÁCH khỏi cặp Hủy/Lưu: nó là hành động phá, không phải một lựa chọn
              ngang hàng với "lưu". Vẫn đi qua câu hỏi lại chung của `removeRule`. */}
          {rule ? (
            <button type="button" className="btn danger" onClick={onRemove}>
              {t('access.remove')}
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="access-cell-form"
            className="btn primary"
            disabled={save.isPending}
          >
            {save.isPending ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="access-cell-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          void (async () => {
            /*
             * HỎI LẠI trước khi ghi — cấp quyền xem mật khẩu là việc mở cửa, không phải sửa
             * một ô dữ liệu. Gỡ quyền đã hỏi lại từ đầu, mà chiều CẤP lại ghi thẳng: chiều
             * nguy hiểm hơn thì lại nhẹ tay hơn, ngược hẳn.
             *
             * Câu hỏi nêu đích danh AI, NHÓM NÀO và TẦNG gì — ba thứ mà bấm nhầm một ô trên
             * lưới là sai hết cả ba.
             */
            const ok = await askConfirm({
              title: t('access.confirmGrantTitle'),
              message: t('access.confirmGrant', {
                member: account.fullName,
                scope: scope.label,
                tier: t(`access.tier_${tier}`),
              }),
              confirmLabel: t('access.add'),
            });
            if (!ok) return;
            save.mutate(
              {
                memberEmail: account.email,
                scopeType: scope.scopeType,
                scopeRef: scope.scopeRef,
                tier,
                note: note.trim(),
              },
              { onSuccess: onSaved, onError: (err) => setError(errorMessage(err)) },
            );
          })();
        }}
      >
        <p className="muted">{t('access.tierHint')}</p>
        <Field label={t('access.tier')}>
          <Select
            value={tier}
            onChange={(value) => setTier(value as Tier)}
            ariaLabel={t('access.tier')}
            options={[
              { value: 'whitelist', label: t('access.tier_whitelist') },
              { value: 'needs_approval', label: t('access.tier_needs_approval') },
            ]}
          />
        </Field>
        <Field label={t('access.note')} htmlFor="access-cell-note">
          <input
            id="access-cell-note"
            className="inp"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {rule ? <p className="muted">{t('access.grantedByLine', { actor: rule.grantedBy })}</p> : null}
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/**
 * Gán MỘT nhóm đối tượng cho NHIỀU người một lượt — chiều ngược của `MultiGrantDialog`.
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
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ.
         `guardUnsaved`: chưa bấm Lưu mà lỡ Esc thì hỏi lại, đừng xoá trắng. */
      dismissible={!saving}
      guardUnsaved
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

/**
 * Gán NHIỀU nhóm cho MỘT người một lượt — "+ Thêm quyền" ở thẻ theo người và "Gán quyền" ở dòng
 * của lưới. Một nhân viên mới thường cần ba bốn nhóm cùng lúc (site mình trực, loại switch,
 * đường truyền); mở hộp ba bốn lần, mỗi lần chọn lại tầng, là chỗ dễ chọn nhầm nhất.
 *
 * Nhóm người này đã có không hiện ra: đổi tầng một nhóm sẵn có là việc của chip/ô của nhóm đó.
 */
function MultiGrantDialog({
  account,
  scopes,
  existing,
  csrfToken,
  onClose,
  onSaved,
}: {
  account: AccountRow;
  scopes: ScopeOption[];
  existing: AccessRule[];
  csrfToken: string;
  onClose: () => void;
  onSaved: (result: { granted: number; failures: string[] }) => void;
}) {
  const { t } = useTranslation();
  const askConfirm = useConfirm();
  const [picked, setPicked] = useState<string[]>([]);
  const [tier, setTier] = useState<Tier>('needs_approval');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useApiMutation<Record<string, unknown>, unknown>('/api/v1/vault/access', {
    csrfToken,
    refreshMe: false,
  });

  const had = new Set(existing.map(scopeKey));
  const groups = SCOPE_ORDER.map((type) => ({
    type,
    scopes: scopes
      .filter((scope) => scope.scopeType === type && !had.has(scopeKey(scope)))
      .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
  })).filter((group) => group.scopes.length > 0);

  const toggle = (key: string) =>
    setPicked((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì không cho đóng: hộp biến mất mà lượt ghi vẫn chạy, người dùng tưởng đã hủy. */
      dismissible={!saving}
      guardUnsaved
      maxWidth={600}
      title={t('access.grantTitle', { member: account.fullName })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="multi-grant-form" className="btn primary" disabled={saving}>
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="multi-grant-form"
        className="form-grid"
        data-columns={1}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (picked.length === 0) {
            setError(t('access.pickScopes'));
            return;
          }
          void (async () => {
            // Cấp quyền xem mật khẩu là mở cửa: nêu đích danh AI, BAO NHIÊU nhóm và TẦNG gì.
            const ok = await askConfirm({
              title: t('access.confirmGrantTitle'),
              message: t('access.confirmGrantMany', {
                member: account.fullName,
                count: picked.length,
                tier: t(`access.tier_${tier}`),
              }),
              confirmLabel: t('access.add'),
            });
            if (!ok) return;
            setSaving(true);
            let done = 0;
            const failures: string[] = [];
            for (const key of picked) {
              const scope = scopes.find((item) => scopeKey(item) === key);
              if (!scope) continue;
              try {
                await save.mutateAsync({
                  memberEmail: account.email,
                  scopeType: scope.scopeType,
                  scopeRef: scope.scopeRef,
                  tier,
                  note: note.trim(),
                });
                done += 1;
              } catch (err) {
                failures.push(`${scope.label}: ${errorMessage(err)}`);
              }
            }
            setSaving(false);
            if (done === 0) {
              setError(failures.join(' '));
              return;
            }
            // Nhóm gán hỏng phải được nói ra, kể cả khi có nhóm gán được.
            onSaved({ granted: done, failures });
          })();
        }}
      >
        {groups.length === 0 ? (
          <p className="muted">{t('access.allScopesGranted')}</p>
        ) : (
          groups.map((group) => (
            <fieldset key={group.type} className="ff-contents">
              <legend className="lbl-t">{t(`access.scope_${group.type}`)}</legend>
              <ul className="pick-list">
                {group.scopes.map((scope) => {
                  const key = scopeKey(scope);
                  return (
                    <li key={key}>
                      <label className="row" style={{ gap: 'var(--space-3)' }}>
                        <input
                          type="checkbox"
                          checked={picked.includes(key)}
                          onChange={() => toggle(key)}
                        />
                        <span>{scope.label}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))
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

        <Field label={t('access.note')} htmlFor="multi-grant-note">
          <input
            id="multi-grant-note"
            className="inp"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {picked.length > 1 ? (
          <p className="alert">{t('access.willGrantScopes', { count: picked.length })}</p>
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
