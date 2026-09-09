import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import type { Me } from '@/lib/me';
import { Dialog } from '@/ui/dialog';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';

/** Phải khớp `SCOPE_TYPES` bên API (`access-tier.ts`) và CHECK ở tầng DB. */
type ScopeType =
  | 'device_site'
  | 'device_type'
  | 'software_kind'
  | 'service_account_kind'
  | 'isp_provider';
type Tier = 'whitelist' | 'needs_approval';

/** Thứ tự cột trên lưới — gom theo họ, không theo thứ tự API trả về. */
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

/**
 * Ma trận quyền xem secret (story 6.2, FR-023) — dựng lại 28/08/2026 thành LƯỚI THẬT.
 *
 * Bản trước là hai danh sách thẻ và phải bấm qua lại giữa chúng: một chiều trả lời "anh Hùng
 * xem được gì", chiều kia trả lời "site này ai xem được". Nhưng đó là hai lát cắt của CÙNG
 * một bảng hai chiều — và chính cái tên "ma trận" đã hứa đúng cái bảng đó.
 *
 * Lưới trả lời cả hai câu cùng lúc mà không phải bấm gì: đọc theo HÀNG ra câu thứ nhất, đọc
 * theo CỘT ra câu thứ hai. Quan trọng hơn: chỗ HỔNG hiện ra thành một mảng ô trống liền nhau
 * — thứ mà hai danh sách thẻ không bao giờ cho thấy.
 *
 * Vì sao có bộ lọc cột: từ 0036 có năm họ nhóm đối tượng, cộng lại vài chục cột. Xem hết một
 * lúc là cuộn ngang mỏi tay; lọc theo họ thì mỗi lượt soi đúng một câu hỏi.
 */
