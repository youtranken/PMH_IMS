import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { orDash } from '@/lib/format';
import type { Me } from '@/lib/me';
import { Combobox } from '@/ui/combobox';
import { Dialog } from '@/ui/dialog';
import { ExportXlsxButton } from '@/ui/export-xlsx-button';
import { FilterBar } from '@/ui/filter-bar';
import { EmptyState, LoadError, Loading } from '@/ui/load-state';
import { Field, FormSection, PageHeader } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { SuggestInput } from '@/ui/suggest-input';
import { useToast } from '@/ui/toast';
import type { CatalogLists, ServicePortRow } from '@/features/catalog/catalog-types';
import { CatalogForm } from '@/features/catalog/catalog-form';
import { DeviceForm } from '@/features/devices/device-form';
import { ServicePortPicker } from './service-port-picker';
import { chipsFromValue, parsePortChip, type PortChip } from './port-chips';
import { PortChipsField } from './port-chips-field';
import { PATHS } from '@/lib/routes';

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
                    <Link to={PATHS.device(rule.deviceId)}>{orDash(rule.deviceCode)}</Link>
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
                          className="btn sm"
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
          onSaved={({ created, warnings }) => {
            setEditing(null);
            // Nói RÕ vừa ghi mấy dòng: gõ một form ra ba dòng là chuyện dễ đếm nhầm.
            toast({
              message: created > 1 ? t('nat.savedMany', { count: created }) : t('nat.saved'),
            });
            /**
             * Cảnh báo (vd "dải này mở hơn 1000 cổng") KHÔNG chặn lưu — nên nó phải được NÓI
             * RA sau khi lưu, không thì im lặng luôn và người khai chẳng biết mình vừa mở
             * bao nhiêu cổng ra Internet. Khoảng nào ghi hỏng cũng đi đường này.
             */
            for (const warning of warnings) toast({ message: warning, tone: 'warn' });
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
  onSaved: (result: { created: number; warnings: string[] }) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState(rule?.deviceId ?? '');
  const [deviceTerm, setDeviceTerm] = useState(rule?.deviceCode ?? '');
  /**
   * Lọc ô chọn router theo LOẠI thiết bị.
   *
   * Router là một thiết bị trong kho (dòng NAT bấm vào mở thẳng trang thiết bị), nên ô chọn
   * vốn phải cuộn qua cả kho — máy in, PC, switch. Lọc theo loại rút danh sách về đúng mấy
   * cái Draytek/firewall, mà vẫn KHÔNG cần thêm một danh mục router thứ hai để rồi cùng một
   * cái Draytek phải khai hai nơi.
   */
  const [typeFilter, setTypeFilter] = useState('');
  const [addingRouter, setAddingRouter] = useState(false);
  /** Ô nào đang mở hộp thêm dịch vụ — để lưu xong áp thẳng vào đúng ô đó. */
  const [addingService, setAddingService] = useState<'external' | 'internal' | null>(null);
  const [protocol, setProtocol] = useState<NatProtocol>(rule?.protocol ?? 'tcp');
  /**
   * Port ngoài giữ dạng DANH SÁCH CHIP, không phải một chuỗi.
   *
   * Một rule trong DB chỉ mang một khoảng port, nhưng việc thật là "mở 8080, 8443 và
   * 5060-5070 cho cùng một máy, cùng một lý do". Trước đây phải mở form ba lần và gõ lại
   * router / IP trong / ai dùng / lý do ba lượt — sai một chỗ là ba dòng lệch nhau. Giờ gõ
   * một lần, bấm Lưu ra ba dòng dùng chung mọi thứ còn lại.
   *
   * SỬA thì cắt về đúng một khoảng (`max={1}`): "sửa" là đổi một dòng đang có, còn tách nó
   * thành ba dòng là chuyện khác hẳn và phải đi qua nút Thêm rule cho rõ ràng.
   */
  const [ports, setPorts] = useState<PortChip[]>(() =>
    rule ? chipsFromValue(rule.externalPorts) : [],
  );
  const [internalIp, setInternalIp] = useState(rule?.internalIp ?? '');
  const [internalPort, setInternalPort] = useState(String(rule?.internalPort ?? ''));
  const [usedBy, setUsedBy] = useState(rule?.usedBy ?? '');
  const [reason, setReason] = useState(rule?.reason ?? '');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  /** Sửa = một khoảng; thêm mới = bao nhiêu khoảng cũng được (mỗi khoảng ra một dòng). */
  const maxPorts = rule ? 1 : Number.POSITIVE_INFINITY;
  /* Nhiều chip = nhiều lượt gọi nối tiếp; giữa hai lượt `isPending` tụt về false, không khoá
     thêm thì nút Lưu nhấp nháy mở ra và bấm phát nữa là ghi trùng cả cụm. */
  const [saving, setSaving] = useState(false);
  const busy = saving;

  const lists = useQuery({
    queryKey: ['catalog', 'lists'],
    queryFn: () => apiFetch<CatalogLists>('/api/v1/catalog?includeInactive=true'),
  });

  /**
   * KHÔNG còn `enabled: deviceTerm.length > 0`.
   *
   * Bản cũ chỉ hỏi khi đã gõ, nên ô Router mở ra là một ô trắng với dòng nhắc "Gõ mã hoặc
   * tên router…" — người dùng gõ, không ra gì (kho chưa có router nào), và kết luận là hệ
   * thống hỏng. Danh sách hiện sẵn thì thấy ngay có gì để chọn, hoặc thấy ngay là chưa có gì
   * và bấm "Thêm router mới" ở đầu menu.
   */
  const devices = useQuery({
    queryKey: ['devices', 'picker', typeFilter, deviceTerm],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '20' });
      if (typeFilter) params.set('deviceTypeId', typeFilter);
      if (deviceTerm.trim()) params.set('search', deviceTerm.trim());
      return apiFetch<{ items: DeviceOption[] }>(`/api/v1/devices?${params.toString()}`);
    },
  });

  const departments = useMemo(
    () =>
      (lists.data?.departments ?? [])
        .filter((department) => department.active)
        .map((department) => department.name),
    [lists.data],
  );

  const services = useMemo(
    () => (lists.data?.servicePorts ?? []).filter((service) => service.active),
    [lists.data],
  );

  /**
   * Áp một dịch vụ vào ô port — port ngoài kéo theo cả giao thức, vì đó là ý nghĩa của nó.
   *
   * Chọn dịch vụ giờ là THÊM một chip chứ không ghi đè ô: chọn "HTTPS" rồi chọn tiếp "RDP"
   * mà mất cái đầu là đúng cái bẫy khiến người ta tưởng ô này chỉ chứa được một thứ.
   */
  const applyService = (service: ServicePortRow, field: 'external' | 'internal') => {
    if (field === 'external') {
      const value =
        service.portFrom === service.portTo
          ? String(service.portFrom)
          : `${service.portFrom}-${service.portTo}`;
      const parsed = parsePortChip(value, ports);
      // Chọn trùng dịch vụ đã có thì lặng lẽ bỏ qua — không đẻ chip trùng, cũng không la lối.
      if (parsed.chip && ports.length < maxPorts) setPorts([...ports, parsed.chip]);
      setProtocol(service.protocol);
    } else {
      // Port TRONG là một số duy nhất (đích của chuyển tiếp), nên lấy đầu dải.
      setInternalPort(String(service.portFrom));
    }
  };

  const save = useApiMutation<Record<string, unknown>, { warnings?: string[] }>(
    rule ? `/api/v1/ipam/nat/${rule.id}` : '/api/v1/ipam/nat',
    { method: rule ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  return (
    <>
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={720}
      title={rule ? t('nat.edit') : t('nat.add')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="nat-form" className="btn primary" disabled={busy}>
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      {/*
        Ba khối theo ĐÚNG đường đi của một gói tin: vào từ đâu → chuyển tới đâu → vì sao mở.
        Bản cũ là một dây 10 ô xếp dọc, trong đó "Loại thiết bị" (một BỘ LỌC của ô Router
        ngay dưới) đứng đầu như thể là dữ liệu của rule, còn Port ngoài và Port trong — hai
        thứ luôn phải đọc cùng nhau — thì bị IP trong chen vào giữa.
      */}
      <form
        id="nat-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (ports.length === 0) {
            setError(t('nat.portRequired'));
            return;
          }
          void (async () => {
            setSaving(true);
            const shared = {
              deviceId,
              protocol,
              internalIp: internalIp.trim(),
              internalPort: Number(internalPort),
              usedBy: usedBy.trim(),
              reason: reason.trim(),
              enabled,
            };
            const warnings: string[] = [];
            const failures: string[] = [];
            let created = 0;
            /* Nối tiếp chứ không song song: luật chống chồng port phía API xét dòng đang có
               trong DB, bắn cùng lúc thì hai chip chồng nhau có thể cùng lọt qua. */
            for (const chip of ports) {
              try {
                const result = await save.mutateAsync({
                  ...shared,
                  externalPorts: chip.value,
                });
                created += 1;
                warnings.push(...(result?.warnings ?? []));
              } catch (err) {
                // Một khoảng hỏng KHÔNG được nuốt mất mấy khoảng đã ghi xong — nói rõ khoảng
                // nào hỏng vì sao, phần còn lại vẫn nằm trong sổ.
                failures.push(
                  t('nat.portFailed', { port: chip.value, reason: errorMessage(err) }),
                );
              }
            }
            setSaving(false);
            if (created === 0) {
              setError(failures.join(' '));
              return;
            }
            onSaved({ created, warnings: [...warnings, ...failures] });
          })();
        }}
      >
        <FormSection title={t('nat.sectionExternal')} columns={2}>
          <Field label={t('nat.router')} required hint={t('nat.routerHint')} span={2}>
            {/* Bộ lọc theo loại nằm TRONG ô Router, không phải một trường ngang hàng phía
                trên: nó không được lưu vào rule nào cả, nó chỉ rút ngắn danh sách bên cạnh. */}
            <div className="field-row">
              <Select
                value={typeFilter}
                ariaLabel={t('nat.deviceType')}
                placeholder={t('nat.allTypes')}
                options={[
                  { value: '', label: t('nat.allTypes') },
                  ...(lists.data?.deviceTypes ?? []).map((type) => ({
                    value: type.id,
                    label: type.name,
                  })),
                ]}
                onChange={(value) => {
                  setTypeFilter(value);
                  // Đổi bộ lọc mà giữ nguyên router đã chọn thì ô hiện một mã không còn nằm
                  // trong danh sách đang xem — người dùng không hiểu vì sao.
                  setDeviceTerm('');
                  setDeviceId('');
                }}
              />
              <Combobox
                placeholder={t('nat.routerSearch')}
                ariaLabel={t('nat.router')}
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
                /* Router chưa có trong kho thì thêm NGAY TẠI ĐÂY. Bắt người dùng thoát ra,
                   sang màn Thiết bị, khai xong rồi quay lại gõ lại cả form NAT là ba lần
                   chuyển màn cho một việc — và form đang dở thì mất trắng. */
                action={{ label: t('nat.addRouter'), onClick: () => setAddingRouter(true) }}
              />
            </div>
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
            hint={rule ? t('nat.externalHintEdit') : t('nat.externalHint')}
            htmlFor="nat-external"
            span={2}
          >
            <PortChipsField
              chips={ports}
              onChange={setPorts}
              max={maxPorts}
              disabled={busy}
              inputId="nat-external"
            />
            <ServicePortPicker
              services={services}
              label={t('nat.external')}
              onPick={(service) => applyService(service, 'external')}
              onAdd={() => setAddingService('external')}
            />
          </Field>
        </FormSection>

        <FormSection title={t('nat.sectionInternal')} columns={2}>
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
            <ServicePortPicker
              services={services}
              label={t('nat.internalPort')}
              onPick={(service) => applyService(service, 'internal')}
              onAdd={() => setAddingService('internal')}
            />
          </Field>
        </FormSection>

        {/* Khối này là LÝ DO cuốn sổ tồn tại — nên hai ô đầu bắt buộc, không phải tùy chọn. */}
        <FormSection title={t('nat.sectionWhy')} columns={2}>
          <Field label={t('nat.usedBy')} required hint={t('nat.usedByHint')}>
            {/* Cùng danh mục Bộ phận với ô "ai đang dùng" của hồ sơ IP — hai chỗ trả lời cùng
                một câu, viết lệch nhau thì tra chéo không ra. */}
            <SuggestInput
              value={usedBy}
              onChange={setUsedBy}
              options={departments}
              placeholder={t('nat.usedByPlaceholder')}
              ariaLabel={t('nat.usedBy')}
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

          <Field
            label={t('nat.reason')}
            required
            hint={t('nat.reasonHint')}
            htmlFor="nat-reason"
            span={2}
          >
            <textarea
              id="nat-reason"
              className="inp"
              rows={2}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        </FormSection>

        {/* Nói TRƯỚC khi bấm Lưu là sẽ ghi ra mấy dòng — sau đó mới biết thì đã muộn. */}
        {ports.length > 1 ? (
          <p className="alert">{t('nat.willCreate', { count: ports.length })}</p>
        ) : null}

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>

    {/* Router chưa có trong kho: khai bằng ĐÚNG hộp "Thêm thiết bị" (AD-15), rồi chọn luôn
        cái vừa tạo. Form NAT đang dở vẫn nguyên vẹn phía sau. */}
    {addingRouter ? (
      <DeviceForm
        device={null}
        lists={lists.data}
        csrfToken={csrfToken}
        onClose={() => setAddingRouter(false)}
        onSaved={(result) => {
          setAddingRouter(false);
          setDeviceId(result.device.id);
          setDeviceTerm(result.device.code);
          void queryClient.invalidateQueries({ queryKey: ['devices'] });
        }}
      />
    ) : null}

    {/* Dịch vụ mới: cũng ĐÚNG hộp của màn Danh mục, không dựng bản rút gọn thứ hai. */}
    {addingService ? (
      <CatalogForm
        entity="service_port"
        row={null}
        lists={lists.data}
        csrfToken={csrfToken}
        onClose={() => setAddingService(null)}
        onSaved={(saved) => {
          applyService(saved as ServicePortRow, addingService);
          setAddingService(null);
          void queryClient.invalidateQueries({ queryKey: ['catalog'] });
        }}
      />
    ) : null}
    </>
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
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={480}
      title={t('nat.removeTitle', { ports: `${rule.protocol.toUpperCase()} ${rule.externalPorts}` })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="nat-remove-form"
            className="btn danger"
            disabled={remove.isPending}
          >
            {remove.isPending ? t('common.loading') : t('nat.remove')}
          </button>
        </>
      }
    >
      <form
        id="nat-remove-form"
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
      </form>
    </Dialog>
  );
}
