import { useState } from 'react';
import type { ExpiryKind } from '@/lib/expiry-kinds';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { parseRecipients, recipientSuggestions } from './digest-recipients';
import { Dialog } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { RowActions } from '@/ui/row-actions';
import { SchedulePicker, describeSchedule, type ScheduleValue } from '@/ui/schedule-picker';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';
import { useFormErrors } from '@/ui/use-form-errors';

/** Khoảng hợp lệ của "Trong vòng (ngày)" — cùng mốc xa nhất của bộ lọc màn Sắp hết hạn. */
const WITHIN_MIN = 1;
const WITHIN_MAX = 365;

interface DigestRule {
  id: string;
  name: string;
  kinds: string[];
  withinDays: number;
  recipients: string[];
  frequency: 'daily' | 'weekly' | 'monthly';
  hour: number;
  weekday: number | null;
  dayOfMonth: number | null;
  active: boolean;
  lastSentAt: string | null;
  /** Kỳ gửi tới do API tính theo đúng luật của lượt quét; luật tạm ngưng thì null. */
  nextSendAt: string | null;
}

interface DigestPreview {
  total: number;
  expired: number;
  upcoming: number;
  recipients: string[];
  items: { label: string; kind: string; end: string; link: string; daysLeft: number }[];
}

/**
 * Luật gửi báo cáo "sắp hết hạn" (FR-013).
 *
 * MỘT luật = MỘT email tổng hợp theo kỳ. Nút "Gửi thử" là thứ quan trọng nhất màn này:
 * không có nó thì cấu hình xong phải chờ tới thứ Hai mới biết có chạy đúng không.
 */