export function AccessMatrixScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  /** Lọc CỘT theo họ nhóm đối tượng — '' là xem hết. */
  const [family, setFamily] = useState<'' | ScopeType>('');
  const [grantingScope, setGrantingScope] = useState<ScopeOption | null>(null);
  /** Ô đang mở để đặt/gỡ quyền. `rule` null = ô trống, tức là đang gán mới. */
  const [cell, setCell] = useState<{
    account: AccountRow;
    scope: ScopeOption;
    rule: AccessRule | null;
  } | null>(null);

  const rules = useQuery({
    queryKey: ['vault', 'access'],
    queryFn: () => apiFetch<AccessRule[]>('/api/v1/vault/access'),
  });

  // Danh sách nhóm đối tượng dựng nên CÁC CỘT — tải sẵn ở đây để lưới hiện được cả nhóm CHƯA
  // ai được gán (chỗ hổng cần thấy nhất), không chỉ nhóm tình cờ đã có quyền.
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
   * Gỡ một dòng quyền — dùng CHUNG cho mọi chỗ gỡ trên màn này (AD-15).
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

  /**
   * Tra ô: `email|scopeType|scopeRef` → luật.
   *
   * Một `Map` chứ không phải `.find()` trong từng ô: lưới là N người × M cột, nên tìm tuyến
   * tính ở mỗi ô là N×M×số-luật lượt so chuỗi cho mỗi lần render.
   */
  const ruleAt = useMemo(() => {
    const map = new Map<string, AccessRule>();
    for (const rule of rules.data ?? []) {
      map.set(`${rule.memberEmail.toLowerCase()}|${rule.scopeType}|${rule.scopeRef}`, rule);
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

  const people = (accounts.data?.items ?? []).filter((account) => {
    const term = search.trim().toLowerCase();
    if (!term) return true;
    return (
      account.email.toLowerCase().includes(term) ||
      account.fullName.toLowerCase().includes(term)
    );
  });

  const totalRules = (rules.data ?? []).length;
  /*
   * Đếm trên TOÀN BỘ, không phải trên tập đang lọc.
   *
   * Dòng tổng đọc như một con số toàn cục. Tính từ danh sách đã lọc theo ô tìm thì gõ một chữ
   * là mọi con số tụt theo — một con số rà soát mà lại nói về một lát cắt, không ai biết.
   */
  const scopedRules = new Set(
    (rules.data ?? []).map((rule) => `${rule.scopeType}|${rule.scopeRef}`),
  );
  const allScopes = scopes.data ?? [];
  const totalPeople = (accounts.data?.items ?? []).length;
  const emptyScopes = allScopes.filter(
    (scope) => !scopedRules.has(`${scope.scopeType}|${scope.scopeRef}`),
  ).length;

  const loading = rules.isLoading || accounts.isLoading || scopes.isLoading;
  const failed = rules.isError || accounts.isError || scopes.isError;

  return (
    <>
      <PageHeader title={t('access.title')} subtitle={t('access.subtitle')} />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('access.search')}
      >
        {/* Lọc CỘT, không lọc dòng: ô tìm ở bên đã lo phần người. */}
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
      </FilterBar>

      <p className="alert">{t('access.defaultDenied')}</p>

      {/* Dòng tổng: lỗ hổng của ma trận là những nhóm CHƯA ai được gán, mà thứ đó không nhìn
          ra được khi phải rà từng thẻ.

          Chỉ hiện khi CẢ BA truy vấn xong và không lỗi — thiếu một cái là mọi con số ở đây
          thành số bịa, và trên đúng cái màn sinh ra để soi chỗ hổng thì một request hỏng lại
          đọc thành giấy chứng nhận sạch sẽ. */}
      {!loading && !failed ? (
        <p className="muted">
          {t('access.summary', {
            people: totalPeople,
            rules: totalRules,
            scopes: allScopes.length,
            empty: emptyScopes,
          })}
        </p>
      ) : null}

      {loading ? (
        <Loading />
      ) : rules.isError ? (
        <LoadError onRetry={() => void rules.refetch()} />
      ) : scopes.isError ? (
        // CỘT dựng từ `scopes`: thiếu nó thì lưới còn mỗi cột tên người — mọi nhóm chưa ai
        // được gán biến mất, đúng tập mà màn này sinh ra để chỉ ra.
        <LoadError onRetry={() => void scopes.refetch()} />
      ) : accounts.isError ? (
        // DÒNG dựng từ `accounts`: thiếu nó thì lưới rỗng và đọc như "hệ thống chưa có ai",
        // chứ không phải một request hỏng.
        <LoadError onRetry={() => void accounts.refetch()} />
      ) : people.length === 0 ? (
        <EmptyState title={t('access.noPeople')} />
      ) : columns.length === 0 ? (
        <EmptyState title={t('access.noScopes')} />
      ) : (
        /* Cuộn ngang TRONG khung này, không phải cả trang — vài chục cột là chuyện bình
           thường, mà trang cuộn ngang thì cột tên người trôi mất và lưới hết đọc được. */
        <div className="table-wrap access-grid-wrap" data-testid="access-grid">
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
                  <th key={`${scope.scopeType}|${scope.scopeRef}`} className="access-col">
                    {/* Bấm tiêu đề cột = gán nhóm này cho NHIỀU người một lượt. Mở vòng an
                        toàn cho một site thường là việc của cả tổ trực, không phải một người. */}
                    <button
                      type="button"
                      className="access-col-btn"
                      /* Nhãn TRỢ NĂNG là câu đầy đủ, còn chữ hiện ra đã cắt tiền tố họ: người
                         dùng bàn phím / trình đọc màn hình không có hàng tiêu đề nhóm ở trên
                         để suy ra bối cảnh như người nhìn bằng mắt. */
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
                    {account.role === 'member' ? (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setAdding(account.email)}
                      >
                        {t('access.add')}
                      </button>
                    ) : null}
                  </th>

                  {/* SA/Admin xem được mọi thứ theo VAI — vẽ ô cho họ là mời người ta gán một
                      quyền không có tác dụng gì, rồi tưởng là đã siết. */}
                  {account.role !== 'member' ? (
                    <td colSpan={columns.length} className="access-by-role muted">
                      {t('access.adminNote')}
                    </td>
                  ) : (
                    columns.map((scope) => {
                      const key = `${scope.scopeType}|${scope.scopeRef}`;
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
                    })
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !failed && columns.length > 0 ? (
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
      ) : null}

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
