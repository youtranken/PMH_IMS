import { useState } from 'react';
import type { ExpiryKind } from '@/lib/expiry-kinds';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import type { Me } from '@/lib/me';
import { Dialog } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field } from '@/ui/page-header';
import { RowActions } from '@/ui/row-actions';
import { SchedulePicker, describeSchedule, type ScheduleValue } from '@/ui/schedule-picker';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';

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
}


/**
 * Luật gửi báo cáo "sắp hết hạn" (story 3.5, FR-013).
 *
 * MỘT luật = MỘT email tổng hợp theo kỳ. Nút "Gửi thử" là thứ quan trọng nhất màn này:
 * không có nó thì cấu hình xong phải chờ tới thứ Hai mới biết có chạy đúng không.
 */
export function DigestRulesPanel({ me, kinds }: { me: Me; kinds: ExpiryKind[] }) {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ rule: DigestRule | null } | null>(null);

  const canEdit = me.role === 'sa' || me.role === 'admin';

  const rules = useQuery({
    queryKey: ['expiry', 'rules'],
    queryFn: () => apiFetch<DigestRule[]>('/api/v1/expiry/rules'),
  });

  const remove = useApiMutation<{ id: string }, unknown>(
    (input) => `/api/v1/expiry/rules/${input.id}`,
    { method: 'DELETE', csrfToken: me.csrfToken, refreshMe: false, body: () => undefined },
  );
  const sendTest = useApiMutation<{ id: string }, { recipients: string[]; items: number }>(
    (input) => `/api/v1/expiry/rules/${input.id}/test`,
    { csrfToken: me.csrfToken, refreshMe: false, body: () => undefined },
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['expiry', 'rules'] });
  const kindLabel = (value: string) =>
    kinds.find((item) => item.kind === value)?.label ?? value;

  const rows = rules.data ?? [];

  return (
    <div className="attachment-panel">
      {canEdit ? (
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn primary" onClick={() => setEditing({ rule: null })}>
            {t('digest.add')}
          </button>
        </div>
      ) : (
        <p className="muted">{t('digest.readOnly')}</p>
      )}

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
                      <span className="cell-sub">{t('digest.paused')}</span>
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
                  <td data-label={t('digest.recipients')}>{rule.recipients.join(', ')}</td>
                  <td data-label={t('digest.lastSent')}>
                    {rule.lastSentAt ? formatDateTime(rule.lastSentAt) : t('digest.never')}
                  </td>
                  {canEdit ? (
                    <td>
                      <div className="action-cell">
                        <RowActions
                          label={t('common.actionsOf', { subject: rule.name })}
                          items={[
                            {
                              key: 'edit',
                              label: t('digest.edit'),
                              onSelect: () => setEditing({ rule }),
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
                                    message: t('digest.confirmTest', {
                                      to: rule.recipients.join(', '),
                                    }),
                                    confirmLabel: t('digest.test'),
                                  });
                                  if (!ok) return;
                                  sendTest.mutate(
                                    { id: rule.id },
                                    {
                                      onSuccess: (result) =>
                                        toast({
                                          message: t('digest.testSent', {
                                            count: result.items,
                                            to: result.recipients.join(', '),
                                          }),
                                        }),
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
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <RuleForm
          rule={editing.rule}
          kinds={kinds}
          csrfToken={me.csrfToken}
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
  onClose,
  onSaved,
}: {
  rule: DigestRule | null;
  kinds: ExpiryKind[];
  csrfToken: string;
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
      title={rule ? t('digest.edit') : t('digest.add')}
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
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          const emails = recipients
            .split(/[,;\n]/)
            .map((email) => email.trim())
            .filter(Boolean);
          if (!name.trim()) {
            setError(t('digest.nameRequired'));
            return;
          }
          if (emails.length === 0) {
            setError(t('digest.recipientsRequired'));
            return;
          }
          save.mutate(
            {
              name: name.trim(),
              // Mảng rỗng = mọi loại — cố ý, để khỏi phải tick lại khi có loại mới.
              kinds: selected,
              withinDays: Number(withinDays) || 30,
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
        <Field label={t('digest.name')} required htmlFor="rule-name">
          <input
            id="rule-name"
            className="inp"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label={t('digest.scope')} hint={t('digest.scopeHint')}>
          <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
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

        <Field label={t('digest.withinDays')} htmlFor="rule-within">
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
        >
          <textarea
            id="rule-recipients"
            className="inp"
            rows={2}
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
          />
        </Field>

        <Field label={t('digest.schedule')}>
          {/* AD-15: luật gửi định kỳ dùng chung SchedulePicker, không tự dựng ô chọn lịch. */}
          <SchedulePicker value={schedule} onChange={setSchedule} />
        </Field>

        <Field label={t('digest.active')}>
          <label className="row" style={{ gap: 'var(--space-3)' }}>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <span className="muted">{t('digest.activeHint')}</span>
          </label>
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
