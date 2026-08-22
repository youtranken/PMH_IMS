import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { DatePicker } from '@/ui/date-picker';
import { Dialog, DialogTitle } from '@/ui/dialog';
import { Field, FormSection } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import type { CatalogLists } from '@/features/catalog/catalog-types';
import {
  DEVICE_STATUSES,
  STATUS_KEY,
  type DeviceRow,
  type DeviceStatus,
  type DeviceWriteResult,
} from './device-types';

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
  lists,
  csrfToken,
  onClose,
  onSaved,
}: {
  /** null = thêm mới. */
  device: DeviceRow | null;
  lists: CatalogLists | undefined;
  csrfToken: string;
  onClose: () => void;
  onSaved: (result: DeviceWriteResult) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => initialState(device));
  const [error, setError] = useState<string | null>(null);

  const save = useApiMutation<Record<string, unknown>, DeviceWriteResult>(
    device ? `/api/v1/devices/${device.id}` : '/api/v1/devices',
    { method: device ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

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
  const cabinets = (lists?.cabinets ?? []).filter(
    (cabinet) => !form.siteId || cabinet.siteId === form.siteId,
  );

  const submit = () => {
    setError(null);
    if (!form.code.trim() || !form.name.trim() || !form.deviceTypeId) {
      setError('Cần ít nhất: mã thiết bị, tên và loại thiết bị.');
      return;
    }
    save.mutate(buildBody(form), {
      onSuccess: (result) => {
        toast({ message: t('devices.saved') });
        // Cảnh báo (serial trùng) hiện RIÊNG và ở lại lâu hơn — lưu vẫn thành công.
        for (const warning of result.warnings) toast({ message: warning, tone: 'warn' });
        onSaved(result);
      },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <Dialog open onOpenChange={onClose} maxWidth={860}>
      <DialogTitle>{device ? `${t('devices.edit')} — ${device.code}` : t('devices.add')}</DialogTitle>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
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
              value={form.deviceTypeId}
              ariaLabel={t('devices.type')}
              placeholder="— Chọn loại —"
              options={(lists?.deviceTypes ?? []).map((type) => ({
                value: type.id,
                label: type.name,
              }))}
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
        </FormSection>

        <FormSection title={t('devices.location')} columns={3}>
          <Field label={t('devices.site')}>
            <Select
              value={form.siteId}
              ariaLabel={t('devices.site')}
              placeholder="— Chưa gán site —"
              options={(lists?.sites ?? []).map((site) => ({
                value: site.id,
                label: `${site.code} — ${site.name}`,
              }))}
              onChange={(value) => set('siteId', value)}
            />
          </Field>
          <Field label={t('devices.cabinet')} hint={t('devices.noCabinet')}>
            <Select
              value={form.cabinetId}
              ariaLabel={t('devices.cabinet')}
              placeholder="— Không nằm trong tủ —"
              options={cabinets.map((cabinet) => ({
                value: cabinet.id,
                label: `${cabinet.siteCode} · ${cabinet.code}`,
              }))}
              onChange={(value) => set('cabinetId', value)}
            />
          </Field>
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

          <Field label={t('devices.assignedTo')} htmlFor="device-assigned">
            <input
              id="device-assigned"
              className="inp"
              value={form.assignedTo}
              onChange={(e) => set('assignedTo', e.target.value)}
            />
          </Field>
          <Field label={t('devices.department')} htmlFor="device-department">
            <input
              id="device-department"
              className="inp"
              value={form.department}
              onChange={(e) => set('department', e.target.value)}
            />
          </Field>
          <Field label={t('devices.vendor')}>
            <Select
              value={form.vendorId}
              ariaLabel={t('devices.vendor')}
              placeholder="— Chưa rõ NCC —"
              options={(lists?.vendors ?? []).map((vendor) => ({
                value: vendor.id,
                label: vendor.name,
              }))}
              onChange={(value) => set('vendorId', value)}
            />
          </Field>
        </FormSection>

        <FormSection title={t('devices.warranty')} columns={3}>
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
