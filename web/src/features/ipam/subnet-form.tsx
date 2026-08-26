import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import type { CatalogLists } from '@/features/catalog/catalog-types';
import type { SubnetRow } from './ipam-types';

export function SubnetForm({
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
  const [vlan, setVlan] = useState(subnet?.vlan != null ? String(subnet.vlan) : '');
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
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={560}
      title={subnet ? t('ipam.editSubnet') : t('ipam.addSubnet')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="subnet-form" className="btn primary" disabled={save.isPending}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="subnet-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          // Ô VLAN để trống = XÓA số đang có, không phải "đừng đụng tới": form luôn hiện đủ ô.
          const raw = vlan.trim();
          let vlanValue: number | null = null;
          if (raw !== '') {
            const parsed = Number(raw);
            if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4094) {
              setError(t('ipam.vlanInvalid'));
              return;
            }
            vlanValue = parsed;
          }
          save.mutate(
            {
              name: name.trim(),
              cidr: cidr.trim(),
              siteId,
              vlan: vlanValue,
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

        <Field label={t('ipam.vlan')} hint={t('ipam.vlanHint')} htmlFor="subnet-vlan">
          <input
            id="subnet-vlan"
            className="inp mono"
            inputMode="numeric"
            placeholder="20"
            value={vlan}
            onChange={(e) => setVlan(e.target.value)}
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
export function HideDialog({
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
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={480}
      title={t('ipam.hideSubnetTitle', { cidr: subnet.cidr })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="hide-subnet-form"
            className="btn danger"
            disabled={hide.isPending}
          >
            {hide.isPending ? t('common.loading') : t('ipam.hide')}
          </button>
        </>
      }
    >
      <form
        id="hide-subnet-form"
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
      </form>
    </Dialog>
  );
}
