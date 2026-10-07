import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '@/lib/api';
import { ApiError, apiFetch } from '@/lib/api-client';
import { DEVICE_MODELS_KEY, type DeviceModel } from '@/lib/device-models';
import { expandPortTemplate, PORT_KINDS, PORT_PRESETS, type PortKind, type PortTemplateGroup } from '@/lib/port-template';
import { uploadFile } from '@/lib/upload';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { FilePicker } from '@/ui/file-picker';
import { ImageCropDialog } from '@/ui/image-crop-dialog';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';

/** Ảnh cho sơ đồ: JPG/PNG — bộ vẽ ảnh của server không giải mã WebP. */
const PHOTO_ACCEPT = '.jpg,.jpeg,.png';

const KIND_LABEL: Record<PortKind, string> = {
  rj45: 'deviceModels.kindRj45',
  sfp: 'deviceModels.kindSfp',
  'sfp+': 'deviceModels.kindSfpPlus',
  console: 'deviceModels.kindConsole',
  other: 'deviceModels.kindOther',
};

interface Duplicate {
  id: string;
  model: string;
}

/**
 * Hộp tạo / sửa một model thiết bị (Q-26). Dùng ở Danh mục Model và NGAY TRONG form thiết bị
 * ("+ Tạo model mới"), nên không bao giờ điều hướng đi đâu: xong thì trả model qua `onSaved`.
 *
 * Trùng khoá chuẩn hoá (409 `DEVICE_MODEL_DUPLICATE`) báo tại ô Mã model và mời dùng model sẵn có —
 * không có đường tạo bản thứ hai. Ảnh mặt trước chỉ có khi SỬA một model đã có và người dùng là
 * Admin/SA: ảnh model đổi hình của cả loạt máy (Q-23).
 */
