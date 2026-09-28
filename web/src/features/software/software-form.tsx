import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { Field, FormSection } from '@/ui/page-header';
import { AttachmentDraftSection, useAttachmentDraft } from '@/ui/attachment-draft';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';
import { useFormErrors } from '@/ui/use-form-errors';
import {
  codePrefix,
  KIND_KEY,
  LICENSE_MODELS,
  requiresEndDate,
  seatCheck,
  SOFTWARE_KINDS,
  SOFTWARE_STATUSES,
  STATUS_KEY,
  supportsSeats,
  type LicenseModel,
  type SoftwareKind,
  type SoftwareRow,
  type SoftwareStatus,
} from './software-types';

interface FormState {
  code: string;
  name: string;
  kind: SoftwareKind;
  licenseModel: LicenseModel;
  vendorId: string;
  seatTotal: string;
  startDate: string;
  endDate: string;
  note: string;
  status: SoftwareStatus;
}

function initialState(row: SoftwareRow | null): FormState {
  return {
    code: row?.code ?? '',
    name: row?.name ?? '',
    kind: row?.kind ?? 'license',
    licenseModel: row?.licenseModel ?? 'subscription',
    vendorId: row?.vendorId ?? '',
    seatTotal: row?.seatTotal != null ? String(row.seatTotal) : '',
    startDate: row?.startDate ?? '',
    endDate: row?.endDate ?? '',
    note: row?.note ?? '',
    status: row?.status ?? 'active',
  };
}

