import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { Field, FormSection } from '@/ui/page-header';
import { AttachmentDraftSection, useAttachmentDraft } from '@/ui/attachment-draft';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { Select } from '@/ui/select';
import { SuggestInput } from '@/ui/suggest-input';
import { useToast } from '@/ui/toast';
import { useCatalogLists } from '@/ui/use-catalog-lists';
import {
  DEVICE_STATUSES,
  STATUS_KEY,
  type DeviceRow,
  type DeviceStatus,
  type DeviceWriteResult,
} from '@/lib/device-types';

interface FormState {
  code: string;
  name: string;
  deviceTypeId: string;
  model: string;
  serial: string;
  siteId: string;
  cabinetId: string;
  vendorId: string;
  assignedTo: string;
  department: string;
  purchaseDate: string;
  warrantyStart: string;
  warrantyEnd: string;
  status: DeviceStatus;
  note: string;
}

function initialState(device: DeviceRow | null): FormState {
  return {
    code: device?.code ?? '',
    name: device?.name ?? '',
    deviceTypeId: device?.deviceTypeId ?? '',
    model: device?.model ?? '',
    serial: device?.serial ?? '',
    siteId: device?.siteId ?? '',
    cabinetId: device?.cabinetId ?? '',
    vendorId: device?.vendorId ?? '',
    assignedTo: device?.assignedTo ?? '',
    department: device?.department ?? '',
    purchaseDate: device?.purchaseDate ?? '',
    warrantyStart: device?.warrantyStart ?? '',
    warrantyEnd: device?.warrantyEnd ?? '',
    status: device?.status ?? 'in_use',
    note: device?.note ?? '',
  };
}

/**
 * Form hồ sơ thiết bị (story 2.2, FR-001). Màn NHẬP nên desktop-first — màn ĐỌC
 * (danh sách, chi tiết) mới phải đạt 390px theo UX-DR2.
 */
