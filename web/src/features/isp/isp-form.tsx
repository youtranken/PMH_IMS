import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CatalogForm } from '@/features/catalog/catalog-form';
import { useMe } from '@/lib/api';
import { isIpv4OrCidr } from '@/lib/ipv4';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { Combobox } from '@/ui/combobox';
import { DatePicker } from '@/ui/date-picker';
import { PlusIcon } from '@/ui/glyph-icons';
import {
  DeviceTypeFilter,
  deviceTypeIdsParam,
  isRouterType,
  useDeviceTypeFilter,
} from '@/ui/device-type-filter';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { Field, FormSection } from '@/ui/page-header';
import { AttachmentDraftSection, useAttachmentDraft } from '@/ui/attachment-draft';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import type { DeviceRow } from '@/lib/device-types';
import type { IspRow } from './isp-types';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';
import { secretTextRule, useFormErrors } from '@/ui/use-form-errors';
import { PhoneInput } from '@/ui/phone-input';

interface FormState {
  code: string;
  providerId: string;
  bandwidth: string;
  wanIp: string;
  siteId: string;
  hotline: string;
  contractNo: string;
  startDate: string;
  note: string;
}

function initialState(row: IspRow | null): FormState {
  return {
    code: row?.code ?? '',
    providerId: row?.providerId ?? '',
    bandwidth: row?.bandwidth ?? '',
    wanIp: row?.wanIp ?? '',
    siteId: row?.siteId ?? '',
    hotline: row?.hotline ?? '',
    contractNo: row?.contractNo ?? '',
    startDate: row?.startDate ?? '',
    note: row?.note ?? '',
  };
}

