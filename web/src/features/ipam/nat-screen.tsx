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
import { RowActions } from '@/ui/row-actions';
import { Field, FormSection, PageHeader } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { SuggestInput } from '@/ui/suggest-input';
import { useToast } from '@/ui/toast';
import type { ServicePortRow } from '@/lib/catalog-types';
import { CatalogForm } from '@/features/catalog/catalog-form';
import { DeviceForm } from '@/features/devices/device-form';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { HistoryPanel } from '@/ui/history-panel';
import { ServicePortPicker } from './service-port-picker';
import { toNatHistory, type NatHistoryRow } from './nat-history-entries';
import { checkInternalIp } from './nat-internal-ip';
import { STATUS_KEY, type IpStatus } from './ipam-types';
import { chipsFromValue, parsePortChip, type PortChip } from './port-chips';
import { PortChipsField } from './port-chips-field';
import { PATHS } from '@/lib/routes';
import { useCatalogLists } from '@/ui/use-catalog-lists';

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
  /** Máy ĐƯỢC NAT (khác `deviceId` — con router thực hiện NAT). Suy từ hồ sơ IP. */
  internalDeviceId: string | null;
  internalDeviceCode: string | null;
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

  const lists = useCatalogLists();

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
          failed={lists.isError}
        />
      </FilterBar>

      {rules.isLoading ? (
        <Loading />
      ) : rules.isError ? (
        <LoadError error={rules.error} onRetry={() => void rules.refetch()} />
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
                    {/* MÁY ĐÍCH ngay trên bảng: "dẫn tới 172.16.10.5" mà không nói đó là máy
                        nào thì người đọc sổ vẫn phải sang màn IP tra tiếp. */}
                    {rule.internalDeviceId ? (
                      <span className="cell-sub">
                        <Link className="mono" to={PATHS.device(rule.internalDeviceId)}>
                          {rule.internalDeviceCode}
                        </Link>
                        {rule.internalOwner ? ` · ${rule.internalOwner}` : ''}
                      </span>
                    ) : rule.internalOwner ? (
                      <span className="cell-sub">{rule.internalOwner}</span>
                    ) : null}
                  </td>
                  <td data-label={t('nat.usedBy')}>{rule.usedBy}</td>
                  <td data-label={t('nat.reason')}>{rule.reason}</td>
                  <td>
                    <div className="action-cell">
                      <RowActions
                        label={t('common.actionsOf', {
                          subject: `${rule.protocol.toUpperCase()} ${rule.externalPorts}`,
                        })}
                        items={[
                          {
                            key: 'edit',
                            label: t('common.edit'),
                            onSelect: () => setEditing({ rule }),
                          },
                          ...(canHide
                            ? [
                                {
                                  key: 'remove',
                                  label: t('nat.remove'),
                                  onSelect: () => setHiding(rule),
                                  danger: true,
                                },
                              ]
                            : []),
                        ]}
                      />
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
          onPartial={({ created, warnings }) => {
            // Bảng phía sau phải phản ánh mấy dòng vừa ghi được, dù hộp còn mở.
            toast({
              message: created > 1 ? t('nat.savedMany', { count: created }) : t('nat.saved'),
            });
            for (const warning of warnings) toast({ message: warning, tone: 'warn' });
            void refresh();
          }}
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
  onPartial,
}: {
  rule: NatRow | null;
  csrfToken: string;
  onClose: () => void;
  onSaved: (result: { created: number; warnings: string[] }) => void;
  /** Ghi được một phần: làm mới bảng phía sau nhưng KHÔNG đóng hộp. */
  onPartial: (result: { created: number; warnings: string[] }) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState(rule?.deviceId ?? '');
  const [deviceTerm, setDeviceTerm] = useState(rule?.deviceCode ?? '');
  /*
   * Ô "Loại thiết bị" ĐÃ BỎ (26/08/2026).
   *
   * Nó là một bộ lọc cho ô Router ngay dưới, nhưng đứng thành một trường riêng nên để chọn
   * MỘT con router phải thao tác HAI dropdown. Tệ hơn: chọn nhầm loại là danh sách router
   * rỗng trơn, và người dùng kết luận kho không có router nào. Router ở PMH gần như luôn là
   * Firewall/Draytek — một ô tìm là đủ, gõ hai chữ ra ngay.
   */
  /** Máy ĐƯỢC NAT — chọn máy thì ô IP trong chỉ còn IP của chính máy đó. */
  const [targetId, setTargetId] = useState(rule?.internalDeviceId ?? '');
  const [targetTerm, setTargetTerm] = useState(rule?.internalDeviceCode ?? '');
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

  const lists = useCatalogLists();

  /**
   * KHÔNG còn `enabled: deviceTerm.length > 0`.
   *
   * Bản cũ chỉ hỏi khi đã gõ, nên ô Router mở ra là một ô trắng với dòng nhắc "Gõ mã hoặc
   * tên router…" — người dùng gõ, không ra gì (kho chưa có router nào), và kết luận là hệ
   * thống hỏng. Danh sách hiện sẵn thì thấy ngay có gì để chọn, hoặc thấy ngay là chưa có gì
   * và bấm "Thêm router mới" ở đầu menu.
   */
  const devices = useQuery({
    queryKey: ['devices', 'picker', deviceTerm],
    queryFn: () => {
      // `usable=true`: máy đã thanh lý không dựng được rule NAT (API chặn), nên không bày ra.
      const params = new URLSearchParams({ limit: '20', usable: 'true' });
      if (deviceTerm.trim()) params.set('search', deviceTerm.trim());
      return apiFetch<{ items: DeviceOption[] }>(`/api/v1/devices?${params.toString()}`);
    },
  });

  /** Danh sách máy cho ô "Máy đích" — cùng cửa với ô Router, khác từ khoá tìm. */
  const targets = useQuery({
    queryKey: ['devices', 'picker', 'target', targetTerm],
    queryFn: () => {
      // `usable=true`: máy đã thanh lý không dựng được rule NAT (API chặn), nên không bày ra.
      const params = new URLSearchParams({ limit: '20', usable: 'true' });
      if (targetTerm.trim()) params.set('search', targetTerm.trim());
      return apiFetch<{ items: DeviceOption[] }>(`/api/v1/devices?${params.toString()}`);
    },
  });

  /**
   * IP của máy đích. Chọn máy xong thì ô "IP trong" chỉ còn IP của chính máy đó — hết cảnh
   * gõ tay một địa chỉ không thuộc máy nào (thứ `validateNatRule` đang phải chặn ở tầng sau).
   */
  const targetIps = useQuery({
    queryKey: ['ipam', 'device-addresses', targetId],
    enabled: targetId !== '',
    queryFn: () =>
      apiFetch<{ id: string; address: string; usedBy: string | null; status: IpStatus }[]>(
        `/api/v1/ipam/devices/${targetId}/addresses`,
      ),
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
      /*
       * Đang SỬA (đã đủ một khoảng) thì KHÔNG đụng gì cả — kể cả giao thức.
       *
       * Bản trước vẫn `setProtocol(...)` trong trường hợp này, nên người dùng mở hộp Sửa,
       * chọn HTTPS, thấy giao thức nhảy sang TCP mà con số port đứng im, và tin rằng port
       * đã đổi theo. Im lặng một nửa còn tệ hơn im lặng hẳn.
       */
      if (ports.length >= maxPorts) return;
      const parsed = parsePortChip(value, ports);
      /*
       * Khoảng này đã có rồi thì KHÔNG đụng gì cả — kể cả giao thức.
       *
       * Cùng lỗi "im lặng một nửa" với chế độ sửa: gõ tay 443, đổi giao thức sang UDP, rồi
       * chọn "HTTPS" (443/TCP) trong danh mục — danh sách port đứng im mà giao thức lặng lẽ
       * nhảy về TCP. Người dùng không bấm gì thêm và không hề biết.
       */
      if (!parsed.chip) return;
      setPorts([...ports, parsed.chip]);
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
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!busy}
      guardUnsaved
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
          /*
           * Hai luật của ô "IP trong" nằm ở `checkInternalIp` (hàm thuần, có test bảng dữ
           * liệu): phải có địa chỉ, và địa chỉ phải thuộc chính máy đích đang chọn.
           */
          const ipCheck = checkInternalIp({
            internalIp,
            targetId,
            targetIps: (targetIps.data ?? []).map((ip) => ip.address),
          });
          if (ipCheck.reason) {
            setError(t(`nat.${ipCheck.reason}`));
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
            /** Khoảng đã ghi xong — bỏ khỏi danh sách nếu phải giữ hộp lại. */
            const written: string[] = [];
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
                written.push(chip.value);
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
            /*
             * Hỏng một phần thì GIỮ HỘP LẠI, chỉ bỏ đi những khoảng đã ghi xong.
             *
             * Đóng hộp là mất trắng router, máy đích, IP, lý do và mấy khoảng còn lại — người
             * dùng phải gõ lại từ đầu chỉ vì một khoảng đụng rule cũ. Toast cảnh báo trôi qua
             * trong vài giây, còn cái form thì đã biến mất.
             */
            if (failures.length > 0) {
              setPorts((current) => current.filter((chip) => !written.includes(chip.value)));
              setError(failures.join(' '));
              // Cảnh báo của những dòng ĐÃ ghi vẫn phải tới nơi.
              onPartial({ created, warnings });
              return;
            }
            onSaved({ created, warnings });
          })();
        }}
      >
        <FormSection title={t('nat.sectionExternal')} columns={2}>
          {/* MỘT ô chọn router, không hai. Ô "Loại thiết bị" cũ chỉ là bộ lọc cho chính ô
              này, nhưng đứng thành trường riêng nên chọn một con router phải thao tác hai
              dropdown — và chọn nhầm loại là danh sách rỗng trơn. */}
          <Field label={t('nat.router')} required hint={t('nat.routerHint')} span={2}>
            <Combobox
              placeholder={t('nat.routerSearch')}
              ariaLabel={t('nat.router')}
              query={deviceTerm}
              onQuery={(value) => {
                setDeviceTerm(value);
                setDeviceId('');
              }}
              options={devices.data?.items ?? []}
              failed={devices.isError}
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
          </Field>

          {/* Hai ô port đứng CẠNH nhau: "ngoài 8080 dẫn vào trong 80" là một câu đọc ngang,
              tách hai hàng thì phải nhớ số bên trên trong lúc đọc số bên dưới. */}
          <Field
            label={t('nat.external')}
            required
            hint={rule ? t('nat.externalHintEdit') : t('nat.externalHint')}
            htmlFor="nat-external"
          >
            <PortChipsField
              chips={ports}
              onChange={setPorts}
              max={maxPorts}
              disabled={busy}
              inputId="nat-external"
            />
            {/* Giao thức KHÔNG còn là một ô nhập riêng: chọn dịch vụ trong danh mục là nó tự
                theo (danh mục đã ghi TCP/UDP của từng dịch vụ). Chỉ hiện ra để đọc, và chỉ
                mở cho sửa khi người dùng tự gõ port thay vì chọn dịch vụ — bỏ hẳn thì port
                gõ tay luôn mặc định TCP, sai âm thầm với mấy dịch vụ UDP như VPN. */}
            <div className="proto-row">
              <span className="muted">{t('nat.protocol')}:</span>
              <div className="segmented" role="group" aria-label={t('nat.protocol')}>
                {PROTOCOLS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={protocol === item ? 'on' : undefined}
                    aria-pressed={protocol === item}
                    onClick={() => setProtocol(item)}
                  >
                    {item === 'both' ? t('nat.protocolBoth') : item.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            {/* Đủ khoảng rồi (chế độ sửa) thì ẩn hẳn ô chọn dịch vụ: một điều khiển bấm vào
                mà không xảy ra gì là thứ người dùng sẽ bấm vài lần rồi nghĩ máy hỏng. */}
            {ports.length >= maxPorts ? null : (
              <ServicePortPicker
                services={services}
                label={t('nat.external')}
                onPick={(service) => applyService(service, 'external')}
                onAdd={() => setAddingService('external')}
              />
            )}
          </Field>

          <Field label={t('nat.internalPort')} required htmlFor="nat-internal-port">
            <input
              id="nat-internal-port"
              className="inp mono"
              required
              inputMode="numeric"
              placeholder="80"
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

        <FormSection title={t('nat.sectionInternal')} columns={2}>
          {/*
            MÁY ĐÍCH — ô này trước đây KHÔNG có, và đó là lỗ hổng lớn nhất của cuốn sổ: nó
            ghi "dẫn tới 172.16.10.5" mà không nói 172.16.10.5 là máy nào. Ba thứ trong form
            là ba câu khác nhau, không trùng nhau:
              Router   = con nào THỰC HIỆN NAT (Draytek)
              Máy đích = con nào ĐƯỢC NAT (camera, NAS, máy chủ)  ← ô này
              Mở cho ai = NGƯỜI/bộ phận hưởng dịch vụ (câu auditor hỏi)
          */}
          <Field label={t('nat.target')} hint={t('nat.targetHint')}>
            <Combobox
              placeholder={t('nat.targetSearch')}
              ariaLabel={t('nat.target')}
              query={targetTerm}
              onQuery={(value) => {
                setTargetTerm(value);
                setTargetId('');
              }}
              options={targets.data?.items ?? []}
              failed={targets.isError}
              getKey={(item) => item.id}
              renderOption={(item) => (
                <>
                  <span className="mono">{item.code}</span> <small>{item.name}</small>
                </>
              )}
              onSelect={(item) => {
                setTargetId(item.id);
                setTargetTerm(item.code);
                setInternalIp('');
              }}
            />
          </Field>

          <Field label={t('nat.internalIp')} required htmlFor="nat-internal-ip">
            {targetId && (targetIps.isLoading || targetIps.isError) ? (
              /*
               * ĐANG TẢI danh sách IP của máy vừa chọn — chưa biết máy đó có IP hay không.
               * Rơi thẳng về ô gõ tay ở đây là sai hai lần: nó bày ra dòng "máy này chưa có
               * hồ sơ IP nào" trong khi câu trả lời chưa về, và nó mở đúng cái cửa gõ tay một
               * địa chỉ THUỘC MÁY KHÁC — rule sẽ lặng lẽ ghi về máy kia, vì máy đích của rule
               * suy ra từ IP chứ không từ ô chọn này.
               */
              <Select
                id="nat-internal-ip"
                value=""
                disabled
                ariaLabel={t('nat.internalIp')}
                placeholder={t(targetIps.isError ? 'nat.targetIpsError' : 'common.loading')}
                options={[]}
                onChange={() => {}}
              />
            ) : targetId && (targetIps.data ?? []).length > 0 ? (
              // Đã chọn máy thì chỉ còn IP CỦA CHÍNH MÁY ĐÓ — hết cảnh gõ tay một địa chỉ
              // không thuộc máy nào rồi bị API từ chối ở bước cuối.
              <Select
                id="nat-internal-ip"
                value={internalIp}
                ariaLabel={t('nat.internalIp')}
                placeholder={t('nat.pickIp')}
                /*
                 * Endpoint trả MỌI trạng thái vòng đời, chỉ lọc bản ghi đã hủy. Một IP
                 * `suspect_dead` vẫn giữ `device_id` nên nó lọt vào đây trông y hệt một IP
                 * khỏe — và người khai chĩa một rule NAT mới vào đúng địa chỉ mà IPAM đang
                 * nghi là đã chết. Vẫn CHO chọn (có thể máy vừa sống lại), nhưng phải NÓI RA.
                 */
                options={(targetIps.data ?? []).map((ip) => ({
                  value: ip.address,
                  label: [
                    ip.address,
                    ip.status === 'assigned' ? null : t(STATUS_KEY[ip.status]),
                    ip.usedBy,
                  ]
                    .filter(Boolean)
                    .join(' — '),
                }))}
                onChange={setInternalIp}
              />
            ) : (
              <>
                <input
                  id="nat-internal-ip"
                  className="inp mono"
                  required
                  placeholder="172.16.10.5"
                  value={internalIp}
                  onChange={(e) => setInternalIp(e.target.value)}
                />
                {targetId ? (
                  <span className="field-hint muted">{t('nat.targetNoIp')}</span>
                ) : null}
              </>
            )}
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

        {/*
          SỬA một rule đang có thì mở thêm hai khu: giấy tờ và lịch sử.

          Giấy tờ — ảnh chụp cấu hình Draytek, email nhà mạng xác nhận mở port — trước đây
          không có chỗ đính nên nằm trong thư mục chia sẻ của phòng IT.

          Lịch sử — "ai mở port này, ngày nào, vì sao, ai gỡ" — là câu auditor hỏi nhiều nhất
          về sổ NAT, và trước 0037 chỉ tra được bằng SQL trên `audit_log`.

          THÊM MỚI thì không hiện: chưa có id để gắn, và một rule chưa tồn tại thì chưa có gì
          để kể.
        */}
        {rule ? (
          <>
            <FormSection title={t('attachments.title')} columns={1}>
              {/* Panel này GHI THẲNG, không nằm trong lượt Lưu của form — trong hộp thoại CÓ
                  nút Hủy thì điều đó không hiển nhiên, nên phải nói ra. */}
              <p className="alert">{t('attachments.liveWarning')}</p>
              <AttachmentPanel
                ownerType="nat_rule"
                ownerId={rule.id}
                csrfToken={csrfToken}
                canEdit={!busy}
              />
            </FormSection>

            <FormSection title={t('nat.tabHistory')} columns={1}>
              <NatHistory ruleId={rule.id} />
            </FormSection>
          </>
        ) : null}

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
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!remove.isPending}
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

/**
 * Lịch sử của MỘT rule NAT (0037).
 *
 * Tách thành component riêng vì truy vấn chỉ chạy khi hộp Sửa mở ra — nhét `useQuery` vào
 * `NatForm` thì nó chạy cả lúc THÊM MỚI, gọi `/nat/undefined/history` và nhận 400.
 */
function NatHistory({ ruleId }: { ruleId: string }) {
  const history = useQuery({
    queryKey: ['ipam', 'nat', ruleId, 'history'],
    queryFn: () => apiFetch<NatHistoryRow[]>(`/api/v1/ipam/nat/${ruleId}/history`),
  });

  if (history.isLoading) return <Loading />;
  if (history.isError) return <LoadError error={history.error} onRetry={() => void history.refetch()} />;
  return <HistoryPanel entries={toNatHistory(history.data ?? [])} />;
}
