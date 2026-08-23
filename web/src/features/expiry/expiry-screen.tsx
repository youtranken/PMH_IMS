import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDate, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { DatePicker } from '@/ui/date-picker';
import { Dialog, DialogTitle } from '@/ui/dialog';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { TabPanel, Tabs } from '@/ui/tabs';
import { useToast } from '@/ui/toast';
import { DigestRulesPanel } from './digest-rules-panel';

interface ExpiryRow {
  id: string;
  label: string;
  sublabel: string | null;
  kind: string;
  start: string | null;
  end: string;
  link: string;
  daysLeft: number;
  canRenew: boolean;
}

interface ExpiryKind {
  kind: string;
  label: string;
  canRenew: boolean;
}

interface ExpiryResponse {
  items: ExpiryRow[];
  summary: { expired: number; critical: number; warning: number };
}

/** Cửa sổ nhìn tới — mấy mốc người ta thật sự dùng, không cho gõ số tùy ý cho rối. */
const WINDOWS = [7, 30, 60, 90, 180, 365];

/**
 * Màn Expiry tổng hợp (story 3.4, FR-012).
 *
 * Mọi thứ có ngày hết hạn của cả hệ thống về một chỗ: bảo hành thiết bị, license, SSL,
 * tên miền, hợp đồng bảo trì, hợp đồng đường truyền. Danh sách LOẠI lấy từ API — module
 * nào đăng ký nguồn thì tự xuất hiện, màn này không viết cứng tên loại nào (AD-7).
 */
export function ExpiryScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [withinDays, setWithinDays] = useState(30);
  const [kind, setKind] = useState('');
  const [renewing, setRenewing] = useState<ExpiryRow | null>(null);
  const [tab, setTab] = useState('list');

  const kinds = useQuery({
    queryKey: ['expiry', 'kinds'],
    queryFn: () => apiFetch<ExpiryKind[]>('/api/v1/expiry/kinds'),
  });

  const expiry = useQuery({
    queryKey: ['expiry', withinDays, kind],
    queryFn: () =>
      apiFetch<ExpiryResponse>(
        `/api/v1/expiry?withinDays=${withinDays}${kind ? `&kinds=${kind}` : ''}`,
      ),
  });

  const kindLabel = (value: string) =>
    kinds.data?.find((item) => item.kind === value)?.label ?? value;

  const rows = expiry.data?.items ?? [];
  const summary = expiry.data?.summary;

  return (
    <>
      <PageHeader title={t('expiry.title')} subtitle={t('expiry.subtitle')} />

      {/* Ba con số này là thứ người ta nhìn đầu tiên mỗi sáng. */}
      {summary ? (
        <div className="device-summary">
          <span className={`badge ${summary.expired > 0 ? 'danger' : 'muted'}`}>
            {t('expiry.expired')}: {summary.expired}
          </span>
          <span className={`badge ${summary.critical > 0 ? 'danger' : 'muted'}`}>
            {t('expiry.critical')}: {summary.critical}
          </span>
          <span className={`badge ${summary.warning > 0 ? 'warn' : 'muted'}`}>
            {t('expiry.warning')}: {summary.warning}
          </span>
        </div>
      ) : null}

      <Tabs
        items={[
          { key: 'list', label: t('expiry.tabList') },
          { key: 'rules', label: t('digest.tab') },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t('expiry.title')}
      />

      {tab === 'rules' ? (
        <TabPanel tabKey="rules">
          <DigestRulesPanel me={me} kinds={kinds.data ?? []} />
        </TabPanel>
      ) : (
        <TabPanel tabKey="list">
      <FilterBar>
        <Select
          value={String(withinDays)}
          ariaLabel={t('expiry.window')}
          options={WINDOWS.map((days) => ({
            value: String(days),
            label: t('expiry.windowDays', { days }),
          }))}
          onChange={(value) => setWithinDays(Number(value))}
        />
        <Select
          value={kind}
          ariaLabel={t('expiry.kind')}
          placeholder={t('expiry.allKinds')}
          options={[
            { value: '', label: t('expiry.allKinds') },
            ...(kinds.data ?? []).map((item) => ({ value: item.kind, label: item.label })),
          ]}
          onChange={setKind}
        />
      </FilterBar>

      {expiry.isLoading ? (
        <Loading />
      ) : expiry.isError ? (
        <LoadError onRetry={() => void expiry.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('expiry.empty')} hint={t('expiry.emptyHint')} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('expiry.item')}</th>
                <th>{t('expiry.kind')}</th>
                <th>{t('expiry.end')}</th>
                <th>{t('expiry.state')}</th>
                <th className="col-center">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.kind}-${row.id}`}
                  className={row.daysLeft < 0 ? 'row-danger' : undefined}
                >
                  <td data-label={t('expiry.item')}>
                    <Link to={row.link}>{row.label}</Link>
                    {row.sublabel ? <span className="cell-sub">{row.sublabel}</span> : null}
                  </td>
                  <td data-label={t('expiry.kind')}>{kindLabel(row.kind)}</td>
                  <td data-label={t('expiry.end')}>{orDash(formatDate(row.end))}</td>
                  <td data-label={t('expiry.state')}>
                    {/* AD-15: luật "sắp hết hạn" chỉ có một, ở lib/expiry.ts */}
                    <ExpiryBadge end={row.end} />
                  </td>
                  <td>
                    {row.canRenew ? (
                      <button
                        type="button"
                        className="btn sm primary"
                        onClick={() => setRenewing(row)}
                      >
                        {t('expiry.renew')}
                      </button>
                    ) : (
                      // Bảo hành thiết bị không "gia hạn" được — nói rõ thay vì để nút chết.
                      <span className="muted">{t('expiry.notRenewable')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

        </TabPanel>
      )}

      {renewing ? (
        <RenewDialog
          row={renewing}
          kindLabel={kindLabel(renewing.kind)}
          csrfToken={me.csrfToken}
          onClose={() => setRenewing(null)}
          onDone={() => {
            setRenewing(null);
            toast({ message: t('expiry.renewed') });
            void queryClient.invalidateQueries({ queryKey: ['expiry'] });
          }}
        />
      ) : null}
    </>
  );
}

function RenewDialog({
  row,
  kindLabel,
  csrfToken,
  onClose,
  onDone,
}: {
  row: ExpiryRow;
  kindLabel: string;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const renew = useApiMutation<Record<string, unknown>, unknown>('/api/v1/expiry/renew', {
    csrfToken,
    refreshMe: false,
  });

  return (
    <Dialog open onOpenChange={onClose} maxWidth={520}>
      <DialogTitle>
        {t('expiry.renew')} — {row.label}
      </DialogTitle>
      <form
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!endDate) {
            setError(t('expiry.pickDate'));
            return;
          }
          renew.mutate(
            { kind: row.kind, id: row.id, endDate },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">
          {kindLabel} · {t('expiry.end')}: {formatDate(row.end)}
        </p>
        <Field label={t('expiry.newEnd')} required hint={t('expiry.renewHint')}>
          <DatePicker
            value={endDate}
            ariaLabel={t('expiry.newEnd')}
            /* Hạn mới phải sau hạn cũ — chặn trên lịch; API vẫn kiểm lại vì chốt chặn
               thật phải nằm ở server. */
            min={row.end}
            onChange={setEndDate}
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
          <button type="submit" className="btn primary" disabled={renew.isPending}>
            {renew.isPending ? t('common.loading') : t('expiry.renew')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