/** Form đường truyền ISP (FR-010). Màn nhập — desktop-first. */
export function IspForm({
  row,
  csrfToken,
  onClose,
  onSaved,
}: {
  row: IspRow | null;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  /*
   * Form TỰ hỏi danh mục thay vì nhận qua props: `useCatalogLists` dùng chung `queryKey` nên
   * đây không phải lượt gọi thêm, nhưng form THẤY được `isError`. Props `CatalogLists |
   * undefined` không có đường nào phân biệt "danh mục hỏng" với "chưa tải xong".
   */
  const lists = useCatalogLists();
  const [form, setForm] = useState<FormState>(() => initialState(row));
  const [device, setDevice] = useState<{ id: string; code: string } | null>(
    row?.deviceId ? { id: row.deviceId, code: row.deviceCode ?? '' } : null,
  );
  const [query, setQuery] = useState(row?.deviceCode ?? '');
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Bản scan hợp đồng ISP đi kèm ngay lúc khai đường mới (AD-15 — cùng khối với thiết bị và
  // phần mềm). Sửa đường thì tab "Giấy tờ" ở trang chi tiết mới là chỗ xem cả danh sách.
  const draft = useAttachmentDraft();
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(id);
  }, [query]);

  /*
   * Chưa gõ gì vẫn hỏi (10 máy đầu): ô mở ra trắng trơn thì người khai không biết đây là ô
   * tìm hay ô chọn. Đã chọn xong thì thôi hỏi — ô đang hiện đúng mã máy.
   */
  /* Chưa gõ mà đã chọn site: danh sách mở sẵn là máy CÙNG site (thiết bị biên nằm ở đó).
     Gõ thì tìm khắp kho — Draytek chưa gán site vẫn phải tìm ra được. */
  const nearSite = debounced.trim() === '' ? form.siteId : '';
  /* Lọc theo LOẠI, mặc định các loại cờ Router (Q-20) — cùng bộ lọc với ô Router của NAT. Chọn
     máy ngoài các loại đó chỉ cảnh báo: đường truyền cắm thẳng vào Core/Firewall là chuyện có. */
  const deviceTypes = lists.data?.deviceTypes;
  const typeFilter = useDeviceTypeFilter(deviceTypes);
  const [pickedTypeId, setPickedTypeId] = useState<string | null>(null);
  const notRouter =
    device !== null &&
    (deviceTypes ?? []).some((type) => type.isRouter) &&
    !isRouterType(deviceTypes, pickedTypeId);
  const byType = deviceTypeIdsParam(typeFilter.value);
  const candidates = useQuery({
    queryKey: ['devices', 'picker', debounced, nearSite, typeFilter.value.join(',')],
    // Chờ danh mục: hỏi trước khi biết loại nào là Router thì danh sách mở ra chưa lọc rồi co lại.
    enabled: device === null && !lists.isPending,
    queryFn: () =>
      apiFetch<{ items: DeviceRow[] }>(
        `/api/v1/devices?limit=10&usable=true&search=${encodeURIComponent(debounced.trim())}${
          nearSite ? `&siteId=${nearSite}` : ''
        }${byType ? `&${byType}` : ''}`,
      ),
  });
  /* Máy nào đang là thiết bị biên của đường KHÁC — một Draytek hai đường là chuyện có thật,
     nhưng người chọn phải thấy để khỏi gắn nhầm. Hỏng thì chỉ thiếu dòng ghi thêm. */
  const otherLines = useQuery({
    queryKey: ['isp', 'edge-usage'],
    enabled: device === null,
    queryFn: () =>
      apiFetch<{ items: { id: string; code: string; deviceId: string | null }[] }>(
        '/api/v1/isp-lines?limit=200',
      ),
  });
  const linesOn = (deviceId: string) =>
    (otherLines.data?.items ?? [])
      .filter((line) => line.deviceId === deviceId && line.id !== row?.id)
      .map((line) => line.code);

  const save = useApiMutation<Record<string, unknown>, { id: string }>(
    row ? `/api/v1/isp-lines/${row.id}` : '/api/v1/isp-lines',
    { method: row ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );
  // Đẩy giấy tờ chạy SAU khi lưu xong, lúc `isPending` đã tắt — không khoá thêm thì nút Lưu
  // mở lại và bấm thêm phát nữa là khai trùng một đường truyền.
  const busy = save.isPending || uploading;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const check = useFormErrors({
    code: !form.code.trim() && t('formErrors.required'),
    providerId: !form.providerId && t('formErrors.requiredPick'),
    // IP tĩnh hoặc một khối IP tĩnh — gõ sai thì nói ngay, không để lưu một chuỗi không tra được.
    wanIp: form.wanIp.trim() !== '' && !isIpv4OrCidr(form.wanIp) && t('isp.wanIpInvalid'),
    note: secretTextRule(t, form.note),
  });
  const me = useMe().data;
  const canAddProvider = me?.role === 'sa' || me?.role === 'admin';
  const [addingProvider, setAddingProvider] = useState(false);
  const queryClient = useQueryClient();

  return (
    <>
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!busy}
      guardUnsaved
      maxWidth={1040}
      title={row ? `${t('isp.edit')} — ${row.code}` : t('isp.add')}
      footer={
        <>
          <DialogCancel>
            {t('common.cancel')}
          </DialogCancel>
          <button type="submit" form="isp-form" className="btn primary" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="isp-form"
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          save.mutate(
            {
              code: form.code.trim(),
              providerId: form.providerId,
              bandwidth: form.bandwidth.trim(),
              wanIp: form.wanIp.trim(),
              siteId: form.siteId,
              deviceId: device?.id ?? '',
              hotline: form.hotline.trim(),
              contractNo: form.contractNo.trim(),
              startDate: form.startDate,
              note: form.note.trim(),
            },
            {
              onSuccess: (created) => {
                void (async () => {
                  toast({ message: t('isp.saved') });
                  // Giấy tờ đi SAU khi đường truyền đã có id — file không treo vào cái chưa có.
                  if (draft.files.length > 0) {
                    setUploading(true);
                    const count = draft.files.length;
                    const failures = await draft.upload(
                      'isp',
                      row?.id ?? created.id,
                      csrfToken,
                    );
                    setUploading(false);
                    if (failures.length < count) {
                      toast({
                        message: t('attachments.draftUploaded', {
                          count: count - failures.length,
                        }),
                      });
                    }
                    for (const message of failures) toast({ message, tone: 'warn' });
                  }
                  onSaved();
                })();
              },
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        {/*
          Khối lỗi nằm ở ĐẦU form, không phải ở cuối.

          Đặt ngay trên `</form>` là nằm DƯỚI cả khu Giấy tờ đính kèm: trên một form dài như
          thế này nó rơi ra ngoài màn hình, người dùng bấm Lưu, không thấy gì xảy ra, và bấm
          tiếp vài lần nữa. Câu lỗi có tồn tại cũng như không.
        */}
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
        {check.summary}
        <FormSection title={t('isp.tabProfile')} columns={4}>
          <Field label={t('isp.code')} required htmlFor="isp-code" error={check.error('code')}>
            <input
              id="isp-code"
              className="inp mono"
              required
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
          <Field
            label={t('isp.provider')}
            required
            tip={t('isp.providerHint')}
            htmlFor="isp-provider"
            error={check.error('providerId')}
          >
            {/* Chọn từ danh mục, không gõ tự do (Q-11): chữ gõ tay sinh ra "FPT" / "fpt " là
                hai nhà mạng khác nhau, và đổi tên trong danh mục không tới được hồ sơ nào.
                Mục ngừng dùng chỉ còn trong danh sách khi hồ sơ đang trỏ vào nó.
                Field chỉ tự nối id/mô tả/lỗi khi có ĐÚNG MỘT đứa con — ở đây có thêm nút
                "+ Thêm nhà mạng", nên nối tay theo đúng quy ước id của Field. */}
            <Select
              id="isp-provider"
              aria-describedby={check.error('providerId') ? 'isp-provider-error' : undefined}
              aria-invalid={check.error('providerId') ? true : undefined}
              value={form.providerId}
              ariaLabel={t('isp.provider')}
              placeholder={t('isp.providerPlaceholder')}
              failed={lists.isError}
              required
              options={activeOptions(lists.data?.ispProviders, row?.providerId, (item) => item.name)}
              onChange={(value) => set('providerId', value)}
            />
            {/* Nhà mạng mới thì khai NGAY tại đây bằng đúng hộp của màn Danh mục (AD-15) —
                bắt huỷ form sang Danh mục rồi quay lại gõ lại là mất trắng thứ đang khai. */}
            {canAddProvider ? (
              <button
                type="button"
                className="btn sm ghost with-icon"
                disabled={busy}
                onClick={() => setAddingProvider(true)}
              >
                <PlusIcon />
                {t('isp.addProvider')}
              </button>
            ) : null}
          </Field>
          <Field label={t('isp.bandwidth')} hint={t('isp.bandwidthHint')} htmlFor="isp-bandwidth">
            <input
              id="isp-bandwidth"
              className="inp"
              value={form.bandwidth}
              onChange={(e) => set('bandwidth', e.target.value)}
            />
          </Field>

          <Field
            label={t('isp.wanIp')}
            hint={t('isp.wanIpHint')}
            htmlFor="isp-wanip"
            error={check.error('wanIp')}
          >
            <input
              id="isp-wanip"
              className="inp mono"
              inputMode="decimal"
              value={form.wanIp}
              onChange={(e) => set('wanIp', e.target.value)}
            />
          </Field>
          <Field label={t('isp.site')}>
            {/* Chữ của Ô GHI, không phải của bộ lọc: "Tất cả site" ở đây đọc thành "line này
                thuộc mọi site". Cùng chữ với form thiết bị. */}
            <Select
              value={form.siteId}
              ariaLabel={t('isp.site')}
              placeholder={t('devices.noSitePick')}
              failed={lists.isError}
              options={activeOptions(
                lists.data?.sites,
                row?.siteId,
                (site) => `${site.code} — ${site.name}`,
              )}
              onChange={(value) => set('siteId', value)}
            />
          </Field>
          {/*
            KHÔNG có ô Trạng thái. Đổi trạng thái chỉ đi menu ⋮ của trang chi tiết, nơi hộp hỏi
            lại nhắc ngăn két PPPoE/modem và thiết bị biên đang cắm — ô chọn ở đây bỏ qua cả
            hai. Form cũng không gửi `status`: gửi lại giá trị lúc mở hộp là đè mất lượt đổi
            trạng thái vừa làm ở nơi khác.
          */}

          <Field label={t('isp.device')} hint={t('isp.deviceHint')} span={3} htmlFor="isp-device">
            {/* Có thêm dải chip lọc loại nên Field không tự nối id/mô tả — nối tay theo quy ước. */}
            <Combobox
              id="isp-device"
              aria-describedby="isp-device-hint"
              ariaLabel={t('isp.device')}
              placeholder={t('isp.deviceSearch')}
              query={query}
              onQuery={(value) => {
                setQuery(value);
                // Gõ lại là bỏ lựa chọn cũ — nếu không, ô hiện tên A mà id vẫn là B.
                setDevice(null);
              }}
              options={candidates.data?.items ?? []}
              failed={candidates.isError}
              getKey={(item) => item.id}
              renderOption={(item) => {
                const used = linesOn(item.id);
                return (
                  <>
                    <span className="mono">{item.code}</span> <small>{item.name}</small>
                    {used.length > 0 ? (
                      <small>
                        {' · '}
                        {t('isp.edgeInUse', { lines: used.join(', ') })}
                      </small>
                    ) : null}
                  </>
                );
              }}
              onSelect={(item) => {
                setDevice({ id: item.id, code: item.code });
                setPickedTypeId(item.deviceTypeId);
                setQuery(item.code);
              }}
            />
            {notRouter ? (
              <span className="field-hint warn-text">{t('deviceTypeFilter.notRouter')}</span>
            ) : null}
            <DeviceTypeFilter
              types={deviceTypes}
              value={typeFilter.value}
              onChange={typeFilter.setValue}
            />
          </Field>
        </FormSection>

        {/* Hai ô đầu là lý do màn ISP tồn tại: 2 giờ sáng gọi ai, đọc số hợp đồng nào.
            Tiêu đề khối KHÔNG là "Hotline" — khối này chứa cả hợp đồng và ngày bắt đầu, đặt
            tên theo ô đầu tiên là nói sai về các ô còn lại. Không có ô hết hạn: đường truyền
            không có hạn, dùng tới khi thanh lý (Q-04). */}
        <FormSection title={t('isp.sectionContract')} columns={4}>
          <Field label={t('isp.hotline')} htmlFor="isp-hotline">
            <PhoneInput
              id="isp-hotline"
              placeholder={t('isp.phHotline')}
              value={form.hotline}
              onChange={(next) => set('hotline', next)}
            />
          </Field>
          <Field label={t('isp.contractNo')} htmlFor="isp-contract">
            <input
              id="isp-contract"
              className="inp mono"
              value={form.contractNo}
              onChange={(e) => set('contractNo', e.target.value)}
            />
          </Field>
          <Field label={t('isp.startDate')}>
            <DatePicker
              value={form.startDate}
              ariaLabel={t('isp.startDate')}
              onChange={(value) => set('startDate', value)}
            />
          </Field>
          <Field label={t('isp.note')} hint={t('isp.noteHint')} htmlFor="isp-note" error={check.error('note')}>
            <input
              id="isp-note"
              className="inp"
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </Field>
        </FormSection>

        {/* Thêm mới: chọn bản scan hợp đồng, đẩy lên sau khi có id.
            Sửa: panel giấy tờ đầy đủ — đổi hợp đồng là việc thường xuyên của đường truyền. */}
        {row ? (
          /* Panel này GHI THẲNG: tải lên và xóa bay đi ngay lúc bấm, không nằm trong lượt lưu
             của form. Trong một hộp thoại CÓ nút Hủy thì điều đó không hiển nhiên, nên nói ra —
             ở nút (i) cạnh tiêu đề, không phải một băng cảnh báo làm hộp cao thêm. */
          <FormSection
            title={t('attachments.title')}
            titleTip={t('attachments.liveTip')}
            columns={1}
          >
            <AttachmentPanel
              ownerType="isp"
              ownerId={row.id}
              csrfToken={csrfToken}
              canEdit={!busy}
            />
          </FormSection>
        ) : (
          <AttachmentDraftSection draft={draft} disabled={busy} />
        )}

      </form>
    </Dialog>

    {addingProvider ? (
      <CatalogForm
        entity="isp_provider"
        row={null}
        csrfToken={csrfToken}
        onClose={() => setAddingProvider(false)}
        onSaved={(saved) => {
          setAddingProvider(false);
          set('providerId', (saved as { id: string }).id);
          void queryClient.invalidateQueries({ queryKey: ['catalog'] });
        }}
      />
    ) : null}
    </>
  );
}
