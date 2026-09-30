import { useRef, useState } from 'react';
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
import { YearQuickPicks } from '@/ui/year-quick-picks';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';
import { useFormErrors } from '@/ui/use-form-errors';
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

/**
 * Nhân bản: đợt mua 20 laptop cùng model, NCC, ngày mua, bảo hành thì chỉ khác mã, serial,
 * người dùng và ghi chú — bốn ô đó để trống, còn lại lấy từ máy gốc. Trạng thái về "Đang dùng"
 * như mọi hồ sơ mới.
 */
function cloneState(source: DeviceRow): FormState {
  return {
    ...initialState(source),
    code: '',
    serial: '',
    assignedTo: '',
    note: '',
    status: 'in_use',
  };
}

/** Sau "Ghi rồi thêm máy khác": giữ những gì một lô máy dùng chung, bỏ những gì riêng từng máy. */
function nextState(saved: FormState): FormState {
  return { ...saved, code: '', serial: '', assignedTo: '', note: '' };
}

/** Các ô chọn trạng thái trong form SỬA. "Đã thanh lý" không có ở đây: API luôn từ chối đi
 *  đường này (RETIRE_VIA_UPDATE) — thanh lý có hộp riêng, cho biết sẽ gỡ những gì. */
const EDITABLE_STATUSES = DEVICE_STATUSES.filter((status) => status !== 'retired');

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
 * Form hồ sơ thiết bị (FR-001). Màn NHẬP nên desktop-first — màn ĐỌC
 * (danh sách, chi tiết) mới phải đạt 390px theo UX-DR2.
 */
