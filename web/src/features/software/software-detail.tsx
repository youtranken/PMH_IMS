import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { formatDate, orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { DatePicker } from '@/ui/date-picker';
import { Dialog, DialogTitle } from '@/ui/dialog';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { Field } from '@/ui/page-header';
import { HistoryPanel } from '@/ui/history-panel';
import { LoadError, Loading, NotFound } from '@/ui/load-state';
import { PageHeader } from '@/ui/page-header';
import { TabPanel, Tabs } from '@/ui/tabs';
import { useToast } from '@/ui/toast';
import type { CatalogLists } from '@/features/catalog/catalog-types';
import { SoftwareForm } from './software-form';
import { toSoftwareHistory } from './software-history-entries';
import {
  KIND_KEY,
  STATUS_KEY,
  STATUS_TONE,
  seatLabel,
  supportsSeats,
  type SoftwareHistoryRow,
  type SoftwareRow,
} from './software-types';

/**
 * Trang chi tiết hồ sơ phần mềm (story 3.1).
 *
 * Tab "Máy đang dùng" ra đời ở story 3.2; khung tab dựng sẵn để lúc đó chỉ cắm thêm.
 * Khối "Chìa khóa / mật khẩu" cố tình để TRỐNG với một câu giải thích: key nằm ở Két sắt
 * (Epic 4), không nằm trong bảng này (AC 3.1) — nói rõ còn hơn để người dùng đi tìm.
 */
export function SoftwareDetail({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { id = '' } = useParams();
  const [tab, setTab] = useState('profile');
  const [editing, setEditing] = useState(false);
  const [renewing, setRenewing] = useState(false);

  const software = useQuery({
    queryKey: ['software', id],
    queryFn: () => apiFetch<SoftwareRow>(`/api/v1/software/${id}`),
    retry: false,
  });

  const history = useQuery({
    queryKey: ['software', id, 'history'],
    queryFn: () => apiFetch<SoftwareHistoryRow[]>(`/api/v1/software/${id}/history`),
    enabled: tab === 'history',
  });

  const lists = useQuery({
    queryKey: ['catalog', 'lists'],
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
    enabled: editing,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['software'] });

  if (software.isLoading) return <Loading />;
  if (software.isError) {
    return software.error instanceof ApiError && software.error.status === 404 ? (
      <NotFound />
    ) : (
      <LoadError onRetry={() => void software.refetch()} />
    );
  }

  const item = software.data!;

  return (
    <>
      <PageHeader
        title={`${item.code} — ${item.name}`}
        subtitle={`${t(KIND_KEY[item.kind])}${item.vendorName ? ` · ${item.vendorName}` : ''}`}
        actions={
          <>
            <Link className="btn" to="/phan-mem">
              {t('software.back')}
            </Link>
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              {t('software.edit')}
            </button>
            <button type="button" className="btn primary" onClick={() => setRenewing(true)}>
              {t('software.renew')}
            </button>
          </>
        }
      />

      <div className="device-summary">
        <span className={`badge ${STATUS_TONE[item.status]}`}>{t(STATUS_KEY[item.status])}</span>
        <ExpiryBadge end={item.endDate} />
        {supportsSeats(item.kind) && item.seatTotal !== null ? (
          <span className="muted">
            {t('software.seats')}: <span className="mono">{seatLabel(item)}</span>
          </span>
        ) : null}
      </div>

      <Tabs
        items={[
          { key: 'profile', label: t('software.tabProfile') },
          { key: 'history', label: t('software.tabHistory') },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel={t('software.title')}
      />

      <TabPanel tabKey={tab}>
        {tab === 'profile' ? (
          <>
            <dl className="data-grid">
              <Item label={t('software.kind')}>{t(KIND_KEY[item.kind])}</Item>
              <Item label={t('software.vendor')}>{orDash(item.vendorName)}</Item>
              <Item label={t('software.seats')}>{seatLabel(item)}</Item>
              <Item label={t('software.startDate')}>{orDash(formatDate(item.startDate))}</Item>
              <Item label={t('software.endDate')}>
                {item.endDate ? (
                  <>
                    {formatDate(item.endDate)} <ExpiryBadge end={item.endDate} />
                  </>
                ) : (
                  '—'
                )}
              </Item>
              <Item label={t('software.status')}>{t(STATUS_KEY[item.status])}</Item>
              <Item label={t('software.note')}>{orDash(item.note)}</Item>
            </dl>

            <section className="card device-panel">
              <h2 className="form-section-title">{t('software.vaultTitle')}</h2>
              <p className="muted">{t('software.vaultEmpty')}</p>
              <p className="muted">{t('software.vaultHint')}</p>
            </section>
          </>
        ) : history.isLoading ? (
          <Loading />
        ) : history.isError ? (
          <LoadError onRetry={() => void history.refetch()} />
        ) : (
          <HistoryPanel entries={toSoftwareHistory(history.data ?? [])} />
        )}
      </TabPanel>

      {editing ? (
        <SoftwareForm
          row={item}
          lists={lists.data}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void refresh();
          }}
        />
      ) : null}

      {renewing ? (
        <RenewDialog
          software={item}
          csrfToken={me.csrfToken}
          onClose={() => setRenewing(false)}
          onDone={() => {
            setRenewing(false);
            toast({ message: t('software.renewed') });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

function RenewDialog({
  software,
  csrfToken,
  onClose,
  onDone,
}: {
  software: SoftwareRow;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const renew = useApiMutation<{ endDate: string }, unknown>(
    `/api/v1/software/${software.id}/renew`,
    { csrfToken, refreshMe: false },
  );

  return (
    <Dialog open onOpenChange={onClose} maxWidth={480}>
      <DialogTitle>
        {t('software.renewTitle')} — {software.code}
      </DialogTitle>
      <form
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!endDate) {
            setError(t('software.renewHint'));
            return;
          }
          renew.mutate(
            { endDate },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">
          {t('software.endDate')}: {software.endDate ? formatDate(software.endDate) : '—'}
        </p>
        <Field label={t('software.endDate')} required hint={t('software.renewHint')}>
          <DatePicker
            value={endDate}
            ariaLabel={t('software.renewTitle')}
            /* Hạn mới phải sau hạn cũ — chặn ngay trên lịch cho khỏi bấm nhầm;
               API vẫn kiểm lại vì chốt chặn thật phải nằm ở server. */
            min={software.endDate ?? undefined}
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
            {renew.isPending ? t('common.loading') : t('software.renew')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="data-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