export function DeviceModelDialog({
  csrfToken,
  canManage = false,
  model = null,
  initial,
  onClose,
  onSaved,
}: {
  csrfToken: string;
  /** SA/Admin: được đổi ảnh model (ảnh đổi hình của cả loạt máy). */
  canManage?: boolean;
  /** Model đang sửa; vắng = tạo mới. */
  model?: DeviceModel | null;
  /** Giá trị điền sẵn khi tạo mới (form thiết bị đưa chữ đang gõ và loại đang chọn). */
  initial?: { model?: string; deviceTypeId?: string | null };
  onClose: () => void;
  onSaved: (saved: DeviceModel) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const lists = useCatalogLists();
  const editing = Boolean(model);
  const modelId = model?.id ?? '';
  const modelName = model?.model ?? '';
  const [form, setForm] = useState({
    deviceTypeId: model?.deviceTypeId ?? initial?.deviceTypeId ?? '',
    model: model?.model ?? initial?.model ?? '',
    manufacturer: model?.manufacturer ?? '',
    rackMountable: model ? model.rackMountable : null as boolean | null,
    uSize: model?.uSize ? String(model.uSize) : '',
    portTemplate: (model?.portTemplate ?? []) as PortTemplateGroup[],
  });
  // Xem trước không biết trần `device.port_template_max` — trần do server chặn và báo.
  const preview = expandPortTemplate(form.portTemplate, Number.MAX_SAFE_INTEGER);
  const setGroup = (index: number, patch: Partial<PortTemplateGroup>) =>
    setForm({ ...form, portTemplate: form.portTemplate.map((g, i) => (i === index ? { ...g, ...patch } : g)) });
  const [errors, setErrors] = useState<Partial<Record<'deviceTypeId' | 'model' | 'rack' | 'uSize' | 'ports', string>>>({});
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null);
  const [busy, setBusy] = useState(false);
  const [cropping, setCropping] = useState<File | null>(null);
  const [photoVersion, setPhotoVersion] = useState(model?.updatedAt ?? '');
  const [photoId, setPhotoId] = useState(model?.photoFrontFileId ?? null);

  const finish = async (saved: DeviceModel, message: string | null) => {
    await queryClient.invalidateQueries({ queryKey: DEVICE_MODELS_KEY });
    if (message) toast({ tone: 'ok', message });
    onSaved(saved);
    onClose();
  };

  const pickExisting = async (existing: Duplicate) => {
    setBusy(true);
    try {
      await finish(await apiFetch<DeviceModel>(`/api/v1/device-models/${existing.id}`), null);
    } catch (error) {
      toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const next: typeof errors = {};
    if (!form.deviceTypeId) next.deviceTypeId = t('deviceModels.typeRequired');
    if (!form.model.trim()) next.model = t('deviceModels.modelRequired');
    if (form.rackMountable === null) next.rack = t('deviceModels.rackRequired');
    const units = Number(form.uSize);
    if (form.rackMountable && (!Number.isInteger(units) || units < 1 || units > 60)) next.uSize = t('deviceModels.uSizeInvalid');
    if (preview.error) next.ports = t(`deviceModels.portErr_${preview.error.key}`, { value: preview.error.value });
    setErrors(next);
    setDuplicate(null);
    if (Object.keys(next).length > 0) return;
    const body = {
      deviceTypeId: form.deviceTypeId,
      model: form.model.trim(),
      manufacturer: form.manufacturer.trim() || null,
      rackMountable: Boolean(form.rackMountable),
      uSize: form.rackMountable ? units : null,
      portTemplate: form.portTemplate.filter((g) => g.pattern.trim()).map((g) => ({ pattern: g.pattern.trim(), kind: g.kind })),
    };
    setBusy(true);
    try {
      const saved = await apiFetch<DeviceModel>(editing ? `/api/v1/device-models/${modelId}` : '/api/v1/device-models', {
        method: editing ? 'PATCH' : 'POST',
        csrfToken,
        body: JSON.stringify(body),
      });
      await finish(saved, t(editing ? 'deviceModels.updated' : 'deviceModels.created', { model: saved.model }));
    } catch (error) {
      const failure = error instanceof ApiError ? (error.body as { code?: string; existing?: Duplicate } | null) : null;
      if (failure?.code === 'DEVICE_MODEL_DUPLICATE' && failure.existing) {
        setDuplicate(failure.existing);
        setErrors({ model: errorMessage(error) });
      } else {
        toast({ tone: 'error', message: errorMessage(error) });
      }
    } finally {
      setBusy(false);
    }
  };

  const savePhoto = async (file: File) => {
    setCropping(null);
    setBusy(true);
    try {
      const uploaded = await uploadFile<{ id: string }>('/api/v1/files', file, csrfToken, { ownerType: 'device_model', ownerId: modelId });
      const saved = await apiFetch<DeviceModel>(`/api/v1/device-models/${modelId}/photos`, {
        method: 'PATCH',
        csrfToken,
        body: JSON.stringify({ front: uploaded.id }),
      });
      setPhotoId(saved.photoFrontFileId);
      setPhotoVersion(saved.updatedAt);
      await queryClient.invalidateQueries({ queryKey: DEVICE_MODELS_KEY });
      toast({ tone: 'ok', message: t('deviceModels.photoSaved', { model: saved.model }) });
    } catch (error) {
      toast({ tone: 'error', message: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const rackUnits = form.rackMountable && Number(form.uSize) > 0 ? Number(form.uSize) : null;

  return (
    <>
      <Dialog
        open
        onOpenChange={onClose}
        dismissible={!busy}
        guardUnsaved
        maxWidth={520}
        initialFocus="first-field"
        title={editing ? t('deviceModels.editTitle', { model: modelName }) : t('deviceModels.addTitle')}
        footer={
          <>
            <DialogCancel>{t('common.cancel')}</DialogCancel>
            <button type="submit" form="device-model-form" className="btn primary" disabled={busy}>
              {t('deviceModels.save')}
            </button>
          </>
        }
      >
        <form
          id="device-model-form"
          className="form-grid"
          data-columns={1}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label={t('deviceModels.type')} required error={errors.deviceTypeId}>
            <Select
              value={form.deviceTypeId}
              ariaLabel={t('deviceModels.type')}
              searchable
              failed={lists.isError}
              placeholder={t('deviceModels.typePick')}
              options={activeOptions(lists.data?.deviceTypes, model?.deviceTypeId, (type) => type.name)}
              onChange={(value) => setForm({ ...form, deviceTypeId: value })}
            />
          </Field>
          <Field label={t('deviceModels.model')} required hint={t('deviceModels.modelHint')} error={errors.model}>
            <input
              className="inp mono"
              required
              maxLength={120}
              value={form.model}
              onChange={(event) => {
                setDuplicate(null);
                setErrors({ ...errors, model: undefined });
                setForm({ ...form, model: event.target.value });
              }}
            />
          </Field>
          {duplicate ? (
            <div className="row">
              <button type="button" className="btn sm" disabled={busy} onClick={() => void pickExisting(duplicate)}>
                {t('deviceModels.useExisting', { model: duplicate.model })}
              </button>
            </div>
          ) : null}
          <Field label={t('deviceModels.manufacturer')} hint={t('deviceModels.manufacturerHint')}>
            <input className="inp" maxLength={60} value={form.manufacturer} onChange={(event) => setForm({ ...form, manufacturer: event.target.value })} />
          </Field>
          <Field label={t('deviceModels.rack')} required hint={t('deviceModels.rackHint')} error={errors.rack}>
            <div className="segmented" role="radiogroup" aria-label={t('deviceModels.rack')}>
              <label>
                <input type="radio" name="device-model-rack" checked={form.rackMountable === true} onChange={() => setForm({ ...form, rackMountable: true })} />
                {t('deviceModels.rackYes')}
              </label>
              <label>
                <input type="radio" name="device-model-rack" checked={form.rackMountable === false} onChange={() => setForm({ ...form, rackMountable: false, uSize: '' })} />
                {t('deviceModels.rackNo')}
              </label>
            </div>
          </Field>
          {form.rackMountable ? (
            <Field label={t('deviceModels.uSize')} required hint={t('deviceModels.uSizeHint')} error={errors.uSize}>
              <input
                className="inp"
                type="number"
                inputMode="numeric"
                min={1}
                max={60}
                value={form.uSize}
                onChange={(event) => setForm({ ...form, uSize: event.target.value })}
              />
            </Field>
          ) : null}
          <Field
            label={t('deviceModels.ports')}
            hint={t('deviceModels.portsHint')}
            error={errors.ports ?? (preview.error ? t(`deviceModels.portErr_${preview.error.key}`, { value: preview.error.value }) : undefined)}
          >
            <div className="row" role="group" aria-label={t('deviceModels.portPresets')}>
              <span className="muted">{t('deviceModels.portPresets')}</span>
              {PORT_PRESETS.map((preset) => (
                <button key={preset.key} type="button" className="btn sm" onClick={() => setForm({ ...form, portTemplate: preset.groups })}>
                  {t(`deviceModels.preset_${preset.key}`)}
                </button>
              ))}
            </div>
            {form.portTemplate.map((group, index) => (
              <div key={index} className="row" role="group" aria-label={t('deviceModels.portGroup', { n: index + 1 })}>
                <input
                  className="inp mono"
                  aria-label={t('deviceModels.portPattern', { n: index + 1 })}
                  placeholder="Gi1/0/[1-48]"
                  maxLength={60}
                  value={group.pattern}
                  onChange={(event) => setGroup(index, { pattern: event.target.value })}
                />
                <Select
                  value={group.kind}
                  ariaLabel={t('deviceModels.portKind', { n: index + 1 })}
                  options={PORT_KINDS.map((kind) => ({ value: kind, label: t(KIND_LABEL[kind]) }))}
                  onChange={(value) => setGroup(index, { kind: value as PortKind })}
                />
                <button type="button" className="btn sm ghost" onClick={() => setForm({ ...form, portTemplate: form.portTemplate.filter((_, i) => i !== index) })}>
                  {t('deviceModels.portRemove', { n: index + 1 })}
                </button>
              </div>
            ))}
            <div className="row">
              <button type="button" className="btn sm" onClick={() => setForm({ ...form, portTemplate: [...form.portTemplate, { pattern: '', kind: 'rj45' }] })}>
                {t('deviceModels.portAdd')}
              </button>
              <span className="muted" role="status">
                {preview.error
                  ? null
                  : preview.ports.length === 0
                    ? t('deviceModels.portNone')
                    : t('deviceModels.portPreview', {
                        count: preview.ports.length,
                        edge: preview.ports.length === 1 ? preview.ports[0].label : `${preview.ports[0].label} … ${preview.ports[preview.ports.length - 1].label}`,
                      })}
              </span>
            </div>
          </Field>
          {editing && canManage ? (
            <Field label={t('deviceModels.photo')} hint={t('deviceModels.photoHint')}>
              <FilePicker
                accept={PHOTO_ACCEPT}
                label={t(photoId ? 'deviceModels.photoReplace' : 'deviceModels.photoUpload')}
                disabled={busy}
                file={null}
                onPick={(file) => (file ? setCropping(file) : undefined)}
              >
                {photoId ? (
                  <img className="photo-slot-img" src={`/api/v1/device-models/${modelId}/photo/front?v=${encodeURIComponent(photoVersion)}`} alt={t('deviceModels.photoAlt', { model: modelName })} />
                ) : null}
              </FilePicker>
            </Field>
          ) : null}
        </form>
      </Dialog>
      {cropping ? <ImageCropDialog file={cropping} units={rackUnits} onCancel={() => setCropping(null)} onDone={(file) => void savePhoto(file)} /> : null}
    </>
  );
}