export function DeviceForm({
  device,
  csrfToken,
  onClose,
  onSaved,
}: {
  /** null = thêm mới. */
  device: DeviceRow | null;
  csrfToken: string;
  onClose: () => void;
  onSaved: (result: DeviceWriteResult) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => initialState(device));
  const [error, setError] = useState<string | null>(null);
  // Hóa đơn, biên bản bàn giao, ảnh máy — chọn ngay lúc khai máy mới (AD-15, dùng chung với
  // form phần mềm và đường truyền). Sửa máy thì tab "Giấy tờ" ở trang chi tiết lo việc đó.
  const draft = useAttachmentDraft();
  const [uploading, setUploading] = useState(false);
  /*
   * Form TỰ hỏi danh mục thay vì nhận qua props.
   *
   * `useCatalogLists` dùng chung `queryKey` nên đây không phải một lượt gọi thêm — react-query
   * trả từ cache của màn cha. Đổi lại, form thấy được `isError`: props `CatalogLists | undefined`
   * KHÔNG có đường nào phân biệt "danh mục hỏng" với "chưa tải xong", nên mọi ô chọn bắt buộc
   * ở đây từng nói "— Không có lựa chọn —" khi API hỏng và đẩy người dùng đi khai lại một loại
   * thiết bị đã có sẵn.
   */
  const lists = useCatalogLists();
  const departments = (lists.data?.departments ?? [])
    .filter((department) => department.active)
    .map((department) => department.name);

  const save = useApiMutation<Record<string, unknown>, DeviceWriteResult>(
    device ? `/api/v1/devices/${device.id}` : '/api/v1/devices',
    { method: device ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );
  // Đẩy giấy tờ chạy SAU khi lưu xong, lúc `isPending` đã tắt — không khoá thêm thì nút Lưu
  // mở lại và bấm thêm phát nữa là khai trùng một cái máy.
  const busy = save.isPending || uploading;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => {
      // Đổi site thì tủ đang chọn có thể thuộc site khác → bỏ chọn, đỡ lưu ra dữ liệu
      // "tủ R01 của nhà máy nằm ở văn phòng".
      if (key === 'siteId' && value !== current.siteId) {
        return { ...current, siteId: value as string, cabinetId: '' };
      }
      return { ...current, [key]: value };
    });

  // Chỉ hiện tủ thuộc site đang chọn; chưa chọn site thì hiện hết để còn tra được.
  const cabinets = (lists.data?.cabinets ?? []).filter(
    (cabinet) => !form.siteId || cabinet.siteId === form.siteId,
  );

  const submit = () => {
    setError(null);
    if (!form.code.trim() || !form.name.trim() || !form.deviceTypeId) {
      setError(t('devices.needMinimum'));
      return;
    }
    save.mutate(buildBody(form), {
      onSuccess: (result) => {
        void (async () => {
          toast({ message: t('devices.saved') });
          // Cảnh báo (serial trùng) hiện RIÊNG và ở lại lâu hơn — lưu vẫn thành công.
          for (const warning of result.warnings) toast({ message: warning, tone: 'warn' });
          // Giấy tờ đi SAU khi máy đã có id — file không thể treo vào cái chưa tồn tại.
          if (draft.files.length > 0) {
            setUploading(true);
            const count = draft.files.length;
            const failures = await draft.upload('device', result.device.id, csrfToken);
            setUploading(false);
            if (failures.length < count) {
              toast({
                message: t('attachments.draftUploaded', { count: count - failures.length }),
              });
            }
            for (const message of failures) toast({ message, tone: 'warn' });
          }
          onSaved(result);
        })();
      },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!busy}
      guardUnsaved
      maxWidth={860}
      title={device ? `${t('devices.edit')} — ${device.code}` : t('devices.add')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="device-form" className="btn primary" disabled={busy}>
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="device-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
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
        <FormSection title={t('devices.tabProfile')} columns={3}>
          <Field label={t('devices.code')} required htmlFor="device-code">
            <input
              id="device-code"
              className="inp mono"
              required
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
          <Field label={t('devices.name')} required htmlFor="device-name" span={2}>
            <input
              id="device-name"
              className="inp"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>

          <Field label={t('devices.type')} required>
            <Select
              required
              value={form.deviceTypeId}
              ariaLabel={t('devices.type')}
              placeholder={t('devices.pickType')}
              options={(lists.data?.deviceTypes ?? []).map((type) => ({
                value: type.id,
                label: type.name,
              }))}
              failed={lists.isError}
              onChange={(value) => set('deviceTypeId', value)}
            />
          </Field>
          <Field label={t('devices.model')} htmlFor="device-model">
            <input
              id="device-model"
              className="inp"
              value={form.model}
              onChange={(e) => set('model', e.target.value)}
            />
          </Field>
          <Field label={t('devices.serial')} htmlFor="device-serial">
            <input
              id="device-serial"
              className="inp mono"
              value={form.serial}
              onChange={(e) => set('serial', e.target.value)}
            />
          </Field>
          {/*
            Ô Trạng thái CHỈ hiện khi SỬA.

            Thêm mới thì trạng thái luôn là "đang dùng" — bày một ô chọn có đúng một câu trả
            lời hợp lý là bắt người khai đọc và bỏ qua một thứ không có quyết định nào ở đó,
            và mở đường cho một hồ sơ vừa tạo đã ở trạng thái "đã thanh lý".
          */}
          {/* Trạng thái là thuộc tính của chính cái máy (đang dùng / trong kho / đã thanh lý),
              không phải của chỗ nó đứng — nó từng nằm trong khối "Vị trí". */}
          {device ? (
            <Field label={t('devices.status')}>
              <Select
                value={form.status}
                ariaLabel={t('devices.status')}
                options={DEVICE_STATUSES.map((status) => ({
                  value: status,
                  label: t(STATUS_KEY[status]),
                }))}
                onChange={(value) => set('status', value as DeviceStatus)}
              />
            </Field>
          ) : null}
        </FormSection>

        <FormSection title={t('devices.location')} columns={3}>
          <Field label={t('devices.site')}>
            <Select
              value={form.siteId}
              ariaLabel={t('devices.site')}
              placeholder={t('devices.noSitePick')}
              options={(lists.data?.sites ?? []).map((site) => ({
                value: site.id,
                label: `${site.code} — ${site.name}`,
              }))}
              failed={lists.isError}
              onChange={(value) => set('siteId', value)}
            />
          </Field>
          <Field label={t('devices.cabinet')} hint={t('devices.cabinetHint')}>
            <Select
              value={form.cabinetId}
              ariaLabel={t('devices.cabinet')}
              placeholder={t('devices.noCabinet')}
              options={cabinets.map((cabinet) => ({
                value: cabinet.id,
                label: `${cabinet.siteCode} · ${cabinet.code}`,
              }))}
              failed={lists.isError}
              onChange={(value) => set('cabinetId', value)}
            />
          </Field>
          <Field label={t('devices.assignedTo')} htmlFor="device-assigned">
            <input
              id="device-assigned"
              className="inp"
              value={form.assignedTo}
              onChange={(e) => set('assignedTo', e.target.value)}
            />
          </Field>
          <Field label={t('devices.department')} hint={t('devices.departmentHint')}>
            {/* Gợi ý từ danh mục Bộ phận. Vẫn gõ tự do được: bộ phận mới lập tuần này phải
                khai được ngay, không chờ ai mở danh mục ra thêm. */}
            <SuggestInput
              value={form.department}
              onChange={(value) => set('department', value)}
              options={departments}
              failed={lists.isError}
              placeholder={t('devices.departmentPlaceholder')}
              ariaLabel={t('devices.department')}
            />
          </Field>
        </FormSection>

        {/* Nhà cung cấp đi cùng ngày mua và hạn bảo hành — "mua của ai, khi nào, bảo hành tới
            bao giờ" là MỘT câu chuyện. Trước đây nó nằm trong khối Vị trí. */}
        <FormSection title={t('devices.purchase')} columns={3}>
          <Field label={t('devices.vendor')}>
            <Select
              value={form.vendorId}
              ariaLabel={t('devices.vendor')}
              placeholder={t('devices.noVendor')}
              options={(lists.data?.vendors ?? []).map((vendor) => ({
                value: vendor.id,
                label: vendor.name,
              }))}
              failed={lists.isError}
              onChange={(value) => set('vendorId', value)}
            />
          </Field>
          <Field label={t('devices.purchaseDate')}>
            <DatePicker
              value={form.purchaseDate}
              ariaLabel={t('devices.purchaseDate')}
              onChange={(value) => set('purchaseDate', value)}
            />
          </Field>
          <Field label={t('devices.warrantyStart')}>
            <DatePicker
              value={form.warrantyStart}
              ariaLabel={t('devices.warrantyStart')}
              onChange={(value) => set('warrantyStart', value)}
            />
          </Field>
          <Field label={t('devices.warrantyEnd')}>
            <DatePicker
              value={form.warrantyEnd}
              ariaLabel={t('devices.warrantyEnd')}
              onChange={(value) => set('warrantyEnd', value)}
            />
          </Field>
          <Field label={t('devices.note')} hint={t('devices.noteHint')} htmlFor="device-note" span={3}>
            <textarea
              id="device-note"
              className="inp"
              rows={3}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </Field>
        </FormSection>

        {/*
          THÊM MỚI: chỉ chọn file, đẩy lên sau khi có id (`AttachmentDraftSection`).
          SỬA: hồ sơ đã có id nên dùng thẳng `AttachmentPanel` — nó hiện luôn danh sách giấy
          tờ đang có, tải về được, xóa được, và thêm file mới là lên ngay. Hai chế độ dùng hai
          khối khác nhau vì chúng trả lời hai câu khác nhau, không phải vì tiện tay.
        */}
        {device ? (
          <FormSection title={t('attachments.title')} columns={1}>
            {/* Panel này GHI THẲNG: tải lên và xóa bay đi ngay lúc bấm, không nằm trong lượt
                lưu của form. Trong một hộp thoại CÓ nút Hủy thì điều đó không hiển nhiên —
                xóa một bản scan rồi bấm Hủy là mất luôn, nên phải nói ra. */}
            <p className="alert">{t('attachments.liveWarning')}</p>
            <AttachmentPanel
              ownerType="device"
              ownerId={device.id}
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

/**
 * Body gửi lên API. Gửi ĐỦ mọi trường (kể cả chuỗi rỗng) vì form luôn hiện đủ ô:
 * ô để trống nghĩa là người dùng muốn xóa giá trị đó, không phải "đừng đụng tới".
 */
function buildBody(form: FormState): Record<string, unknown> {
  return {
    code: form.code.trim(),
    name: form.name.trim(),
    deviceTypeId: form.deviceTypeId,
    model: form.model.trim(),
    serial: form.serial.trim(),
    siteId: form.siteId,
    cabinetId: form.cabinetId,
    vendorId: form.vendorId,
    assignedTo: form.assignedTo.trim(),
    department: form.department.trim(),
    purchaseDate: form.purchaseDate,
    warrantyStart: form.warrantyStart,
    warrantyEnd: form.warrantyEnd,
    status: form.status,
    note: form.note.trim(),
  };
}
