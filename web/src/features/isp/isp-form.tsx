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
import { useToast } from '@/ui/toast';
import type { DeviceRow } from '@/lib/device-types';
import { ISP_STATUSES, STATUS_KEY, type IspRow, type IspStatus } from './isp-types';
import { useCatalogLists } from '@/ui/use-catalog-lists';

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
  status: IspStatus;
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
    status: row?.status ?? 'active',
  };
}

/** Form đường truyền ISP (story 3.3, FR-010). Màn nhập — desktop-first. */
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

  const candidates = useQuery({
    queryKey: ['devices', 'picker', debounced],
    enabled: debounced.trim().length >= 2,
    queryFn: () =>
      apiFetch<{ items: DeviceRow[] }>(
        `/api/v1/devices?limit=10&usable=true&search=${encodeURIComponent(debounced.trim())}`,
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
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!busy}
      guardUnsaved
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
          if (!form.code.trim() || !form.providerId) {
            setError(t('isp.needMinimum'));
            return;
          }
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
        {/*
          Khối lỗi nằm ở ĐẦU form, không phải ở cuối (12/09, rà UI/UX #12).

          Bản cũ đặt nó ngay trên `</form>`, tức DƯỚI cả khu Giấy tờ đính kèm. Trên một form
          dài như thế này thì nó nằm ngoài màn hình: người dùng bấm Lưu, không thấy gì xảy
          ra, và bấm tiếp vài lần nữa. Câu lỗi có tồn tại cũng như không.
        */}
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
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
            {/* Chọn từ danh mục, không gõ tự do (Q-11): chữ gõ tay sinh ra "FPT" / "fpt " là
                hai nhà mạng khác nhau, và đổi tên trong danh mục không tới được hồ sơ nào.
                Mục ngừng dùng chỉ còn trong danh sách khi hồ sơ đang trỏ vào nó. */}
            <Select
              value={form.providerId}
              ariaLabel={t('isp.provider')}
              placeholder={t('isp.providerPlaceholder')}
              failed={lists.isError}
              required
              options={(lists.data?.ispProviders ?? [])
                .filter((item) => item.active || item.id === row?.providerId)
                .map((item) => ({
                  value: item.id,
                  label: item.active ? item.name : `${item.name} (${t('isp.providerInactive')})`,
                }))}
              onChange={(value) => set('providerId', value)}
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
              failed={lists.isError}
              options={(lists.data?.sites ?? []).map((site) => ({
                value: site.id,
                label: `${site.code} — ${site.name}`,
              }))}
              onChange={(value) => set('siteId', value)}
            />
          </Field>
          {/*
            Ô Trạng thái CHỈ hiện khi SỬA.

            Thêm mới thì trạng thái luôn là "đang dùng" — bày một ô chọn có đúng một câu trả
            lời hợp lý là bắt người khai đọc và bỏ qua một thứ không có quyết định nào ở đó,
            và mở đường cho một hồ sơ vừa tạo đã ở trạng thái "đã thanh lý".
          */}
          {row ? (
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
          ) : null}

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
              failed={candidates.isError}
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

        {/* Hai ô đầu là lý do màn ISP tồn tại: 2 giờ sáng gọi ai, đọc số hợp đồng nào.
            Tiêu đề khối KHÔNG là "Hotline" — khối này chứa cả hợp đồng và ngày bắt đầu, đặt
            tên theo ô đầu tiên là nói sai về các ô còn lại. Không có ô hết hạn: đường truyền
            không có hạn, dùng tới khi thanh lý (Q-04). */}
        <FormSection title={t('isp.sectionContract')} columns={3}>
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
            {/* Panel này GHI THẲNG: tải lên và xóa bay đi ngay lúc bấm, không nằm trong lượt
                lưu của form. Trong một hộp thoại CÓ nút Hủy thì điều đó không hiển nhiên —
                xóa một bản scan rồi bấm Hủy là mất luôn, nên phải nói ra. */}
            <p className="alert">{t('attachments.liveWarning')}</p>
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
  );
}
