import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { Chevron } from '@/ui/chevron';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { PATHS } from '@/lib/routes';
import { SECRET_OWNER_KIND_KEY, SECRET_OWNER_TYPES, type SecretOwnerType } from '@/lib/secret-owner-kinds';
import type { Me } from '@/lib/me';
import { Dialog } from '@/ui/dialog';
import { FilterBar } from '@/ui/filter-bar';
import { PlusIcon } from '@/ui/glyph-icons';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { ScrollX } from '@/ui/scroll-x';
import { Select } from '@/ui/select';
import { TabPanel, Tabs } from '@/ui/tabs';
import { useConfirm } from '@/ui/confirm-provider';
import { useMediaQuery } from '@/ui/use-media-query';
import { NARROW_QUERY } from '@/ui/use-narrow';
import { useToast } from '@/ui/toast';
import { useStepUpRetry } from '@/ui/use-step-up-retry';
import { secretTextRule, useFormErrors } from '@/ui/use-form-errors';
import { foldSearch } from '@/lib/search-fold';
import { planCopy } from './access-copy';

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
  /** Mốc gán — "ai cấp và khi nào" là câu auditor hỏi. */
  createdAt?: string;
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
  status?: 'active' | 'locked' | 'disabled';
}

/** Huy hiệu trạng thái cạnh tên người — người đã nghỉ / đang khóa không được trông như người thường. */
/** Người dùng đóng hộp hỏi mã 6 số — đó là hủy, không phải lỗi để báo. */
function isStepUpCancelled(error: unknown): boolean {
  return (error as Error | null)?.message === 'STEPUP_CANCELLED';
}

function StatusTag({ account }: { account: AccountRow }) {
  const { t } = useTranslation();
  if (account.status === 'locked') {
    return <span className="badge warn plain">{t('accounts.statusLocked')}</span>;
  }
  if (account.status === 'disabled') {
    return <span className="badge danger plain">{t('accounts.statusDisabled')}</span>;
  }
  return null;
}

/**
 * Biểu tượng tầng quyền — SVG tô bằng `currentColor` chứ không emoji: emoji ⏳ vẽ khác nhau theo
 * hệ điều hành và không nhận màu token, nên ở chế độ tối gần như chìm.
 */
