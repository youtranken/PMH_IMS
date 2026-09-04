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
import type { CatalogLists } from '@/lib/catalog-types';
import {
  KIND_KEY,
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
  lists,
  csrfToken,
  onClose,
  onSaved,
}: {
  /** null = thêm mới. */
  row: SoftwareRow | null;
  lists: CatalogLists | undefined;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
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

  return (
    <Dialog
      open
      onOpenChange={onClose}
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
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!form.code.trim() || !form.name.trim()) {
            setError('Cần ít nhất mã hồ sơ và tên hồ sơ.');
            return;
          }
          save.mutate(
            {
              code: form.code.trim(),
              name: form.name.trim(),
              kind: form.kind,
              licenseModel: form.licenseModel,
              vendorId: form.vendorId,
              seatTotal: hasSeats && form.seatTotal.trim() ? Number(form.seatTotal) : null,
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
        <FormSection title={t('software.tabProfile')} columns={3}>
          <Field label={t('software.code')} required htmlFor="sw-code">
            <input
              id="sw-code"
              className="inp mono"
              required
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
          <Field label={t('software.name')} required htmlFor="sw-name" span={2}>
            <input
              id="sw-name"
              className="inp"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>

          <Field label={t('software.kind')} required>
            <Select
              value={form.kind}
              ariaLabel={t('software.kind')}
              options={SOFTWARE_KINDS.map((kind) => ({
                value: kind,
                label: t(KIND_KEY[kind]),
              }))}
              onChange={(value) => set('kind', value as SoftwareKind)}
            />
          </Field>
          {/* Chỉ license mới có bản mua đứt — loại khác không hiện ô này cho đỡ rối. */}
          {hasSeats ? (
            <Field label={t('software.licenseModel')} hint={t('software.licenseModelHint')}>
              <Select
                value={form.licenseModel}
                ariaLabel={t('software.licenseModel')}
                options={[
                  { value: 'subscription', label: t('software.subscription') },
                  { value: 'perpetual', label: t('software.perpetual') },
                ]}
                onChange={(value) => set('licenseModel', value as LicenseModel)}
              />
            </Field>
          ) : null}
          <Field label={t('software.vendor')}>
            <Select
              value={form.vendorId}
              ariaLabel={t('software.vendor')}
              placeholder={`— ${t('software.noVendor')} —`}
              options={(lists?.vendors ?? []).map((vendor) => ({
                value: vendor.id,
                label: vendor.name,
              }))}
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
                options={SOFTWARE_STATUSES.map((status) => ({
                  value: status,
                  label: t(STATUS_KEY[status]),
                }))}
                onChange={(value) => set('status', value as SoftwareStatus)}
              />
            </Field>
          ) : null}
        </FormSection>

        <FormSection title={t('software.expiry')} columns={3}>
          <Field label={t('software.startDate')}>
            <DatePicker
              value={form.startDate}
              ariaLabel={t('software.startDate')}
              onChange={(value) => set('startDate', value)}
            />
          </Field>
          {isPerpetual ? null : (
          <Field label={t('software.endDate')}>
            <DatePicker
              value={form.endDate}
              ariaLabel={t('software.endDate')}
              onChange={(value) => set('endDate', value)}
            />
          </Field>
          )}
          {/* Ô seat chỉ hiện với license — loại khác thấy ô này là hiểu sai ý nghĩa cột. */}
          {hasSeats ? (
            <Field label={t('software.seatTotal')} hint={t('software.seatHint')} htmlFor="sw-seat">
              <input
                id="sw-seat"
                className="inp"
                inputMode="numeric"
                value={form.seatTotal}
                onChange={(e) => set('seatTotal', e.target.value)}
              />
            </Field>
          ) : null}
          <Field label={t('software.note')} hint={t('software.noteHint')} htmlFor="sw-note" span={3}>
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

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
