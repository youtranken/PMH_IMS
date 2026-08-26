import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { Combobox } from '@/ui/combobox';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { Field, FormSection } from '@/ui/page-header';
import { AttachmentDraftSection, useAttachmentDraft } from '@/ui/attachment-draft';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { Select } from '@/ui/select';
import { SuggestInput } from '@/ui/suggest-input';
import { useToast } from '@/ui/toast';
import type { CatalogLists } from '@/features/catalog/catalog-types';
import type { DeviceRow } from '@/features/devices/device-types';
import { ISP_STATUSES, STATUS_KEY, type IspRow, type IspStatus } from './isp-types';

interface FormState {
  code: string;
  provider: string;
  bandwidth: string;
  wanIp: string;
  siteId: string;
  hotline: string;
  contractNo: string;
  startDate: string;
  endDate: string;
  note: string;
  status: IspStatus;
}

function initialState(row: IspRow | null): FormState {
  return {
    code: row?.code ?? '',
    provider: row?.provider ?? '',
    bandwidth: row?.bandwidth ?? '',
    wanIp: row?.wanIp ?? '',
    siteId: row?.siteId ?? '',
    hotline: row?.hotline ?? '',
    contractNo: row?.contractNo ?? '',
    startDate: row?.startDate ?? '',
    endDate: row?.endDate ?? '',
    note: row?.note ?? '',
    status: row?.status ?? 'active',
  };
}

/** Form đường truyền ISP (story 3.3, FR-010). Màn nhập — desktop-first. */
export function IspForm({
  row,
  lists,
  csrfToken,
  onClose,
  onSaved,
}: {
  row: IspRow | null;
  lists: CatalogLists | undefined;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
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

  const candidates = useQuery({
    queryKey: ['devices', 'picker', debounced],
    enabled: debounced.trim().length >= 2,
    queryFn: () =>
      apiFetch<{ items: DeviceRow[] }>(
        `/api/v1/devices?limit=10&search=${encodeURIComponent(debounced.trim())}`,
      ),
  });

  const save = useApiMutation<Record<string, unknown>, { id: string }>(
    row ? `/api/v1/isp-lines/${row.id}` : '/api/v1/isp-lines',
    { method: row ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );
  // Đẩy giấy tờ chạy SAU khi lưu xong, lúc `isPending` đã tắt — không khoá thêm thì nút Lưu
  // mở lại và bấm thêm phát nữa là khai trùng một đường truyền.
  const busy = save.isPending || uploading;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={800}
      title={row ? `${t('isp.edit')} — ${row.code}` : t('isp.add')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="isp-form" className="btn primary" disabled={busy}>
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="isp-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!form.code.trim() || !form.provider.trim()) {
            setError('Cần ít nhất mã đường truyền và tên nhà mạng.');
            return;
          }
          save.mutate(
            {
              code: form.code.trim(),
              provider: form.provider.trim(),
              bandwidth: form.bandwidth.trim(),
              wanIp: form.wanIp.trim(),
              siteId: form.siteId,
              deviceId: device?.id ?? '',
              hotline: form.hotline.trim(),
              contractNo: form.contractNo.trim(),
              startDate: form.startDate,
              endDate: form.endDate,
              note: form.note.trim(),
              status: form.status,
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
        <FormSection title={t('isp.tabProfile')} columns={3}>
          <Field label={t('isp.code')} required htmlFor="isp-code">
            <input
              id="isp-code"
              className="inp mono"
              required
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
          <Field label={t('isp.provider')} required hint={t('isp.providerHint')}>
            {/* Gợi ý từ danh mục Nhà mạng, nhưng VẪN gõ tự do được: nhà mạng mới ký hợp đồng
                lúc 5 giờ chiều thì phải khai được ngay, không chờ ai mở danh mục ra thêm. */}
            <SuggestInput
              value={form.provider}
              onChange={(value) => set('provider', value)}
              options={(lists?.ispProviders ?? []).map((item) => item.name)}
              placeholder={t('isp.providerPlaceholder')}
              ariaLabel={t('isp.provider')}
            />
          </Field>
          <Field label={t('isp.bandwidth')} htmlFor="isp-bandwidth">
            <input
              id="isp-bandwidth"
              className="inp"
              value={form.bandwidth}
              onChange={(e) => set('bandwidth', e.target.value)}
            />
          </Field>

          <Field label={t('isp.wanIp')} htmlFor="isp-wanip">
            <input
              id="isp-wanip"
              className="inp mono"
              value={form.wanIp}
              onChange={(e) => set('wanIp', e.target.value)}
            />
          </Field>
          <Field label={t('isp.site')}>
            <Select
              value={form.siteId}
              ariaLabel={t('isp.site')}
              placeholder={`— ${t('isp.allSites')} —`}
              options={(lists?.sites ?? []).map((site) => ({
                value: site.id,
                label: `${site.code} — ${site.name}`,
              }))}
              onChange={(value) => set('siteId', value)}
            />
          </Field>
          <Field label={t('isp.status')}>
            <Select
              value={form.status}
              ariaLabel={t('isp.status')}
              options={ISP_STATUSES.map((status) => ({
                value: status,
                label: t(STATUS_KEY[status]),
              }))}
              onChange={(value) => set('status', value as IspStatus)}
            />
          </Field>

          <Field label={t('isp.device')} hint={t('isp.deviceHint')} span={3}>
            <Combobox
              placeholder={t('isp.deviceSearch')}
              query={query}
              onQuery={(value) => {
                setQuery(value);
                // Gõ lại là bỏ lựa chọn cũ — nếu không, ô hiện tên A mà id vẫn là B.
                setDevice(null);
              }}
              options={candidates.data?.items ?? []}
              getKey={(item) => item.id}
              renderOption={(item) => (
                <>
                  <span className="mono">{item.code}</span> <small>{item.name}</small>
                </>
              )}
              onSelect={(item) => {
                setDevice({ id: item.id, code: item.code });
                setQuery(item.code);
              }}
            />
          </Field>
        </FormSection>

        {/* Hai ô này là lý do màn ISP tồn tại: 2 giờ sáng gọi ai, đọc số hợp đồng nào. */}
        <FormSection title={t('isp.hotline')} columns={3}>
          <Field label={t('isp.hotline')} htmlFor="isp-hotline">
            <input
              id="isp-hotline"
              className="inp mono"
              value={form.hotline}
              onChange={(e) => set('hotline', e.target.value)}
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
          <Field label={t('isp.endDate')}>
            <DatePicker
              value={form.endDate}
              ariaLabel={t('isp.endDate')}
              onChange={(value) => set('endDate', value)}
            />
          </Field>
          <Field label={t('isp.note')} htmlFor="isp-note" span={2}>
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
          <FormSection title={t('attachments.title')} columns={1}>
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

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