function TierIcon({ tier }: { tier: Tier | null }) {
  if (tier === 'whitelist') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 8.5 3.2 3L13 4.5" />
      </svg>
    );
  }
  if (tier === 'needs_approval') {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.8V8l2.2 1.6" />
      </svg>
    );
  }
  return <span aria-hidden="true">–</span>;
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
  /** Người đã vô hiệu hóa (nghỉ việc) mặc định ẨN — gán quyền cho họ là việc không ai cần làm. */
  const [showDisabled, setShowDisabled] = useState(false);
  const [checking, setChecking] = useState(false);
  /** Lọc CỘT của lưới theo họ nhóm đối tượng — '' là xem hết. */
  const [family, setFamily] = useState<'' | ScopeType>('');
  /** Chỉ bày cột CHƯA AI được gán — chỗ hổng của ma trận (bấm số ở dòng tổng là bật). */
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [grantingScope, setGrantingScope] = useState<ScopeOption | null>(null);
  const [addingFor, setAddingFor] = useState<AccountRow | null>(null);
  /** Người NHẬN của "Sao chép quyền từ…" — chọn đồng nghiệp nằm trong hộp. */
  const [copyingFor, setCopyingFor] = useState<AccountRow | null>(null);
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

  /*
   * POST/DELETE /vault/access đòi step-up: hết ân hạn thì server trả STEPUP_REQUIRED. Mọi lượt
   * ghi trên màn này phải đi qua `stepUp.run` — không thì người dùng chỉ thấy câu lỗi đỏ bảo
   * nhập mã mà không có ô nào để nhập.
   */
  const stepUp = useStepUpRetry(me.csrfToken);

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
    try {
      await stepUp.run(() => remove.mutateAsync({ id: rule.id }), t('access.stepUpRemove'));
      toast({ message: t('access.removed') });
      void refresh();
    } catch (error) {
      if (isStepUpCancelled(error)) return;
      toast({ message: errorMessage(error), tone: 'error' });
    }
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
    const assigned = new Set((rules.data ?? []).map(scopeKey));
    const wanted = (scopes.data ?? []).filter(
      (scope) =>
        (!family || scope.scopeType === family) && (!onlyEmpty || !assigned.has(scopeKey(scope))),
    );
    return SCOPE_ORDER.map((type) => ({
      type,
      label: t(`access.scope_${type}`),
      scopes: wanted
        .filter((scope) => scope.scopeType === type)
        .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
    })).filter((group) => group.scopes.length > 0);
  }, [scopes.data, rules.data, family, onlyEmpty, t]);

  const columns = columnGroups.flatMap((group) => group.scopes);
  /* Cột đầu của mỗi họ, trừ họ đầu tiên (cạnh nó đã là vạch của cột tên người): CSS kẻ vạch
     đậm hơn ở đó để mắt thấy ranh giới giữa các họ khi cuộn ngang. */
  const groupStarts = new Set(
    columnGroups.slice(1).map((group) => scopeKey(group.scopes[0])),
  );
  const colClass = (base: string, scope: ScopeOption) =>
    groupStarts.has(scopeKey(scope)) ? `${base} access-group-start` : base;

  const allAccounts = accounts.data ?? [];
  const members = allAccounts.filter(
    (account) => account.role === 'member' && (showDisabled || account.status !== 'disabled'),
  );
  const hiddenDisabled = allAccounts.filter(
    (account) => account.role === 'member' && account.status === 'disabled',
  ).length;
  const roleHolders = allAccounts.filter((account) => account.role !== 'member');
  // Gấp dấu cả hai vế: gõ `nguyen thi` phải ra `Nguyễn Thị`.
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

  const clearSearch = search ? (
    <button type="button" className="btn" onClick={() => setSearch('')}>
      {t('access.clearSearch')}
    </button>
  ) : undefined;

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
      onCopy={setCopyingFor}
      clearSearch={clearSearch}
      onOpenRule={(account, rule) =>
        setCell({
          account,
          rule,
          scope: { scopeType: rule.scopeType, scopeRef: rule.scopeRef, label: rule.scopeLabel },
        })
      }
    />
  ) : people.length === 0 ? (
    <EmptyState title={t('access.noPeople')} action={clearSearch} />
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
              <th className="access-row-head" rowSpan={2} scope="col">
                {t('access.person')}
              </th>
              {columnGroups.map((group) => (
                <th
                  key={group.type}
                  colSpan={group.scopes.length}
                  scope="colgroup"
                  className="access-family"
                >
                  {group.label}
                </th>
              ))}
            </tr>
            <tr>
              {columns.map((scope) => (
                <th key={scopeKey(scope)} scope="col" className={colClass('access-col', scope)}>
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
                    {/* Dấu + cho thấy tiêu đề cột BẤM ĐƯỢC — chỉ có tooltip thì không ai biết. */}
                    <PlusIcon className="access-col-plus" />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((account) => (
              <tr key={account.id}>
                <th scope="row" className="access-row-head">
                  <div className="access-row-head-inner">
                    <span className="access-person-text">
                      <span className="access-person" title={account.fullName}>
                        {account.fullName}
                      </span>
                      <span className="muted mono access-person-mail" title={account.email}>
                        {account.email}
                      </span>
                      <span className="access-person-tags">
                        <StatusTag account={account} />
                        <span className="badge muted plain">
                          {t('access.ruleCount', {
                            count: rulesOf.get(account.email.toLowerCase())?.length ?? 0,
                          })}
                        </span>
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn sm access-row-add"
                      aria-label={t('access.addFor', { member: account.fullName })}
                      title={t('access.addFor', { member: account.fullName })}
                      onClick={() => setAddingFor(account)}
                    >
                      <PlusIcon />
                    </button>
                  </div>
                </th>
                {columns.map((scope) => {
                  const key = scopeKey(scope);
                  const rule = ruleAt.get(`${account.email.toLowerCase()}|${key}`) ?? null;
                  return (
                    <td key={key} className={colClass('access-cell', scope)}>
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
                        <TierIcon tier={rule ? rule.tier : null} />
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
          <TierIcon tier="whitelist" />
        </span>{' '}
        {t('access.tier_whitelist')}
        {' · '}
        <span className="access-chip needs_approval" aria-hidden="true">
          <TierIcon tier="needs_approval" />
        </span>{' '}
        {t('access.tier_needs_approval')}
        {' · '}
        <span className="access-chip none" aria-hidden="true">
          <TierIcon tier={null} />
        </span>{' '}
        {t('access.tier_denied')}
      </p>
    </>
  );

  return (
    <>
      <PageHeader
        title={t('access.title')}
        subtitle={t('access.subtitle')}
        actions={
          <button type="button" className="btn" onClick={() => setChecking(true)}>
            {t('access.check')}
          </button>
        }
      />

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
          {view === 'matrix' ? (
            <label className="row filter-check">
              <input
                type="checkbox"
                checked={onlyEmpty}
                onChange={(event) => setOnlyEmpty(event.target.checked)}
              />
              <span>{t('access.onlyEmpty')}</span>
            </label>
          ) : null}
          <label className="row filter-check">
            <input
              type="checkbox"
              checked={showDisabled}
              onChange={(event) => setShowDisabled(event.target.checked)}
            />
            <span>{t('access.showDisabled', { count: hiddenDisabled })}</span>
          </label>
        </FilterBar>

        {/* Mặc định-không-có-quyền và dòng tổng là MỘT khối thông tin: tách hai thì câu chú thích
            trông như chữ lạc, và cỡ chữ lộn thứ bậc. Dòng tổng chỉ hiện khi CẢ BA truy vấn xong
            và không lỗi — thiếu một cái là mọi con số ở đây thành số bịa. */}
        <div className="alert info access-intro">
          <p>{t('access.defaultDenied')}</p>
          {!loading && !failed ? (
            <p>
              {t('access.summaryMain', {
                people: members.length,
                rules: totalRules,
                scopes: allScopes.length,
              })}{' '}
              {/* Số nhóm chưa gán là một LỐI LỌC: bấm là sang lưới, chỉ còn đúng các cột trống.
                  Điện thoại không có lưới nên giữ chữ thường. */}
              {emptyScopes > 0 && !narrow ? (
                <button
                  type="button"
                  className="btn ghost sm"
                  aria-pressed={view === 'matrix' && onlyEmpty}
                  onClick={() => {
                    setOnlyEmpty(true);
                    setFamily('');
                    setParam('view', 'matrix');
                  }}
                >
                  {t('access.summaryEmpty', { count: emptyScopes })}
                </button>
              ) : (
                t('access.summaryEmpty', { count: emptyScopes })
              )}
            </p>
          ) : null}
        </div>

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

      {copyingFor ? (
        <CopyFromDialog
          account={copyingFor}
          members={members}
          rulesOf={rulesOf}
          csrfToken={me.csrfToken}
          onClose={() => setCopyingFor(null)}
          onSaved={({ granted, failures, source }) => {
            setCopyingFor(null);
            toast({ message: t('access.copyDone', { count: granted, source: source.fullName }) });
            for (const failure of failures) toast({ message: failure, tone: 'warn' });
            void refresh();
          }}
        />
      ) : null}

      {checking ? (
        <CheckAccessDialog
          members={members}
          rulesOf={rulesOf}
          scopes={allScopes}
          onClose={() => setChecking(false)}
        />
      ) : null}

      {grantingScope ? (
        <GrantToScopeDialog
          scope={grantingScope}
          members={members}
          existing={ruleAt}
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

      {stepUp.dialog}
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
  onCopy,
  onOpenRule,
  clearSearch,
}: {
  people: AccountRow[];
  selected: AccountRow | null;
  narrow: boolean;
  rulesOf: Map<string, AccessRule[]>;
  onSelect: (account: AccountRow | null) => void;
  onAdd: (account: AccountRow) => void;
  onCopy: (account: AccountRow) => void;
  onOpenRule: (account: AccountRow, rule: AccessRule) => void;
  /** Nút "Xoá tìm kiếm" cho câu rỗng — chỉ có khi ô tìm đang có chữ. */
  clearSearch?: ReactNode;
}) {
  const { t } = useTranslation();
  const showList = !narrow || !selected;
  const showDetail = selected !== null;

  return (
    <div className="access-people">
      {showList ? (
        people.length === 0 ? (
          <EmptyState title={t('access.noPeople')} action={clearSearch} />
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
                        <StatusTag account={account} />
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
          onCopy={() => onCopy(selected)}
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
  onCopy,
  onOpenRule,
}: {
  account: AccountRow;
  rules: AccessRule[];
  onBack?: () => void;
  onAdd: () => void;
  onCopy: () => void;
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
        <button type="button" className="btn sm with-icon" onClick={onBack}>
          <Chevron direction="left" />
          {t('access.backToList')}
        </button>
      ) : null}
      <div className="access-person-head">
        <div>
          <h2 id="access-person-title">{account.fullName}</h2>
          <span className="muted mono">{account.email}</span>
        </div>
        <div className="detail-actions">
          <button type="button" className="btn" onClick={onCopy}>
            {t('access.copyFrom')}
          </button>
          <button type="button" className="btn primary" onClick={onAdd}>
            {t('access.addRules')}
          </button>
        </div>
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
  const check = useFormErrors({ note: secretTextRule(t, note) });
  const stepUp = useStepUpRetry(csrfToken);

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
          {/* Gỡ đứng TÁCH ở mép trái, viền đỏ chứ không đỏ đặc: nó là hành động phá, không phải
              một lựa chọn ngang hàng với "Lưu" ngay bên cạnh. Vẫn đi qua câu hỏi lại của `removeRule`. */}
          {rule ? (
            <>
              <button type="button" className="btn danger-ghost" onClick={onRemove}>
                {t('access.remove')}
              </button>
              <span className="spacer" />
            </>
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
        ref={check.formRef}
        noValidate
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          void (async () => {
            /*
             * Chỉ HỎI LẠI khi nâng lên "Xem thẳng" — tầng mở cửa rộng nhất (xem không cần ai
             * duyệt). Người dùng đã mở đúng ô, đã chọn tầng và đọc câu hệ quả ngay trong hộp;
             * bắt xác nhận lần hai cả khi chỉ sửa ghi chú là thừa. Câu hỏi nêu đích danh AI,
             * NHÓM NÀO và TẦNG gì — ba thứ bấm nhầm một ô trên lưới là sai hết cả ba.
             */
            if (tier === 'whitelist' && rule?.tier !== 'whitelist') {
              const ok = await askConfirm({
                title: t('access.confirmGrantTitle'),
                message: t('access.confirmGrant', {
                  member: account.fullName,
                  scope: scope.label,
                  tier: t(`access.tier_${tier}`),
                }),
                confirmLabel: t(rule ? 'common.save' : 'access.add'),
              });
              if (!ok) return;
            }
            try {
              await stepUp.run(
                () =>
                  save.mutateAsync({
                    memberEmail: account.email,
                    scopeType: scope.scopeType,
                    scopeRef: scope.scopeRef,
                    tier,
                    note: note.trim(),
                  }),
                t('access.stepUpGrant'),
              );
              onSaved();
            } catch (err) {
              if (isStepUpCancelled(err)) return;
              setError(errorMessage(err));
            }
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
        <Field label={t('access.note')} htmlFor="access-cell-note" error={check.error('note')}>
          <input
            id="access-cell-note"
            className="inp"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <p className="muted">{t(`access.consequence_${tier}`)}</p>
        {rule ? (
          <p className="muted">
            {rule.createdAt
              ? t('access.grantedByAt', { actor: rule.grantedBy, date: formatDate(rule.createdAt) })
              : t('access.grantedByLine', { actor: rule.grantedBy })}{' '}
            <Link to={`${PATHS.adminAuditLog}?objectId=${encodeURIComponent(rule.id)}`}>
              {t('access.ruleHistory')}
            </Link>
          </p>
        ) : null}
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      {stepUp.dialog}
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
  existing,
  csrfToken,
  onClose,
  onSaved,
}: {
  scope: ScopeOption;
  members: AccountRow[];
  /** `email|scopeType|scopeRef` → luật đang có. POST là UPSERT: chọn người đã có quyền là ĐỔI tầng của họ. */
  existing: Map<string, AccessRule>;
  csrfToken: string;
  onClose: () => void;
  onSaved: (result: { granted: number; failures: string[] }) => void;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [tier, setTier] = useState<Tier>('needs_approval');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const check = useFormErrors({ note: secretTextRule(t, note) });
  const stepUp = useStepUpRetry(csrfToken);

  const save = useApiMutation<Record<string, unknown>, unknown>('/api/v1/vault/access', {
    csrfToken,
    refreshMe: false,
  });

  const toggle = (email: string) =>
    setPicked((current) =>
      current.includes(email) ? current.filter((item) => item !== email) : [...current, email],
    );
  const ruleOf = (member: AccountRow) =>
    existing.get(`${member.email.toLowerCase()}|${scopeKey(scope)}`) ?? null;
  const term = foldSearch(query.trim());
  const shown = members.filter(
    (member) =>
      !term || foldSearch(member.fullName).includes(term) || foldSearch(member.email).includes(term),
  );
  /* Tóm tắt trước khi lưu: bao nhiêu người mới, bao nhiêu người ĐỔI tầng (và đổi từ gì). */
  const pickedMembers = members.filter((member) => picked.includes(member.email));
  const adds = pickedMembers.filter((member) => !ruleOf(member)).length;
  const changes = pickedMembers.filter((member) => {
    const rule = ruleOf(member);
    return rule !== null && rule.tier !== tier;
  }).length;

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
        ref={check.formRef}
        noValidate
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          if (picked.length === 0) {
            setError(t('access.pickPeople'));
            return;
          }
          void (async () => {
            setSaving(true);
            let done = 0;
            const failures: string[] = [];
            /* Lượt đầu hỏi mã (nếu hết ân hạn); các lượt sau nằm trong ân hạn nên đi thẳng.
               Đóng hộp hỏi mã = dừng cả lượt, không hỏi lại cho từng người còn lại. */
            for (const memberEmail of picked) {
              try {
                await stepUp.run(
                  () =>
                    save.mutateAsync({
                      memberEmail,
                      scopeType: scope.scopeType,
                      scopeRef: scope.scopeRef,
                      tier,
                      note: note.trim(),
                    }),
                  t('access.stepUpGrant'),
                );
                done += 1;
              } catch (err) {
                if (isStepUpCancelled(err)) break;
                failures.push(`${memberEmail}: ${errorMessage(err)}`);
              }
            }
            setSaving(false);
            if (done === 0 && failures.length === 0) return;
            if (done === 0) {
              setError(failures.join(' '));
              return;
            }
            /*
             * Người GÁN HỎNG phải được nói ra, kể cả khi có người gán được.
             *
             * Chọn 5 người mà 3 người đã có luật trên nhóm đó (POST từ chối trùng): chỉ đóng
             * hộp và báo "đã gán cho 2 người" thì ba lỗi biến mất — SA tin là cả 5 đã có
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
            <div className="row pick-tools">
              <input
                className="inp search grow"
                type="search"
                value={query}
                aria-label={t('access.search')}
                placeholder={t('access.search')}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  setPicked((current) => [
                    ...current,
                    ...shown.map((member) => member.email).filter((email) => !current.includes(email)),
                  ])
                }
              >
                {t('access.pickAll')}
              </button>
              <button type="button" className="btn sm" onClick={() => setPicked([])}>
                {t('access.pickNone')}
              </button>
            </div>
            <ul className="pick-list">
              {shown.map((member) => {
                const rule = ruleOf(member);
                return (
                  <li key={member.id}>
                    <label className="row" style={{ gap: 'var(--space-3)' }}>
                      <input
                        type="checkbox"
                        checked={picked.includes(member.email)}
                        onChange={() => toggle(member.email)}
                      />
                      <span>
                        {member.fullName} <span className="muted mono">{member.email}</span>{' '}
                        <StatusTag account={member} />
                        {rule ? (
                          <span className={`badge plain ${rule.tier === 'whitelist' ? 'ok' : 'warn'}`}>
                            {t('access.currentTier', { tier: t(`access.tier_${rule.tier}`) })}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}

        <Field label={t('access.tier')} tip={t('access.tierHint')}>
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

        <Field label={t('access.note')} htmlFor="grant-scope-note" error={check.error('note')}>
          <input
            id="grant-scope-note"
            className="inp"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>

        {/* Nói TRƯỚC sẽ ghi gì — gán một lượt cho năm người là chuyện dễ đếm nhầm, và chọn một
            người đã có quyền là lặng lẽ ĐỔI tầng của họ. */}
        {picked.length > 0 ? (
          <p className="alert">{t('access.willGrantSummary', { adds, changes })}</p>
        ) : null}

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      {stepUp.dialog}
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
  const check = useFormErrors({ note: secretTextRule(t, note) });
  const stepUp = useStepUpRetry(csrfToken);

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
        ref={check.formRef}
        className="form-grid"
        data-columns={1}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
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
                await stepUp.run(
                  () =>
                    save.mutateAsync({
                      memberEmail: account.email,
                      scopeType: scope.scopeType,
                      scopeRef: scope.scopeRef,
                      tier,
                      note: note.trim(),
                    }),
                  t('access.stepUpGrant'),
                );
                done += 1;
              } catch (err) {
                // Đóng hộp hỏi mã = dừng cả lượt, không hỏi lại cho từng nhóm còn lại.
                if (isStepUpCancelled(err)) break;
                failures.push(`${scope.label}: ${errorMessage(err)}`);
              }
            }
            setSaving(false);
            if (done === 0 && failures.length === 0) return;
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

        <Field label={t('access.tier')} tip={t('access.tierHint')}>
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

        <Field label={t('access.note')} htmlFor="multi-grant-note" error={check.error('note')}>
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
      {stepUp.dialog}
    </Dialog>
  );
}

/**
 * "Sao chép quyền từ…" — người mới vào tổ thường cần đúng bộ quyền của một đồng nghiệp cùng tổ.
 * Gán tay từng nhóm là chỗ dễ sót một nhóm hoặc chọn nhầm tầng.
 *
 * Chỉ dùng API gán sẵn có (`POST /vault/access`, SA/Admin + step-up) — mỗi nhóm một dòng, một
 * dòng nhật ký, như gán tay. Nhóm người nhận đã có thì BỎ QUA chứ không ghi đè: POST là upsert,
 * gửi lại là lặng lẽ đổi tầng một quyết định đã đặt riêng cho người này (`planCopy`).
 */
function CopyFromDialog({
  account,
  members,
  rulesOf,
  csrfToken,
  onClose,
  onSaved,
}: {
  account: AccountRow;
  members: AccountRow[];
  rulesOf: Map<string, AccessRule[]>;
  csrfToken: string;
  onClose: () => void;
  onSaved: (result: { granted: number; failures: string[]; source: AccountRow }) => void;
}) {
  const { t } = useTranslation();
  const askConfirm = useConfirm();
  const stepUp = useStepUpRetry(csrfToken);
  const [sourceId, setSourceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = useApiMutation<Record<string, unknown>, unknown>('/api/v1/vault/access', {
    csrfToken,
    refreshMe: false,
  });

  const rulesFor = (member: AccountRow) => rulesOf.get(member.email.toLowerCase()) ?? [];
  // Đồng nghiệp chưa có quyền nào thì không có gì để chép — không bày ra làm nhiễu ô chọn.
  const colleagues = members.filter(
    (member) => member.id !== account.id && rulesFor(member).length > 0,
  );
  const source = colleagues.find((member) => member.id === sourceId) ?? null;
  const plan = source ? planCopy(rulesFor(source), rulesFor(account)) : null;
  const byLabel = (a: AccessRule, b: AccessRule) =>
    SCOPE_ORDER.indexOf(a.scopeType) - SCOPE_ORDER.indexOf(b.scopeType) ||
    a.scopeLabel.localeCompare(b.scopeLabel, 'vi');
  const line = (rule: AccessRule) => `${rule.scopeLabel} · ${t(`access.tier_${rule.tier}`)}`;

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì không cho đóng: hộp biến mất mà lượt ghi vẫn chạy, người dùng tưởng đã hủy. */
      dismissible={!saving}
      maxWidth={560}
      title={t('access.copyTitle', { member: account.fullName })}
      footer={
        <>
          <button type="button" className="btn" disabled={saving} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="copy-access-form" className="btn primary" disabled={saving}>
            {saving ? t('common.loading') : t('access.add')}
          </button>
        </>
      }
    >
      <form
        id="copy-access-form"
        className="form-grid"
        data-columns={1}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!source || !plan) {
            setError(t('access.copyNeedSource'));
            return;
          }
          if (plan.grant.length === 0) {
            setError(t('access.copyNothing'));
            return;
          }
          void (async () => {
            // Cấp quyền xem mật khẩu là mở cửa: nêu đích danh AI, GIỐNG AI và BAO NHIÊU nhóm.
            const ok = await askConfirm({
              title: t('access.confirmGrantTitle'),
              message: t('access.confirmCopy', {
                member: account.fullName,
                source: source.fullName,
                count: plan.grant.length,
              }),
              confirmLabel: t('access.add'),
            });
            if (!ok) return;
            setSaving(true);
            let done = 0;
            const failures: string[] = [];
            for (const rule of plan.grant) {
              try {
                await stepUp.run(() =>
                  save.mutateAsync({
                    memberEmail: account.email,
                    scopeType: rule.scopeType,
                    scopeRef: rule.scopeRef,
                    tier: rule.tier,
                    note: t('access.copyNote', { source: source.email }),
                  }),
                  t('access.stepUpCopy', { name: account.fullName }),
                );
                done += 1;
              } catch (err) {
                // Đóng hộp hỏi mã = dừng cả lượt, không hỏi lại cho từng nhóm còn lại.
                if (isStepUpCancelled(err)) break;
                failures.push(`${rule.scopeLabel}: ${errorMessage(err)}`);
              }
            }
            setSaving(false);
            if (done === 0 && failures.length === 0) return;
            if (done === 0) {
              setError(failures.join(' '));
              return;
            }
            // Nhóm chép hỏng phải được nói ra, kể cả khi có nhóm chép được.
            onSaved({ granted: done, failures, source });
          })();
        }}
      >
        {colleagues.length === 0 ? (
          <p className="muted">{t('access.copyNoColleague')}</p>
        ) : (
          <Field label={t('access.copySource')} tip={t('access.copyHint')}>
            <Select
              value={sourceId}
              onChange={setSourceId}
              ariaLabel={t('access.copySource')}
              placeholder={t('access.copyPickSource')}
              options={colleagues.map((member) => ({
                value: member.id,
                label: t('access.copySourceOption', {
                  name: member.fullName,
                  count: rulesFor(member).length,
                }),
              }))}
            />
          </Field>
        )}

        {plan ? (
          <>
            {plan.grant.length > 0 ? (
              <section aria-labelledby="copy-access-grant">
                <h3 id="copy-access-grant" className="lbl-t">
                  {t('access.copyWillGrant', { count: plan.grant.length })}
                </h3>
                <ul>
                  {[...plan.grant].sort(byLabel).map((rule) => (
                    <li key={rule.id}>{line(rule)}</li>
                  ))}
                </ul>
              </section>
            ) : (
              <p className="muted">{t('access.copyNothing')}</p>
            )}
            {plan.alreadyHas.length > 0 ? (
              <section aria-labelledby="copy-access-kept">
                <h3 id="copy-access-kept" className="lbl-t">
                  {t('access.copyAlreadyHas', { count: plan.alreadyHas.length })}
                </h3>
                <ul className="muted">
                  {[...plan.alreadyHas].sort(byLabel).map((rule) => (
                    <li key={rule.id}>{line(rule)}</li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      {stepUp.dialog}
    </Dialog>
  );
}

const OWNER_LIST_PATH: Record<SecretOwnerType, string> = {
  device: '/api/v1/devices',
  software: '/api/v1/software',
  service_account: '/api/v1/service-accounts',
  isp: '/api/v1/isp-lines',
};

/** Họ nhóm quyền liên quan tới một loại hồ sơ — để kể ra "vì sao" bên cạnh kết quả. */
const OWNER_SCOPES: Record<SecretOwnerType, ScopeType[]> = {
  device: ['device_site', 'device_type'],
  software: ['software_kind'],
  service_account: ['service_account_kind'],
  isp: ['isp_provider'],
};

/**
 * "Người X có xem được két của hồ sơ Y không?" — trả lời bằng CHÍNH hàm quyết định của API
 * (`GET /vault/access/tier`), không tự suy ở web: web đoán sai một lần là SA tin nhầm một lỗ hổng
 * đã được bịt. Kèm các dòng quyền của người đó thuộc họ nhóm liên quan để người đọc tự đối chiếu.
 */
/** `GET /vault/access/tier` — tầng, nhóm của hồ sơ, và dòng quyền đã khớp (dòng quyết định đầu). */
interface TierExplain {
  tier: Tier | 'denied';
  groups?: { scopeType: ScopeType; scopeRef: string }[];
  matched?: { scopeType: ScopeType; scopeRef: string; tier: Tier }[];
}

function CheckAccessDialog({
  members,
  rulesOf,
  scopes,
  onClose,
}: {
  members: AccountRow[];
  rulesOf: Map<string, AccessRule[]>;
  scopes: ScopeOption[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [memberId, setMemberId] = useState('');
  const [ownerType, setOwnerType] = useState<SecretOwnerType>('device');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(TierExplain & { label: string }) | null>(null);
  const scopeLabel = (scope: { scopeType: string; scopeRef: string }) =>
    scopes.find((item) => scopeKey(item) === scopeKey(scope))?.label ?? scope.scopeRef;
  const member = members.find((item) => item.id === memberId) ?? null;
  const related = member
    ? (rulesOf.get(member.email.toLowerCase()) ?? []).filter((rule) =>
        OWNER_SCOPES[ownerType].includes(rule.scopeType),
      )
    : [];

  const run = async () => {
    setError(null);
    setResult(null);
    if (!member || !code.trim()) {
      setError(t('access.checkNeedInput'));
      return;
    }
    setBusy(true);
    try {
      const list = await apiFetch<{ items: { id: string; code: string; name?: string | null }[] }>(
        `${OWNER_LIST_PATH[ownerType]}?search=${encodeURIComponent(code.trim())}&limit=10`,
      );
      const wanted = code.trim().toLowerCase();
      const found = list.items.find((item) => item.code.toLowerCase() === wanted) ?? null;
      if (!found) {
        setError(t('access.checkNotFound', { code: code.trim() }));
        return;
      }
      const answer = await apiFetch<TierExplain>(
        `/api/v1/vault/access/tier?ownerType=${ownerType}&ownerId=${found.id}&memberEmail=${encodeURIComponent(member.email)}`,
      );
      setResult({ ...answer, label: [found.code, found.name].filter(Boolean).join(' — ') });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={560}
      title={t('access.checkTitle')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.close')}
          </button>
          <button type="submit" form="access-check-form" className="btn primary" disabled={busy}>
            {busy ? t('common.loading') : t('access.checkRun')}
          </button>
        </>
      }
    >
      <form
        id="access-check-form"
        className="form-grid"
        data-columns={1}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <Field label={t('access.person')}>
          <Select
            value={memberId}
            ariaLabel={t('access.person')}
            placeholder={t('access.checkPickPerson')}
            options={members.map((item) => ({ value: item.id, label: `${item.fullName} — ${item.email}` }))}
            onChange={setMemberId}
          />
        </Field>
        <Field label={t('access.checkOwnerType')}>
          <Select
            value={ownerType}
            ariaLabel={t('access.checkOwnerType')}
            options={SECRET_OWNER_TYPES.map((type) => ({ value: type, label: t(SECRET_OWNER_KIND_KEY[type]) }))}
            onChange={(value) => setOwnerType(value as SecretOwnerType)}
          />
        </Field>
        <Field label={t('access.checkCode')} htmlFor="access-check-code">
          <input
            id="access-check-code"
            className="inp mono"
            value={code}
            placeholder={t('access.checkCodePlaceholder')}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
        {result && member ? (
          <div className="alert info" role="status">
            <p>
              {t('access.checkResult', {
                member: member.fullName,
                record: result.label,
                tier: t(`access.tier_${result.tier === 'denied' ? 'denied' : result.tier}`),
              })}
            </p>
            {result.groups && result.groups.length > 0 ? (
              <p>
                {t('access.checkGroups', {
                  groups: result.groups.map(scopeLabel).join(' · '),
                })}
              </p>
            ) : null}
            {/* Dòng quyết định tầng — chỉ đúng chỗ phải gỡ nếu muốn siết. */}
            {result.matched && result.matched.length > 0 ? (
              <p>
                <strong>
                  {t('access.checkBecause', {
                    scope: scopeLabel(result.matched[0]),
                    tier: t(`access.tier_${result.matched[0].tier}`),
                  })}
                </strong>
                {result.matched.length > 1
                  ? ` ${t('access.checkAlsoMatched', { count: result.matched.length - 1 })}`
                  : null}
              </p>
            ) : null}
            {related.length > 0 ? (
              <>
                <p>{t('access.checkRelated')}</p>
                <ul>
                  {related.map((rule) => (
                    <li key={rule.id}>
                      {rule.scopeLabel} · {t(`access.tier_${rule.tier}`)}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>{t('access.checkNoRelated')}</p>
            )}
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