/** Form hồ sơ phần mềm (story 3.1, FR-008). Màn nhập — desktop-first. */
export function SoftwareForm({
  row,
  csrfToken,
  onClose,
  onSaved,
}: {
  /** null = thêm mới. */
  row: SoftwareRow | null;
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
  const [error, setError] = useState<string | null>(null);
  // Giấy tờ chọn kèm lúc THÊM MỚI (AD-15). Hồ sơ đang sửa thì đã có tab Giấy tờ ở trang
  // chi tiết — bày thêm một ô chọn ở đây chỉ làm người ta tưởng danh sách cũ biến mất.
  const draft = useAttachmentDraft();
  const [uploading, setUploading] = useState(false);

  const save = useApiMutation<Record<string, unknown>, { id: string }>(
    row ? `/api/v1/software/${row.id}` : '/api/v1/software',
    { method: row ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );
  // Trong lúc đẩy giấy tờ lên, `save` đã xong nên `isPending` hết đỏ — không khoá thêm thì
  // nút Lưu mở lại và bấm phát nữa là tạo hồ sơ thứ hai.
  const busy = save.isPending || uploading;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => {
      // Đổi sang loại không có seat thì xóa luôn ô seat — gửi lên sẽ bị API từ chối,
      // và giữ lại một con số vô nghĩa trên màn hình chỉ tổ gây hiểu nhầm.
      if (key === 'kind' && !supportsSeats(value as SoftwareKind)) {
        // Đổi sang loại không có seat: xóa seat, và kéo kỳ hạn về thuê bao vì chỉ license
        // mới có bản mua đứt (API cũng chặn, nhưng để form gửi lên rồi bị từ chối thì tệ).
        return {
          ...current,
          kind: value as SoftwareKind,
          seatTotal: '',
          licenseModel: 'subscription',
        };
      }
      // Đánh dấu vĩnh viễn thì bỏ luôn ngày hết hạn — hai thứ đó ngược nhau.
      if (key === 'licenseModel' && value === 'perpetual') {
        return { ...current, licenseModel: 'perpetual', endDate: '' };
      }
      return { ...current, [key]: value };
    });

  const hasSeats = supportsSeats(form.kind);
  const isPerpetual = form.licenseModel === 'perpetual';
  const seats = seatCheck(form.seatTotal, hasSeats, row?.seatUsed ?? 0, row?.seatTotal ?? null);
  const endRequired = requiresEndDate(form.kind, form.licenseModel);

  const check = useFormErrors({
    code: !form.code.trim() && t('formErrors.required'),
    name: !form.name.trim() && t('formErrors.required'),
    // Thuê bao/SSL/tên miền mà không có hạn thì rơi khỏi mọi lời nhắc — API cũng từ chối.
    endDate: endRequired && !form.endDate && t('software.endRequired'),
    seatTotal:
      seats.reason === 'invalid'
        ? t('software.seatInvalid')
        : seats.reason === 'belowUsed'
          ? t('software.seatBelowUsed', { used: row?.seatUsed ?? 0, total: seats.value })
          : null,
  });

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!busy}
      guardUnsaved
      maxWidth={760}
      title={row ? `${t('software.edit')} — ${row.code}` : t('software.add')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="software-form" className="btn primary" disabled={busy}>
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="software-form"
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          save.mutate(
            {
              code: form.code.trim(),
              name: form.name.trim(),
              kind: form.kind,
              licenseModel: form.licenseModel,
              vendorId: form.vendorId,
              seatTotal: seats.value,
              startDate: form.startDate,
              endDate: form.endDate,
              note: form.note.trim(),
              status: form.status,
            },
            {
              onSuccess: (created) => {
                void (async () => {
                  toast({ message: t('software.saved') });
                  // Giấy tờ đi SAU khi hồ sơ đã có id — file không thể treo vào cái chưa tồn tại.
                  if (draft.files.length > 0) {
                    setUploading(true);
                    const count = draft.files.length;
                    const failures = await draft.upload(
                      'software',
                      row?.id ?? created.id,
                      csrfToken,
                    );
                    setUploading(false);
                    if (failures.length < count) {
                      toast({ message: t('attachments.draftUploaded', { count: count - failures.length }) });
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
        {check.summary}
        <FormSection title={t('software.tabProfile')} columns={3}>
          {/* Loại đứng ĐẦU: nó quyết định form có Kỳ hạn, Số ghế, Hết hạn hay không — chọn sau
              khi đã gõ mã và tên thì form nhảy bố cục ngay dưới tay người gõ. */}
          <Field label={t('software.kind')} required span={3}>
            <div className="segmented" role="radiogroup" aria-label={t('software.kind')}>
              {SOFTWARE_KINDS.map((kind) => (
                <label key={kind}>
                  <input
                    type="radio"
                    name="sw-kind"
                    value={kind}
                    checked={form.kind === kind}
                    onChange={() => set('kind', kind)}
                  />
                  {t(KIND_KEY[kind])}
                </label>
              ))}
            </div>
          </Field>
          <Field label={t('software.code')} required htmlFor="sw-code" error={check.error('code')}>
            <input
              id="sw-code"
              className="inp mono"
              required
              placeholder={codePrefix(form.kind) ? `${codePrefix(form.kind)}…` : undefined}
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
          <Field
            label={t('software.name')}
            required
            htmlFor="sw-name"
            span={2}
            error={check.error('name')}
          >
            <input
              id="sw-name"
              className="inp"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label={t('software.vendor')}>
            <Select
              value={form.vendorId}
              ariaLabel={t('software.vendor')}
              placeholder={`— ${t('software.noVendor')} —`}
              failed={lists.isError}
              options={activeOptions(lists.data?.vendors, row?.vendorId, (vendor) => vendor.name)}
              onChange={(value) => set('vendorId', value)}
            />
          </Field>
          {/*
            Ô Trạng thái CHỈ hiện khi SỬA.

            Thêm mới thì trạng thái luôn là "đang dùng" — bày một ô chọn có đúng một câu trả
            lời hợp lý là bắt người khai đọc và bỏ qua một thứ không có quyết định nào ở đó,
            và mở đường cho một hồ sơ vừa tạo đã ở trạng thái "đã thanh lý".
          */}
          {row ? (
            <Field label={t('software.status')}>
              <Select
                value={form.status}
                ariaLabel={t('software.status')}
                // "Hết hạn" do hệ thống tự đặt theo ngày hết hạn (DOM-03) — người chỉ chọn giữa
                // Đang dùng và Thanh lý. Hồ sơ đang Hết hạn vẫn hiện đúng nhãn của nó.
                options={SOFTWARE_STATUSES.filter(
                  (status) => status !== 'expired_ok' || form.status === 'expired_ok',
                ).map((status) => ({
                  value: status,
                  label: t(STATUS_KEY[status]),
                }))}
                onChange={(value) => set('status', value as SoftwareStatus)}
              />
            </Field>
          ) : null}
        </FormSection>

        <FormSection title={t('software.sectionTerm')} columns={3}>
          {/* Chỉ license mới có bản mua đứt — loại khác không hiện ô này cho đỡ rối. */}
          {hasSeats ? (
            <Field
              label={t('software.licenseModel')}
              hint={t(isPerpetual ? 'software.perpetualHint' : 'software.subscriptionHint')}
            >
              <div className="segmented" role="radiogroup" aria-label={t('software.licenseModel')}>
                {LICENSE_MODELS.map((model) => (
                  <label key={model}>
                    <input
                      type="radio"
                      name="sw-model"
                      value={model}
                      checked={form.licenseModel === model}
                      onChange={() => set('licenseModel', model)}
                    />
                    {t(model === 'perpetual' ? 'software.perpetual' : 'software.subscription')}
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
          <Field label={t('software.startDate')}>
            <DatePicker
              value={form.startDate}
              ariaLabel={t('software.startDate')}
              onChange={(value) => set('startDate', value)}
            />
          </Field>
          {/* Vĩnh viễn: ô Hết hạn thành chữ tĩnh thay vì biến mất — bố cục không nhảy. */}
          {isPerpetual ? (
            <Field label={t('software.endDate')}>
              <p className="static-value">{t('software.noEnd')}</p>
            </Field>
          ) : (
            <Field
              label={t('software.endDate')}
              required={endRequired}
              error={check.error('endDate')}
            >
              <DatePicker
                value={form.endDate}
                ariaLabel={t('software.endDate')}
                onChange={(value) => set('endDate', value)}
              />
            </Field>
          )}
        </FormSection>

        {/* Ô ghế chỉ hiện với license — loại khác thấy ô này là hiểu sai ý nghĩa cột. */}
        {hasSeats ? (
          <FormSection title={t('software.seats')} columns={3}>
            <Field
              label={t('software.seatTotal')}
              hint={t('software.seatHint')}
              htmlFor="sw-seat"
              error={check.error('seatTotal')}
            >
              {/* Ô chữ + `inputMode="numeric"`, KHÔNG `type="number"`: với ô số, trình duyệt
                  trả `value` rỗng khi gõ "10 ghế" — tức lặng lẽ thành "không giới hạn", đúng cái
                  lỗi cần chặn. Ô chữ giữ nguyên thứ người dùng gõ để `seatCheck` báo sai. */}
              <input
                id="sw-seat"
                className="inp"
                inputMode="numeric"
                value={form.seatTotal}
                onChange={(e) => set('seatTotal', e.target.value)}
              />
            </Field>
          </FormSection>
        ) : null}

        <FormSection title={t('software.note')} columns={1}>
          <Field label={t('software.note')} hint={t('software.noteHint')} htmlFor="sw-note">
            <textarea
              id="sw-note"
              className="inp"
              rows={3}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </Field>
        </FormSection>

        {/* Hợp đồng license, thư xác nhận SSL, hóa đơn tên miền — chúng nằm sẵn trên tay lúc
            gõ hồ sơ mới, và cũng là thứ hay phải thay bản mới lúc sửa. Thêm mới thì chỉ chọn
            file (đẩy lên sau khi có id); sửa thì dùng thẳng panel giấy tờ, có đủ danh sách
            đang có + tải về + xóa. */}
        {row ? (
          <FormSection title={t('attachments.title')} columns={1}>
            {/* Panel này GHI THẲNG: tải lên và xóa bay đi ngay lúc bấm, không nằm trong lượt
                lưu của form. Trong một hộp thoại CÓ nút Hủy thì điều đó không hiển nhiên —
                xóa một bản scan rồi bấm Hủy là mất luôn, nên phải nói ra. */}
            <p className="alert">{t('attachments.liveWarning')}</p>
            <AttachmentPanel
              ownerType="software"
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