export function DigestRulesPanel({
  me,
  kinds,
  adding,
  onAddingChange,
}: {
  me: Me;
  kinds: ExpiryKind[];
  /** Nút "Thêm luật" nằm ở đầu trang (PageHeader) — màn cha giữ cờ mở hộp thêm. */
  adding: boolean;
  onAddingChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [editingRule, setEditingRule] = useState<DigestRule | null>(null);
  const [previewing, setPreviewing] = useState<DigestRule | null>(null);
  const editing = editingRule ? { rule: editingRule } : adding ? { rule: null } : null;
  const setEditing = (next: { rule: DigestRule | null } | null) => {
    setEditingRule(next?.rule ?? null);
    onAddingChange(!!next && next.rule === null);
  };

  const canEdit = me.role === 'sa' || me.role === 'admin';

  const rules = useQuery({
    queryKey: ['expiry', 'rules'],
    queryFn: () => apiFetch<DigestRule[]>('/api/v1/expiry/rules'),
  });

  const remove = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/expiry/rules/${input.id}`,
    { method: 'DELETE', csrfToken: me.csrfToken, refreshMe: false, body: () => undefined },
  );
  const toggle = useApiMutation<{ id: string; active: boolean }, unknown>(
    (input) => `/api/v1/expiry/rules/${input.id}`,
    { method: 'PATCH', csrfToken: me.csrfToken, refreshMe: false, body: ({ active }) => ({ active }) },
  );
  const sendTest = useApiMutation<
    { id: string; onlyMe?: boolean },
    { recipients: string[]; items: number }
  >((input) => `/api/v1/expiry/rules/${input.id}/test`, {
    csrfToken: me.csrfToken,
    refreshMe: false,
    body: (input) => (input.onlyMe ? { onlyMe: true } : undefined),
  });
  const testSentToast = (result: { recipients: string[]; items: number }) =>
    toast({
      message: t('digest.testSent', { count: result.items, to: result.recipients.join(', ') }),
    });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['expiry', 'rules'] });
  const kindLabel = (value: string) =>
    kinds.find((item) => item.kind === value)?.label ?? value;

  const rows = rules.data ?? [];

  return (
    <div className="attachment-panel">
      {canEdit ? null : <p className="muted">{t('digest.readOnly')}</p>}

      {rules.isLoading ? (
        <Loading />
      ) : rules.isError ? (
        <LoadError error={rules.error} onRetry={() => void rules.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('digest.empty')} hint={t('digest.emptyHint')} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('digest.name')}</th>
                <th>{t('digest.scope')}</th>
                <th>{t('digest.schedule')}</th>
                <th>{t('digest.nextSend')}</th>
                <th>{t('digest.recipients')}</th>
                <th>{t('digest.lastSent')}</th>
                {canEdit ? <th className="col-center">{t('common.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((rule) => (
                <tr key={rule.id} className={rule.active ? undefined : 'row-muted'}>
                  <td data-label={t('digest.name')}>
                    {rule.name}
                    {!rule.active ? (
                      <span className="cell-sub">
                        <span className="badge muted">{t('digest.paused')}</span>
                      </span>
                    ) : null}
                  </td>
                  <td data-label={t('digest.scope')}>
                    {rule.kinds.length === 0
                      ? t('digest.allKinds')
                      : rule.kinds.map(kindLabel).join(', ')}
                    <span className="cell-sub">
                      {t('digest.within', { days: rule.withinDays })}
                    </span>
                  </td>
                  <td data-label={t('digest.schedule')}>
                    {describeSchedule({
                      frequency: rule.frequency,
                      hour: rule.hour,
                      weekday: rule.weekday ?? undefined,
                      dayOfMonth: rule.dayOfMonth ?? undefined,
                    })}
                  </td>
                  <td data-label={t('digest.nextSend')}>
                    {rule.nextSendAt ? formatDateTime(rule.nextSendAt) : t('digest.paused')}
                  </td>
                  <td data-label={t('digest.recipients')}>{rule.recipients.join(', ')}</td>
                  <td data-label={t('digest.lastSent')}>
                    {rule.lastSentAt ? formatDateTime(rule.lastSentAt) : t('digest.never')}
                  </td>
                  {canEdit ? (
                    <td data-label={t('common.actions')}>
                      <RowActions
                        primary={{
                          label: t('common.edit'),
                          ariaLabel: t('common.editOf', { subject: rule.name }),
                          onClick: () => setEditing({ rule }),
                        }}
                        label={t('common.actionsOf', { subject: rule.name })}
                        items={[
                          {
                            key: 'toggle',
                            label: t(rule.active ? 'digest.pause' : 'digest.resume'),
                            disabled: toggle.isPending,
                            onSelect: () =>
                              toggle.mutate(
                                { id: rule.id, active: !rule.active },
                                {
                                  onSuccess: () => {
                                    toast({
                                      message: t(rule.active ? 'digest.pausedDone' : 'digest.resumed'),
                                    });
                                    void refresh();
                                  },
                                  onError: (error) =>
                                    toast({ message: errorMessage(error), tone: 'error' }),
                                },
                              ),
                          },
                          {
                            key: 'preview',
                            label: t('digest.preview'),
                            onSelect: () => setPreviewing(rule),
                          },
                          /* Gửi cho CHÍNH người bấm: xem thư thật trong hộp thư mình mà không
                             làm phiền danh sách của luật — nên không cần hỏi lại. */
                          {
                            key: 'test-me',
                            label: t('digest.testMe'),
                            disabled: sendTest.isPending,
                            onSelect: () =>
                              sendTest.mutate(
                                { id: rule.id, onlyMe: true },
                                {
                                  onSuccess: testSentToast,
                                  onError: (error) =>
                                    toast({ message: errorMessage(error), tone: 'error' }),
                                },
                              ),
                          },
                          {
                            key: 'test',
                            label: t('digest.test'),
                            disabled: sendTest.isPending,
                            /*
                             * "Gửi thử" KHÔNG gửi vào một hộp thư nháp nào cả — nó bắn email
                             * THẬT tới đúng danh sách người nhận của luật, mà danh sách ấy
                             * thường là sếp và cả phòng. Chữ "thử" làm người ta tưởng ngược
                             * lại, nên đây là chỗ hiếm hoi phải hỏi lại dù thao tác không
                             * ghi gì xuống DB: cái không hoàn tác được là email đã rời đi.
                             *
                             * Câu hỏi NÊU ĐÍCH DANH người nhận — đó mới là thông tin giúp
                             * người dùng dừng lại đúng lúc, chứ không phải chữ "chắc chưa?".
                             */
                            onSelect: () => {
                              void (async () => {
                                const ok = await askConfirm({
                                  title: t('common.titleOf', {
                                    action: t('digest.test'),
                                    subject: rule.name,
                                  }),
                                  message: t('digest.confirmTest', {
                                    to: rule.recipients.join(', '),
                                  }),
                                  confirmLabel: t('digest.test'),
                                });
                                if (!ok) return;
                                sendTest.mutate(
                                  { id: rule.id },
                                  {
                                    onSuccess: testSentToast,
                                    onError: (error) =>
                                      toast({ message: errorMessage(error), tone: 'error' }),
                                  },
                                );
                              })();
                            },
                          },
                          {
                            key: 'delete',
                            label: t('digest.delete'),
                            danger: true,
                            onSelect: () => {
                              void (async () => {
                                const ok = await askConfirm({
                                  title: t('common.titleOf', {
                                    action: t('digest.delete'),
                                    subject: rule.name,
                                  }),
                                  message: t('digest.confirmDelete', { name: rule.name }),
                                  danger: true,
                                  confirmLabel: t('digest.delete'),
                                });
                                if (!ok) return;
                                remove.mutate(
                                  { id: rule.id },
                                  {
                                    onSuccess: () => {
                                      toast({ message: t('digest.deleted') });
                                      void refresh();
                                    },
                                    onError: (error) =>
                                      toast({ message: errorMessage(error), tone: 'error' }),
                                  },
                                );
                              })();
                            },
                          },
                        ]}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewing ? (
        <PreviewDialog
          rule={previewing}
          kindLabel={kindLabel}
          onClose={() => setPreviewing(null)}
        />
      ) : null}

      {editing ? (
        <RuleForm
          rule={editing.rule}
          kinds={kinds}
          csrfToken={me.csrfToken}
          meEmail={me.email}
          otherRules={(rules.data ?? []).filter((item) => item.id !== editing.rule?.id)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast({ message: t('digest.saved') });
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function RuleForm({
  rule,
  kinds,
  csrfToken,
  meEmail,
  otherRules,
  onClose,
  onSaved,
}: {
  rule: DigestRule | null;
  kinds: ExpiryKind[];
  csrfToken: string;
  meEmail: string;
  /** Luật khác — nguồn gợi ý người nhận (hộp thư chung đã dùng ở đâu đó). */
  otherRules: { recipients: string[] }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(rule?.name ?? '');
  const [withinDays, setWithinDays] = useState(String(rule?.withinDays ?? 30));
  const [recipients, setRecipients] = useState((rule?.recipients ?? []).join(', '));
  const [selected, setSelected] = useState<string[]>(rule?.kinds ?? []);
  const [active, setActive] = useState(rule?.active ?? true);
  const [schedule, setSchedule] = useState<ScheduleValue>({
    frequency: rule?.frequency ?? 'weekly',
    hour: rule?.hour ?? 8,
    weekday: rule?.weekday ?? 1,
    dayOfMonth: rule?.dayOfMonth ?? 1,
  });
  const [error, setError] = useState<string | null>(null);

  const save = useApiMutation<Record<string, unknown>, unknown>(
    rule ? `/api/v1/expiry/rules/${rule.id}` : '/api/v1/expiry/rules',
    { method: rule ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  const parsed = parseRecipients(recipients);
  const emails = parsed.map((item) => item.email);
  // Báo email sai ngay tại ô, đừng để server từ chối (hoặc tệ hơn: thư không tới ai).
  const badEmails = parsed.filter((item) => !item.valid).map((item) => item.email);
  const suggestions = recipientSuggestions(otherRules, meEmail, recipients);
  const addRecipient = (email: string) =>
    setRecipients((current) => (current.trim() ? `${current.trim().replace(/[,;]$/, '')}, ${email}` : email));
  const within = /^\d+$/.test(withinDays.trim()) ? Number(withinDays.trim()) : NaN;
  const check = useFormErrors({
    name: !name.trim() && t('digest.nameRequired'),
    withinDays:
      !(within >= WITHIN_MIN && within <= WITHIN_MAX) &&
      t('digest.withinInvalid', { min: WITHIN_MIN, max: WITHIN_MAX }),
    recipients:
      emails.length === 0
        ? t('digest.recipientsRequired')
        : badEmails.length > 0 && t('digest.recipientsInvalid', { emails: badEmails.join(', ') }),
  });

  const toggleKind = (kind: string) =>
    setSelected((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
    );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!save.isPending}
      guardUnsaved
      maxWidth={640}
      title={
        rule
          ? t('common.titleOf', { action: t('digest.edit'), subject: rule.name })
          : t('digest.add')
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="rule-form" className="btn primary" disabled={save.isPending}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="rule-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          save.mutate(
            {
              name: name.trim(),
              // Mảng rỗng = mọi loại — cố ý, để khỏi phải tick lại khi có loại mới.
              kinds: selected,
              withinDays: within,
              recipients: emails,
              frequency: schedule.frequency,
              hour: schedule.hour,
              weekday: schedule.weekday,
              dayOfMonth: schedule.dayOfMonth,
              active,
            },
            { onSuccess: onSaved, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        {check.summary}
        <Field label={t('digest.name')} required htmlFor="rule-name" error={check.error('name')}>
          <input
            id="rule-name"
            className="inp"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label={t('digest.scope')} hint={t('digest.scopeHint')}>
          {/* `role="group"` + tên: trình đọc màn hình đọc được "Theo dõi loại" khi vào từng ô. */}
          <div
            className="row"
            role="group"
            aria-label={t('digest.scope')}
            style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}
          >
            {kinds.map((item) => (
              <label key={item.kind} className="row" style={{ gap: 'var(--space-2)' }}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.kind)}
                  onChange={() => toggleKind(item.kind)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </Field>

        <Field
          label={t('digest.withinDays')}
          hint={t('digest.withinHint', { min: WITHIN_MIN, max: WITHIN_MAX })}
          htmlFor="rule-within"
          error={check.error('withinDays')}
        >
          <input
            id="rule-within"
            className="inp"
            inputMode="numeric"
            value={withinDays}
            onChange={(e) => setWithinDays(e.target.value)}
          />
        </Field>

        <Field
          label={t('digest.recipients')}
          required
          hint={t('digest.recipientsHint')}
          htmlFor="rule-recipients"
          error={check.error('recipients')}
        >
          <textarea
            id="rule-recipients"
            className="inp"
            rows={2}
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
          />
        </Field>
        {/* Đọc lại ô tự do thành từng chip: email sai đỏ ngay chip của nó, không phải dò trong
            một dòng dài. Gợi ý là hộp thư đã dùng ở luật khác — bấm là thêm vào ô. */}
        {parsed.length > 0 ? (
          <ul className="chip-row recipient-chips" aria-label={t('digest.recipientsParsed')}>
            {parsed.map((item, index) => (
              <li key={`${item.email}-${index}`} className={`badge ${item.valid ? 'muted' : 'danger'}`}>
                {item.email}
                {item.valid ? null : <span className="sr-only"> — {t('digest.recipientBad')}</span>}
              </li>
            ))}
          </ul>
        ) : null}
        {suggestions.length > 0 ? (
          <div className="chip-row" role="group" aria-label={t('digest.recipientsSuggest')}>
            {suggestions.map((email) => (
              <button
                key={email}
                type="button"
                className="btn sm"
                aria-label={t('digest.recipientAdd', { email })}
                onClick={() => addRecipient(email)}
              >
                + {email}
              </button>
            ))}
          </div>
        ) : null}

        <Field label={t('digest.schedule')}>
          {/* AD-15: luật gửi định kỳ dùng chung SchedulePicker, không tự dựng ô chọn lịch. */}
          <SchedulePicker value={schedule} onChange={setSchedule} />
        </Field>

        <Field label={t('digest.active')}>
          {/* Công tắc chứ không phải ô tick: đây là trạng thái Chạy / Tạm ngưng của cả luật,
              và chữ bên cạnh đổi theo để không phải đoán "tick là đang chạy hay đang dừng". */}
          <label className="row" style={{ gap: 'var(--space-3)' }}>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              aria-label={t('digest.active')}
              aria-describedby="rule-active-hint"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <span>{t(active ? 'digest.active' : 'digest.paused')}</span>
          </label>
          <span id="rule-active-hint" className="muted">
            {t('digest.activeHint')}
          </span>
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

/**
 * Thư của luật sẽ chứa gì, xem NGAY trong app — không phải "Gửi thử" (email thật tới cả danh
 * sách người nhận) chỉ để biết nội dung. Đọc thuần, không gửi, không ghi gì.
 */
function PreviewDialog({
  rule,
  kindLabel,
  onClose,
}: {
  rule: DigestRule;
  kindLabel: (value: string) => string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const preview = useQuery({
    queryKey: ['expiry', 'rules', rule.id, 'preview'],
    queryFn: () => apiFetch<DigestPreview>(`/api/v1/expiry/rules/${rule.id}/preview`),
  });
  const data = preview.data;
  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={640}
      initialFocus="title"
      title={t('common.titleOf', { action: t('digest.preview'), subject: rule.name })}
    >
      {preview.isLoading ? (
        <Loading />
      ) : preview.isError ? (
        <LoadError error={preview.error} onRetry={() => void preview.refetch()} />
      ) : data ? (
        <>
          <p>
            {t('digest.previewSummary', {
              total: data.total,
              expired: data.expired,
              upcoming: data.upcoming,
            })}
          </p>
          <p className="muted small">
            {t('digest.previewTo', { to: data.recipients.join(', ') })}
          </p>
          {data.total === 0 ? (
            /* Kỳ không có mục nào thì lượt quét KHÔNG gửi thư — nói đúng điều đó. */
            <EmptyState title={t('digest.previewEmpty')} hint={t('digest.previewEmptyHint')} />
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th>{t('digest.previewItem')}</th>
                    <th>{t('digest.previewKind')}</th>
                    <th>{t('digest.previewEnd')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={`${item.kind}-${item.link}`}>
                      <td data-label={t('digest.previewItem')}>{item.label}</td>
                      <td data-label={t('digest.previewKind')}>{kindLabel(item.kind)}</td>
                      <td data-label={t('digest.previewEnd')}>
                        {formatDate(item.end)}
                        <span className={item.daysLeft < 0 ? 'cell-sub is-danger' : 'cell-sub'}>
                          {item.daysLeft < 0
                            ? t('digest.previewOverdue', { days: -item.daysLeft })
                            : t('digest.previewLeft', { days: item.daysLeft })}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </Dialog>
  );
}