export function DeviceForm({
  device,
  cloneFrom,
  csrfToken,
  onClose,
  onSaved,
  onOpenCreated,
}: {
  /** null = thêm mới. */
  device: DeviceRow | null;
  /** Thêm mới điền sẵn từ máy này (trừ mã/serial/người dùng/ghi chú). Bỏ qua khi `device` có. */
  cloneFrom?: DeviceRow | null;
  csrfToken: string;
  onClose: () => void;
  /** `keepOpen`: người dùng chọn "Ghi rồi thêm máy khác" — form đã tự làm trống, đừng đóng. */
  onSaved: (result: DeviceWriteResult, options?: { keepOpen: boolean }) => void;
  /** Có thì toast "Đã thêm …" kèm nút "Mở hồ sơ" — máy mới thường nằm ở trang khác của bảng. */
  onOpenCreated?: (created: DeviceRow) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const codeRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState>(() =>
    !device && cloneFrom ? cloneState(cloneFrom) : initialState(device),
  );
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
      // Bảo hành gần như luôn bắt đầu từ ngày mua: ô "Bảo hành từ" còn trống thì lấy theo.
      if (key === 'purchaseDate' && !current.warrantyStart) {
        return { ...current, purchaseDate: value as string, warrantyStart: value as string };
      }
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

  const check = useFormErrors({
    code: !form.code.trim() && t('formErrors.required'),
    name: !form.name.trim() && t('formErrors.required'),
    deviceTypeId: !form.deviceTypeId && t('formErrors.requiredPick'),
  });

  // Mốc tính "+n năm": bảo hành từ, không có thì ngày mua.
  const warrantyBase = form.warrantyStart || form.purchaseDate;

  const submit = (keepOpen = false) => {
    setError(null);
    if (!check.check()) return;
    const sent = form;
    save.mutate(buildBody(form), {
      onSuccess: (result) => {
        void (async () => {
          if (device) {
            toast({ message: t('devices.saved') });
          } else {
            toast({
              message: t('devices.created', { code: result.device.code }),
              action: onOpenCreated
                ? { label: t('devices.openProfile'), onClick: () => onOpenCreated(result.device) }
                : undefined,
            });
          }
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
          if (keepOpen) {
            setForm(nextState(sent));
            codeRef.current?.focus();
          }
          onSaved(result, { keepOpen });
        })();
      },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  const serialField = (
    <Field label={t('devices.serial')} htmlFor="device-serial">
      <input
        id="device-serial"
        className="inp mono"
        value={form.serial}
        onChange={(e) => set('serial', e.target.value)}
      />
    </Field>
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!busy}
      guardUnsaved
      maxWidth={860}
      title={
        device
          ? `${t('devices.edit')} — ${device.code}`
          : cloneFrom
            ? t('devices.cloneOf', { code: cloneFrom.code })
            : t('devices.add')
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          {/* Khai cả lô máy: lưu xong form làm trống bốn ô riêng từng máy, giữ phần còn lại.
              Tên nút cố ý không chứa chữ "Lưu" — nút chính vẫn là "Lưu". */}
          {device ? null : (
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => submit(true)}
            >
              {t('devices.saveAndNext')}
            </button>
          )}
          <button type="submit" form="device-form" className="btn primary" disabled={busy}>
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="device-form"
        ref={check.formRef}
        noValidate
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
        {check.summary}
        {/* Lưới 3 cột, không để ô nào đứng lẻ một hàng: [Mã | Loại | Trạng thái (sửa) hoặc
            Serial (thêm)] rồi [Tên (2 cột) | Model]. */}
        <FormSection title={t('devices.formSectionProfile')} columns={3}>
          <Field label={t('devices.code')} required htmlFor="device-code" error={check.error('code')}>
            <input
              ref={codeRef}
              id="device-code"
              className="inp mono"
              required
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
          <Field label={t('devices.type')} required error={check.error('deviceTypeId')}>
            <Select
              required
              value={form.deviceTypeId}
              ariaLabel={t('devices.type')}
              placeholder={t('devices.pickType')}
              options={activeOptions(lists.data?.deviceTypes, device?.deviceTypeId, (type) => type.name)}
              failed={lists.isError}
              onChange={(value) => set('deviceTypeId', value)}
            />
          </Field>
          {/*
            Ô Trạng thái CHỈ hiện khi SỬA: thêm mới thì luôn là "đang dùng", bày một ô có đúng
            một câu trả lời hợp lý là bắt người khai đọc rồi bỏ qua. Không có "Đã thanh lý" —
            thanh lý đi qua hộp riêng ở trang hồ sơ (API từ chối đường này).
          */}
          {device ? (
            <Field label={t('devices.status')} hint={t('devices.retireViaButton')}>
              <Select
                value={form.status}
                ariaLabel={t('devices.status')}
                options={EDITABLE_STATUSES.map((status) => ({
                  value: status,
                  label: t(STATUS_KEY[status]),
                }))}
                onChange={(value) => set('status', value as DeviceStatus)}
              />
            </Field>
          ) : (
            serialField
          )}
          <Field
            label={t('devices.name')}
            required
            htmlFor="device-name"
            span={2}
            error={check.error('name')}
          >
            <input
              id="device-name"
              className="inp"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
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
          {device ? serialField : null}
        </FormSection>

        <FormSection title={t('devices.location')} columns={2}>
          <Field label={t('devices.site')}>
            <Select
              value={form.siteId}
              ariaLabel={t('devices.site')}
              placeholder={t('devices.noSitePick')}
              options={activeOptions(
                lists.data?.sites,
                device?.siteId,
                (site) => `${site.code} — ${site.name}`,
              )}
              failed={lists.isError}
              onChange={(value) => set('siteId', value)}
            />
          </Field>
          <Field label={t('devices.cabinet')} hint={t('devices.cabinetHint')}>
            <Select
              value={form.cabinetId}
              ariaLabel={t('devices.cabinet')}
              placeholder={t('devices.noCabinet')}
              options={activeOptions(
                cabinets,
                device?.cabinetId,
                (cabinet) => `${cabinet.siteCode} · ${cabinet.code}`,
              )}
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
            bao giờ" là MỘT câu chuyện. Hai cột để "Bảo hành đến" không rơi xuống hàng lẻ. */}
        <FormSection title={t('devices.purchase')} columns={2}>
          <Field label={t('devices.vendor')}>
            <Select
              value={form.vendorId}
              ariaLabel={t('devices.vendor')}
              placeholder={t('devices.noVendor')}
              options={activeOptions(lists.data?.vendors, device?.vendorId, (vendor) => vendor.name)}
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
            <YearQuickPicks
              base={warrantyBase}
              onPick={(value) => set('warrantyEnd', value)}
              label={t('devices.warrantyQuick')}
              needBaseHint={t('devices.warrantyQuickNeedBase')}
            />
          </Field>
          <Field label={t('devices.note')} hint={t('devices.noteHint')} htmlFor="device-note" span={2}>
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
