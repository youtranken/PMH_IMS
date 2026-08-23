import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { Combobox } from '@/ui/combobox';
import { Dialog, DialogTitle } from '@/ui/dialog';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, PageHeader } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import type { CatalogLists } from '@/features/catalog/catalog-types';

type NatProtocol = 'tcp' | 'udp' | 'both';

interface NatRow {
  id: string;
  deviceId: string;
  deviceCode: string | null;
  deviceName: string | null;
  siteCode: string | null;
  protocol: NatProtocol;
  externalPorts: string;
  internalIp: string;
  internalPort: number;
  ipAddressId: string | null;
  internalOwner: string | null;
  usedBy: string;
  reason: string;
  enabled: boolean;
  note: string | null;
}

interface DeviceOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Sổ NAT (story 5.3, FR-017).
 *
 * Bảng này tồn tại để trả lời đúng ba câu của auditor: **port nào mở, vì sao, cho ai**. Nên
 * cả ba đều nằm NGAY TRÊN BẢNG, không giấu trong trang chi tiết — người ta mở màn này ra là
 * để đọc, không phải để bấm tiếp.
 */
export function NatScreen({ me }: { me: Me }) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [siteId, setSiteId] = useState('');
  const [editing, setEditing] = useState<{ rule: NatRow | null } | null>(null);
  const [hiding, setHiding] = useState<NatRow | null>(null);

  const canHide = me.role === 'sa' || me.role === 'admin';

  const lists = useQuery({
    queryKey: ['catalog', 'lists'],
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
  });

  const query = new URLSearchParams();
  if (search.trim()) query.set('search', search.trim());
  if (siteId) query.set('siteId', siteId);

  const rules = useQuery({
    queryKey: ['ipam', 'nat', search, siteId],
    queryFn: () => apiFetch<NatRow[]>(`/api/v1/ipam/nat?${query.toString()}`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ipam'] });
  const rows = rules.data ?? [];

  return (
    <>
      <PageHeader
        title={t('nat.title')}
        subtitle={t('nat.subtitle')}
        actions={
          <>
            <ExportXlsxButton
              url={`/api/v1/ipam/nat/export.xlsx?${query.toString()}`}
              fileName="so-nat.xlsx"
            />
            <button type="button" className="btn primary" onClick={() => setEditing({ rule: null })}>
              {t('nat.add')}
            </button>
          </>
        }
      />

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('nat.search')}
      >
        <Select
          value={siteId}
          onChange={setSiteId}
          ariaLabel={t('nat.site')}
          placeholder={t('nat.allSites')}
          options={[
            { value: '', label: t('nat.allSites') },
            ...(lists.data?.sites ?? []).map((site) => ({ value: site.id, label: site.code })),
          ]}
        />
      </FilterBar>

      {rules.isLoading ? (
        <Loading />
      ) : rules.isError ? (
        <LoadError onRetry={() => void rules.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('nat.empty')} hint={t('nat.emptyHint')} />
      ) : (
        <div className="table-wrap">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{t('nat.router')}</th>
                <th>{t('nat.external')}</th>
                <th>{t('nat.internal')}</th>
                <th>{t('nat.usedBy')}</th>
                <th>{t('nat.reason')}</th>
                <th className="col-center">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((rule) => (
                <tr key={rule.id} className={rule.enabled ? undefined : 'row-muted'}>
                  <td data-label={t('nat.router')}>
                    <Link to={`/thiet-bi/${rule.deviceId}`}>{orDash(rule.deviceCode)}</Link>
                    <span className="cell-sub">{orDash(rule.siteCode)}</span>
                  </td>
                  <td data-label={t('nat.external')}>
                    <span className="mono">
                      {rule.protocol.toUpperCase()} {rule.externalPorts}
                    </span>
                    {!rule.enabled ? <span className="cell-sub">{t('nat.disabled')}</span> : null}
                  </td>
                  <td data-label={t('nat.internal')}>
                    <span className="mono">
                      {rule.internalIp}:{rule.internalPort}
                    </span>
                    {rule.internalOwner ? (
                      <span className="cell-sub">{rule.internalOwner}</span>
                    ) : null}
                  </td>
                  <td data-label={t('nat.usedBy')}>{rule.usedBy}</td>
                  <td data-label={t('nat.reason')}>{rule.reason}</td>
                  <td>
                    <div className="action-cell">
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => setEditing({ rule })}
                      >
                        {t('common.edit')}
                      </button>
                      {canHide ? (
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={() => setHiding(rule)}
                        >
                          {t('nat.remove')}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing ? (
        <NatForm
          rule={editing.rule}
          csrfToken={me.csrfToken}
          onClose={() => setEditing(null)}
          onSaved={(warnings) => {
            setEditing(null);
            /**
             * Cảnh báo (vd "dải này mở hơn 1000 cổng") KHÔNG chặn lưu — nên nó phải được NÓI
             * RA sau khi lưu, không thì im lặng luôn và người khai chẳng biết mình vừa mở
             * bao nhiêu cổng ra Internet.
             */
            toast(
              warnings.length > 0
                ? { message: warnings.join(' '), tone: 'warn' }
                : { message: t('nat.saved') },
            );
            void refresh();
          }}
        />
      ) : null}

      {hiding ? (
        <RemoveDialog
          rule={hiding}
          csrfToken={me.csrfToken}
          onClose={() => setHiding(null)}
          onDone={() => {
            setHiding(null);
            toast({ message: t('nat.removed') });
            void refresh();
          }}
        />
      ) : null}
    </>
  );
}

const PROTOCOLS: NatProtocol[] = ['tcp', 'udp', 'both'];

function NatForm({
  rule,
  csrfToken,
  onClose,
  onSaved,
}: {
  rule: NatRow | null;
  csrfToken: string;
  onClose: () => void;
  onSaved: (warnings: string[]) => void;
}) {
  const { t } = useTranslation();
  const [deviceId, setDeviceId] = useState(rule?.deviceId ?? '');
  const [deviceTerm, setDeviceTerm] = useState(rule?.deviceCode ?? '');
  const [protocol, setProtocol] = useState<NatProtocol>(rule?.protocol ?? 'tcp');
  const [externalPorts, setExternalPorts] = useState(rule?.externalPorts ?? '');
  const [internalIp, setInternalIp] = useState(rule?.internalIp ?? '');
  const [internalPort, setInternalPort] = useState(String(rule?.internalPort ?? ''));
  const [usedBy, setUsedBy] = useState(rule?.usedBy ?? '');
  const [reason, setReason] = useState(rule?.reason ?? '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);

  const devices = useQuery({
    queryKey: ['devices', 'search', deviceTerm],
    queryFn: () =>
      apiFetch<{ items: DeviceOption[] }>(
        `/api/v1/devices?limit=20&search=${encodeURIComponent(deviceTerm)}`,
      ),
    enabled: deviceTerm.length > 0,
  });

  const save = useApiMutation<Record<string, unknown>, { warnings?: string[] }>(
    rule ? `/api/v1/ipam/nat/${rule.id}` : '/api/v1/ipam/nat',
    { method: rule ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  return (
    <Dialog open onOpenChange={onClose} maxWidth={620}>
      <DialogTitle>{rule ? t('nat.edit') : t('nat.add')}</DialogTitle>
      <form
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate(
            {
              deviceId,
              protocol,
              externalPorts: externalPorts.trim(),
              internalIp: internalIp.trim(),
              internalPort: Number(internalPort),
              usedBy: usedBy.trim(),
              reason: reason.trim(),
              enabled,
            },
            {
              onSuccess: (result) => onSaved(result?.warnings ?? []),
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        <Field label={t('nat.router')} required hint={t('nat.routerHint')}>
          <Combobox
            placeholder={t('nat.routerSearch')}
            query={deviceTerm}
            onQuery={(value) => {
              setDeviceTerm(value);
              setDeviceId('');
            }}
            options={devices.data?.items ?? []}
            getKey={(item) => item.id}
            renderOption={(item) => (
              <>
                <span className="mono">{item.code}</span> <small>{item.name}</small>
              </>
            )}
            onSelect={(item) => {
              setDeviceId(item.id);
              setDeviceTerm(item.code);
            }}
          />
        </Field>

        <Field label={t('nat.protocol')}>
          <Select
            value={protocol}
            onChange={(next) => setProtocol(next as NatProtocol)}
            ariaLabel={t('nat.protocol')}
            options={PROTOCOLS.map((item) => ({
              value: item,
              label: item === 'both' ? t('nat.protocolBoth') : item.toUpperCase(),
            }))}
          />
        </Field>

        <Field
          label={t('nat.external')}
          required
          hint={t('nat.externalHint')}
          htmlFor="nat-external"
        >
          <input
            id="nat-external"
            className="inp mono"
            required
            placeholder="8080"
            value={externalPorts}
            onChange={(e) => setExternalPorts(e.target.value)}
          />
        </Field>

        <Field label={t('nat.internalIp')} required htmlFor="nat-internal-ip">
          <input
            id="nat-internal-ip"
            className="inp mono"
            required
            placeholder="172.16.10.5"
            value={internalIp}
            onChange={(e) => setInternalIp(e.target.value)}
          />
        </Field>

        <Field label={t('nat.internalPort')} required htmlFor="nat-internal-port">
          <input
            id="nat-internal-port"
            className="inp mono"
            required
            inputMode="numeric"
            value={internalPort}
            onChange={(e) => setInternalPort(e.target.value)}
          />
        </Field>

        {/* Hai ô dưới đây là LÝ DO cuốn sổ tồn tại — nên chúng bắt buộc, không phải tùy chọn. */}
        <Field label={t('nat.usedBy')} required hint={t('nat.usedByHint')} htmlFor="nat-used-by">
          <input
            id="nat-used-by"
            className="inp"
            required
            value={usedBy}
            onChange={(e) => setUsedBy(e.target.value)}
          />
        </Field>

        <Field label={t('nat.reason')} required hint={t('nat.reasonHint')} htmlFor="nat-reason">
          <textarea
            id="nat-reason"
            className="inp"
            rows={2}
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        <Field label={t('nat.enabled')}>
          <label className="row" style={{ gap: 'var(--space-3)' }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="muted">{t('nat.enabledHint')}</span>
          </label>
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

/** Gỡ rule kèm lý do: "port 8080 đóng ngày nào, ai đóng, vì sao" sẽ có người hỏi. */
function RemoveDialog({
  rule,
  csrfToken,
  onClose,
  onDone,
}: {
  rule: NatRow;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const remove = useApiMutation<{ reason: string }, unknown>(`/api/v1/ipam/nat/${rule.id}`, {
    method: 'DELETE',
    csrfToken,
    refreshMe: false,
  });

  return (
    <Dialog open onOpenChange={onClose} maxWidth={480}>
      <DialogTitle>
        {t('nat.removeTitle', { ports: `${rule.protocol.toUpperCase()} ${rule.externalPorts}` })}
      </DialogTitle>
      <form
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          remove.mutate(
            { reason: reason.trim() },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">{t('nat.removeHint')}</p>
        <Field label={t('nat.removeReason')} required htmlFor="nat-remove-reason">
          <input
            id="nat-remove-reason"
            className="inp"
            required
            minLength={3}
            placeholder={t('nat.removeReasonPlaceholder')}
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
          <button type="submit" className="btn primary danger" disabled={remove.isPending}>
            {remove.isPending ? t('common.loading') : t('nat.remove')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
