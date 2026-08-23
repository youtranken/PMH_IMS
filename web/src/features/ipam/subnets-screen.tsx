import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { Dialog, DialogTitle } from '@/ui/dialog';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { UsageBar } from '@/ui/usage-bar';
import { useToast } from '@/ui/toast';
import type { CatalogLists } from '@/features/catalog/catalog-types';
import type { SubnetRow } from './ipam-types';

/**
 * Danh sách dải mạng (story 5.1, FR-018/FR-020).
 *
 * Mức sử dụng nằm ngay trên bảng chứ không giấu trong trang chi tiết: câu hỏi hằng ngày là
 * "dải nào sắp hết chỗ", và câu trả lời phải thấy được trong một lần liếc.
 */
export function SubnetsScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<{ subnet: SubnetRow | null } | null>(null);
  const [hiding, setHiding] = useState<SubnetRow | null>(null);

  const canEdit = me.role === 'sa' || me.role === 'admin';

  const subnets = useQuery({
    queryKey: ['ipam', 'subnets'],
    queryFn: () => apiFetch<SubnetRow[]>('/api/v1/ipam/subnets'),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ipam'] });
  const rows = subnets.data ?? [];

  return (
    <>
      <PageHeader
        title={t('ipam.title')}
        subtitle={t('ipam.subtitle')}
        actions={
          canEdit ? (
            <button type="button" className="btn primary" onClick={() => setEditing({ subnet: null })}>
              {t('ipam.addSubnet')}
            </button>
          ) : null
        }
      />

      {subnets.isLoading ? (
        <Loading />
      ) : subnets.isError ? (
        <LoadError onRetry={() => void subnets.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('ipam.empty')} hint={t('ipam.emptyHint')} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('ipam.cidr')}</th>
                <th>{t('ipam.name')}</th>
                <th>{t('ipam.site')}</th>
                <th>{t('ipam.usage')}</th>
                {canEdit ? <th className="col-center">{t('common.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((subnet) => (
                <tr key={subnet.id}>
                  <td data-label={t('ipam.cidr')}>
                    <Link className="mono" to={`/dia-chi-ip/${subnet.id}`}>
                      {subnet.cidr}
                    </Link>
                  </td>
                  <td data-label={t('ipam.name')}>
                    {subnet.name}
                    {subnet.description ? (
                      <span className="cell-sub">{subnet.description}</span>
                    ) : null}
                  </td>
                  <td data-label={t('ipam.site')}>{orDash(subnet.siteCode)}</td>
                  <td data-label={t('ipam.usage')}>
                    <UsageBar
                      percent={subnet.percent}
                      ariaLabel={t('ipam.usageOf', { cidr: subnet.cidr })}
                      label={t('ipam.usageLabel', {
                        used: subnet.used,
                        total: subnet.total,
                        free: subnet.free,
                      })}
                    />
                  </td>
                  {canEdit ? (
                    <td>
                      <div className="action-cell">
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setEditing({ subnet })}
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={() => setHiding(subnet)}
                        >
                          {t('ipam.hide')}
                        </button>
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
        <SubnetForm
          subnet={editing.subnet}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast({ message: t('ipam.subnetSaved') });
            void refresh();
          }}
        />
      ) : null}

      {hiding ? (
        <HideDialog
          subnet={hiding}
          csrfToken={me.csrfToken}
          onClose={() => setHiding(null)}
          onDone={() => {
            setHiding(null);
            toast({ message: t('ipam.subnetHidden') });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

function SubnetForm({
  subnet,
  csrfToken,
  onClose,
  onSaved,
}: {
  subnet: SubnetRow | null;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(subnet?.name ?? '');
  const [cidr, setCidr] = useState(subnet?.cidr ?? '');
  const [siteId, setSiteId] = useState(subnet?.siteId ?? '');
  const [description, setDescription] = useState(subnet?.description ?? '');
  const [error, setError] = useState<string | null>(null);

  const lists = useQuery({
    queryKey: ['catalog', 'lists'],
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
  });

  const save = useApiMutation<Record<string, unknown>, unknown>(
    subnet ? `/api/v1/ipam/subnets/${subnet.id}` : '/api/v1/ipam/subnets',
    { method: subnet ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  return (
    <Dialog open onOpenChange={onClose} maxWidth={560}>
      <DialogTitle>{subnet ? t('ipam.editSubnet') : t('ipam.addSubnet')}</DialogTitle>
      <form
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate(
            {
              name: name.trim(),
              cidr: cidr.trim(),
              siteId,
              description: description.trim(),
            },
            { onSuccess: onSaved, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <Field label={t('ipam.cidr')} required hint={t('ipam.cidrHint')} htmlFor="subnet-cidr">
          <input
            id="subnet-cidr"
            className="inp mono"
            required
            placeholder="172.16.10.0/24"
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
          />
        </Field>

        <Field label={t('ipam.name')} required htmlFor="subnet-name">
          <input
            id="subnet-name"
            className="inp"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label={t('ipam.site')}>
          <Select
            value={siteId}
            onChange={setSiteId}
            ariaLabel={t('ipam.site')}
            placeholder={t('ipam.noSite')}
            options={[
              { value: '', label: t('ipam.noSite') },
              ...(lists.data?.sites ?? []).map((site) => ({ value: site.id, label: site.code })),
            ]}
          />
        </Field>

        <Field label={t('ipam.description')} htmlFor="subnet-description">
          <textarea
            id="subnet-description"
            className="inp"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
          <button type="submit" className="btn primary" disabled={save.isPending}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * "Xóa" = ẩn, và ẩn thì PHẢI nói lý do (quyết định 2026-08-23).
 *
 * Dùng hộp riêng chứ không dùng `useConfirm` chung: hộp xác nhận chung chỉ hỏi có/không, còn
 * ở đây lý do là dữ liệu bắt buộc — nó đi vào audit và là thứ trả lời "sao dải này biến mất"
 * sáu tháng sau.
 */
function HideDialog({
  subnet,
  csrfToken,
  onClose,
  onDone,
}: {
  subnet: SubnetRow;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const hide = useApiMutation<{ reason: string }, unknown>(
    `/api/v1/ipam/subnets/${subnet.id}`,
    { method: 'DELETE', csrfToken, refreshMe: false },
  );

  return (
    <Dialog open onOpenChange={onClose} maxWidth={480}>
      <DialogTitle>{t('ipam.hideSubnetTitle', { cidr: subnet.cidr })}</DialogTitle>
      <form
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          hide.mutate(
            { reason: reason.trim() },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">{t('ipam.hideHint')}</p>
        <Field label={t('ipam.reason')} required htmlFor="hide-reason">
          <input
            id="hide-reason"
            className="inp"
            required
            minLength={3}
            placeholder={t('ipam.reasonPlaceholder')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
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
          <button type="submit" className="btn primary danger" disabled={hide.isPending}>
            {hide.isPending ? t('common.loading') : t('ipam.hide')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
