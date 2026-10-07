import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { errorCode, errorMessage, useApiMutation } from '@/lib/api';
import { apiFetch } from '@/lib/api-client';
import { deviceModelParts, deviceModelPhotoSrc, type DeviceModel } from '@/lib/device-models';
import { freeRuns, rackClash, rackPlacement, rackUnitLabel } from '@/lib/rack-units';
import { RackElevation } from '@/ui/rack-elevation';
import { useCabinetOccupants } from '@/ui/use-cabinet-occupants';
import { useIsNarrow } from '@/ui/use-narrow';
import { DatePicker } from '@/ui/date-picker';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { SubmitButton } from '@/ui/submit-button';
import { Field, FormSection } from '@/ui/page-header';
import { NumberStepper } from '@/ui/number-stepper';
import { AttachmentDraftSection, useAttachmentDraft } from '@/ui/attachment-draft';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { DevicePhotoSlots, useDeviceTypeIconSrc } from '@/ui/device-photo-slots';
import { ME_KEY, type Me } from '@/lib/me';
import { Select } from '@/ui/select';
import { SuggestInput } from '@/ui/suggest-input';
import { useToast } from '@/ui/toast';
import { YearQuickPicks } from '@/ui/year-quick-picks';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';
import { secretTextRule, useFormErrors, useSubmitError } from '@/ui/use-form-errors';
import {
  DEVICE_STATUSES,
  STATUS_KEY,
  type DeviceRow,
  type DeviceStatus,
  type DeviceWriteResult,
} from '@/lib/device-types';
import { DevicePhotoEditor, useDevicePhotoDraft } from './device-diagram-look';
import { DeviceModelField } from './device-model-field';
import { ACCESS_KINDS, type AccessPoint } from './device-access';

interface FormState {
  code: string;
  name: string;
  deviceTypeId: string;
  model: string;
  /** Model danh mục đã chọn (Q-26); rỗng = máy "chưa có Model", chữ ở `model` lưu như cũ. */
  deviceModelId: string;
  /** Truy cập quản trị; cổng giữ dạng chữ của ô nhập, đổi số lúc gửi. */
  accessPoints: { kind: AccessPoint['kind']; address: string; port: string }[];
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
  /** Vị trí U trong tủ, dạng chữ của ô số — rỗng = chưa khai. */
  rackUStart: string;
  rackUSize: string;
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
    // Máy mới cùng lô không thể nằm đúng chỗ U của máy gốc (chồng U bị chặn — Q-23).
    rackUStart: '',
    rackUSize: '',
    // Đường truy cập trỏ IP / tên của RIÊNG máy gốc.
    accessPoints: [],
  };
}

/** Sau "Lưu và nhân bản": giữ những gì một lô máy dùng chung, bỏ những gì riêng từng máy. */
function nextState(saved: FormState): FormState {
  return { ...saved, code: '', serial: '', assignedTo: '', note: '', rackUStart: '', rackUSize: '', accessPoints: [] };
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
    deviceModelId: device?.deviceModelId ?? '',
    accessPoints: (device?.accessPoints ?? []).map((p) => ({ kind: p.kind, address: p.address, port: p.port ? String(p.port) : '' })),
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
    rackUStart: device?.rackUStart != null ? String(device.rackUStart) : '',
    rackUSize: device?.rackUSize != null ? String(device.rackUSize) : '',
  };
}

/**
 * Form hồ sơ thiết bị (FR-001). Màn NHẬP nên desktop-first — màn ĐỌC
 * (danh sách, chi tiết) mới phải đạt 390px theo UX-DR2.
 */
export function DeviceForm({
  device,
  cloneFrom,
  presetDeviceTypeId,
  csrfToken,
  onClose,
  onSaved,
  onOpenCreated,
}: {
  /** null = thêm mới. */
  device: DeviceRow | null;
  /** Thêm mới điền sẵn từ máy này (trừ mã/serial/người dùng/ghi chú). Bỏ qua khi `device` có. */
  cloneFrom?: DeviceRow | null;
  /**
   * Thêm mới từ một ô chọn đang lọc theo loại (NAT, Đường truyền — Q-20): điền sẵn ô Loại.
   * Bỏ qua khi có `device` hoặc `cloneFrom`.
   */
  presetDeviceTypeId?: string;
  csrfToken: string;
  onClose: () => void;
  /** `keepOpen`: người dùng chọn "Lưu và nhân bản" — form đã tự làm trống, đừng đóng. */
  onSaved: (result: DeviceWriteResult, options?: { keepOpen: boolean }) => void;
  /** Có thì toast "Đã thêm …" kèm nút "Mở hồ sơ" — máy mới thường nằm ở trang khác của bảng. */
  onOpenCreated?: (created: DeviceRow) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const codeRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<FormState>(() =>
    !device && cloneFrom
      ? cloneState(cloneFrom)
      : !device && presetDeviceTypeId
        ? { ...initialState(null), deviceTypeId: presetDeviceTypeId }
        : initialState(device),
  );
  const [error, setError] = useSubmitError([form]);
  // Hóa đơn, biên bản bàn giao, ảnh máy — chọn ngay lúc khai máy mới (AD-15, dùng chung với
  // form phần mềm và đường truyền). Sửa máy thì tab "Giấy tờ" ở trang chi tiết lo việc đó.
  const draft = useAttachmentDraft();
  // Ảnh hai mặt chọn lúc khai máy mới (Q-23): cùng lối "giữ ở trình duyệt, có id rồi mới đẩy".
  const photoDraft = useDevicePhotoDraft();
  const [uploading, setUploading] = useState(false);
  // Đọc `me` từ cache (shell đã nạp): chỉ để biết có hiện việc "ảnh chung của model" không — API vẫn chặn.
  const { data: me } = useQuery<Me | null>({ queryKey: ME_KEY, enabled: false });
  const canEditModel = me?.role === 'sa' || me?.role === 'admin';
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
  /*
   * Model đã chọn (Q-26): Loại và Số U đi theo model, model không gắn tủ thì máy không có Tủ / U.
   * Hồ sơ đang trỏ model thì đọc model đó một lần để biết các đặc tính này.
   */
  const [picked, setPicked] = useState<DeviceModel | null>(null);
  const linked = useQuery({
    queryKey: ['device-models', 'one', form.deviceModelId],
    queryFn: () => apiFetch<DeviceModel>(`/api/v1/device-models/${form.deviceModelId}`),
    enabled: Boolean(form.deviceModelId) && picked?.id !== form.deviceModelId,
  });
  const model = form.deviceModelId ? (picked?.id === form.deviceModelId ? picked : (linked.data ?? null)) : null;
  // Ảnh model thắng ảnh riêng (Q-26 07/10): chọn model có ảnh thì ảnh riêng đã chọn cho mặt đó bỏ đi —
  // giữ lại là một lượt tải mà server sẽ từ chối sau khi máy đã lưu.
  const modelFront = model?.photoFrontFileId ? deviceModelPhotoSrc(model.id, model.updatedAt) : null;
  useEffect(() => {
    if (modelFront && photoDraft.files.front) photoDraft.set('front', null);
  }, [modelFront, photoDraft.files.front]); // eslint-disable-line react-hooks/exhaustive-deps
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
  // Nút nào gửi lượt ghi gần nhất: dấu tích "đã lưu" chỉ hiện trên nút Lưu khi chính nó được bấm.
  const [sentByNext, setSentByNext] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => {
      // Bảo hành gần như luôn bắt đầu từ ngày mua: ô "Bảo hành từ" còn trống thì lấy theo.
      if (key === 'purchaseDate' && !current.warrantyStart) {
        return { ...current, purchaseDate: value as string, warrantyStart: value as string };
      }
      // Đổi site thì tủ đang chọn có thể thuộc site khác → bỏ chọn, đỡ lưu ra dữ liệu
      // "tủ R01 của nhà máy nằm ở văn phòng".
      if (key === 'siteId' && value !== current.siteId) {
        return { ...current, siteId: value as string, cabinetId: '', rackUStart: '', rackUSize: '' };
      }
      // Bỏ tủ thì máy không còn chỗ U nào.
      if (key === 'cabinetId' || key === 'rackUStart' || key === 'rackUSize') setRackServerError(null);
      if (key === 'cabinetId' && !value) {
        return { ...current, cabinetId: '', rackUStart: '', rackUSize: '' };
      }
      // Máy thuộc model gắn tủ: vào tủ là mang sẵn Số U của model.
      if (key === 'cabinetId' && model?.rackMountable && model.uSize) {
        return { ...current, cabinetId: value as string, rackUSize: String(model.uSize) };
      }
      return { ...current, [key]: value };
    });

  /** Chọn model: loại, chuỗi model và Số U theo model; model không gắn tủ thì bỏ Tủ / U. */
  const pickModel = (next: DeviceModel) => {
    setPicked(next);
    setRackServerError(null);
    setForm((current) => ({
      ...current,
      deviceModelId: next.id,
      model: next.model,
      deviceTypeId: next.deviceTypeId,
      ...(next.rackMountable
        ? { rackUSize: current.cabinetId ? String(next.uSize ?? '') : '' }
        : { cabinetId: '', rackUStart: '', rackUSize: '' }),
    }));
  };
  const setAccess = (index: number, patch: Partial<FormState['accessPoints'][number]>) =>
    set('accessPoints', form.accessPoints.map((point, i) => (i === index ? { ...point, ...patch } : point)));
  /** Gõ lại ô Model là bỏ model đã chọn — máy về "chưa có Model" với chữ đang gõ. */
  const typeModel = (term: string) => {
    setPicked(null);
    setForm((current) => ({ ...current, model: term, deviceModelId: '' }));
  };
  const notRackable = Boolean(model && !model.rackMountable);

  // Chỉ hiện tủ thuộc site đang chọn; chưa chọn site thì hiện hết để còn tra được.
  const cabinets = (lists.data?.cabinets ?? []).filter(
    (cabinet) => !form.siteId || cabinet.siteId === form.siteId,
  );
  const cabinet = (lists.data?.cabinets ?? []).find((c) => c.id === form.cabinetId) ?? null;
  const cabinetLabel = cabinet ? `${cabinet.siteCode} · ${cabinet.code}` : '';
  // Máy đang ở tủ đã chọn: form báo chồng U tại ô TRƯỚC khi lưu.
  const occupants = useCabinetOccupants(form.cabinetId || null);
  const placement = form.cabinetId ? rackPlacement(form.rackUStart, form.rackUSize) : null;
  // Số U đang gõ trong form — hộp cắt ảnh khoá theo đó (đổi Số U thì ô ảnh báo "chưa đúng tỉ lệ").
  const formUnits = /^\d+$/.test(form.rackUSize.trim()) ? Number(form.rackUSize.trim()) : null;
  const clash = placement
    ? rackClash({ start: Number(form.rackUStart), size: Number(form.rackUSize) }, occupants.data ?? [], device?.id ?? null)
    : null;
  const clashText = clash
    ? t('devices.rackTaken', { unit: rackUnitLabel(Number(form.rackUStart), Number(form.rackUSize)), code: clash.code })
    : null;
  const rackUsed = (occupants.data ?? [])
    .filter((o) => o.id !== device?.id)
    .sort((a, b) => a.start - b.start)
    .map((o) => `${rackUnitLabel(o.start, o.size)} (${o.code})`);
  /** Lỗi chồng U của server — gắn vào ô "U bắt đầu"; đổi tủ / U thì bỏ. */
  const [rackServerError, setRackServerError] = useState<string | null>(null);
  const [rackOpen, setRackOpen] = useState(false);
  const narrow = useIsNarrow();
  const typeName = (lists.data?.deviceTypes ?? []).find((type) => type.id === form.deviceTypeId)?.name ?? null;
  const typeIconSrc = useDeviceTypeIconSrc(device ? null : form.deviceTypeId);

  const check = useFormErrors({
    code: !form.code.trim() && t('formErrors.required'),
    name: !form.name.trim() && t('formErrors.required'),
    deviceTypeId: !form.deviceTypeId && t('formErrors.requiredPick'),
    note: secretTextRule(t, form.note),
    rackUStart: rackRule(t, form, form.rackUStart) || clashText || false,
    rackUSize: rackRule(t, form, form.rackUSize),
  });

  // Mốc tính "+n năm": bảo hành từ, không có thì ngày mua.
  const warrantyBase = form.warrantyStart || form.purchaseDate;

  const submit = (keepOpen = false) => {
    setError(null);
    if (!check.check()) return;
    const sent = form;
    setSentByNext(keepOpen);
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
          if (!device && (photoDraft.files.front || photoDraft.files.back)) {
            setUploading(true);
            const failure = await photoDraft.upload(result.device.id, csrfToken);
            setUploading(false);
            if (failure) {
              // Máy đã tạo: báo rõ ảnh CHƯA vào, kèm đường đặt lại — không để ảnh rơi mất trong im lặng.
              toast({
                tone: 'warn',
                message: t('devices.photoDraftFailed', { code: result.device.code, reason: failure }),
                action: onOpenCreated
                  ? { label: t('devices.photoRetry'), onClick: () => onOpenCreated(result.device) }
                  : undefined,
              });
            } else {
              toast({ tone: 'ok', message: t('devices.photoDraftSaved', { code: result.device.code }) });
            }
          }
          if (keepOpen) {
            setForm(nextState(sent));
            codeRef.current?.focus();
          }
          onSaved(result, { keepOpen });
        })();
      },
      onError: (err) => {
        if (errorCode(err) === 'DEVICE_RACK_U_TAKEN') setRackServerError(errorMessage(err));
        else setError(errorMessage(err));
      },
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
      maxWidth={1080}
      title={
        device
          ? `${t('devices.edit')} — ${device.code}`
          : cloneFrom
            ? t('devices.cloneOf', { code: cloneFrom.code })
            : t('devices.add')
      }
      footer={
        <>
          <DialogCancel>
            {t('common.cancel')}
          </DialogCancel>
          {/* Khai cả lô máy: lưu xong form làm trống bốn ô riêng từng máy, giữ phần còn lại.
              Nút chính vẫn là "Lưu"; E2E bấm nó phải ghi `exact: true` vì tên nút này cũng
              bắt đầu bằng "Lưu". */}
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
          <SubmitButton form="device-form" busy={busy} succeeded={save.isSuccess && !sentByNext} />
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
          <Field label={t('devices.type')} required error={check.error('deviceTypeId')} hint={model ? t('devices.typeFromModel') : undefined}>
            <Select
              required
              disabled={Boolean(model)}
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
          <Field
            label={t('devices.model')}
            htmlFor="device-model"
            hint={model ? t('devices.modelFrom', { parts: [deviceModelParts(model).head, deviceModelParts(model).size ?? t('deviceModels.rackNone')].join(' · ') }) : t('devices.modelNone')}
          >
            <DeviceModelField
              csrfToken={csrfToken}
              canManage={canEditModel}
              id="device-model"
              term={form.model}
              picked={model}
              deviceTypeId={form.deviceTypeId}
              onPick={pickModel}
              onTerm={typeModel}
            />
          </Field>
          {device ? serialField : null}
        </FormSection>

        <FormSection title={t('devices.location')} columns={4}>
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
          {notRackable ? (
            <p className="field-hint muted">{t('devices.notRackable', { model: model?.model ?? '' })}</p>
          ) : (
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
          )}
          {/* U chỉ có nghĩa khi máy nằm trong tủ (U1 ở đáy tủ). Server chặn vượt chiều cao tủ và
              chồng U với máy khác, báo tên máy đang chiếm. */}
          {form.cabinetId && !notRackable ? (
            <>
              <Field
                label={t('devices.rackUStart')}
                hint={placement ? t(placement.key, { unit: placement.unit }) : t('devices.rackUStartHint')}
                htmlFor="device-rack-u-start"
                error={check.error('rackUStart') || clashText || rackServerError}
              >
                <NumberStepper
                  id="device-rack-u-start"
                  label={t('devices.rackUStartNoun')}
                  min={1}
                  max={60}
                  value={form.rackUStart}
                  onChange={(value) => set('rackUStart', value)}
                />
              </Field>
              <Field
                label={t('devices.rackUSize')}
                htmlFor="device-rack-u-size"
                hint={model?.rackMountable ? t('devices.uSizeFromModel') : undefined}
                error={check.error('rackUSize')}
              >
                <NumberStepper
                  disabled={Boolean(model?.rackMountable)}
                  id="device-rack-u-size"
                  label={t('devices.rackUSizeNoun')}
                  min={1}
                  max={60}
                  value={form.rackUSize}
                  onChange={(value) => set('rackUSize', value)}
                />
              </Field>
              <div className="field rack-view-cell">
                <button type="button" className="btn" onClick={() => setRackOpen(true)}>
                  {t('devices.rackView')}
                </button>
              </div>
              {/* Tủ cao bao nhiêu U và U nào đã có máy (T-04): nhập U theo cảm tính thì chỉ biết chồng
                  U lúc bấm Lưu. Không tính chính máy đang sửa. */}
              {cabinet?.uHeight ? (
                <div className="row rack-free" role="group" aria-label={t('devices.rackFree')}>
                  <span className="muted">{t('devices.rackFree')}</span>
                  {freeRuns(cabinet.uHeight, occupants.data ?? [], formUnits ?? 1, device?.id ?? null).map((run) => (
                    <button key={run.start} type="button" className="btn sm" onClick={() => set('rackUStart', String(run.start))}>
                      {run.start === run.end ? `U${run.start}` : `U${run.start}–U${run.end}`}
                    </button>
                  ))}
                  {freeRuns(cabinet.uHeight, occupants.data ?? [], formUnits ?? 1, device?.id ?? null).length === 0 ? (
                    <span className="muted">{t('devices.rackFull', { size: formUnits ?? 1 })}</span>
                  ) : null}
                </div>
              ) : null}
              {cabinet ? (
                <p className="field-hint muted rack-summary">
                  {t(rackUsed.length > 0 ? 'devices.rackSummary' : 'devices.rackSummaryEmpty', {
                    name: cabinetLabel,
                    height: cabinet.uHeight ?? '?',
                    used: rackUsed.join(', '),
                  })}
                </p>
              ) : null}
            </>
          ) : null}
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

        <FormSection title={t('devices.access')} columns={1}>
          <p className="field-hint muted">{t('devices.accessHint')}</p>
          {form.accessPoints.map((point, index) => (
            <div key={index} className="row" role="group" aria-label={`${t('devices.access')} ${index + 1}`}>
              <Select
                value={point.kind}
                ariaLabel={`${t('devices.accessKind')} ${index + 1}`}
                options={ACCESS_KINDS.map((kind) => ({ value: kind, label: t(`devices.accessKind_${kind}`) }))}
                onChange={(value) => setAccess(index, { kind: value as AccessPoint['kind'] })}
              />
              <input
                className="inp mono"
                aria-label={`${t('devices.accessAddress')} ${index + 1}`}
                placeholder="10.0.1.1"
                maxLength={200}
                value={point.address}
                onChange={(e) => setAccess(index, { address: e.target.value })}
              />
              <input
                className="inp"
                aria-label={`${t('devices.accessPort')} ${index + 1}`}
                inputMode="numeric"
                placeholder={t('devices.accessPort')}
                value={point.port}
                onChange={(e) => setAccess(index, { port: e.target.value.replace(/\D/g, '') })}
              />
              <button type="button" className="btn sm ghost" onClick={() => set('accessPoints', form.accessPoints.filter((_, i) => i !== index))}>
                {t('devices.accessRemove', { n: index + 1 })}
              </button>
            </div>
          ))}
          <div>
            <button
              type="button"
              className="btn sm"
              onClick={() => set('accessPoints', [...form.accessPoints, { kind: form.accessPoints.length === 0 ? 'web' : 'ssh', address: '', port: '' }])}
            >
              {t('devices.accessAdd')}
            </button>
          </div>
        </FormSection>

        {/* Nhà cung cấp đi cùng ngày mua và hạn bảo hành — "mua của ai, khi nào, bảo hành tới
            bao giờ" là MỘT câu chuyện, nên bốn ô đứng chung một hàng; hộp 1080px đủ chỗ cho 4
            cột mà không phải cuộn dọc qua hai hàng ngày tháng. */}
        <FormSection title={t('devices.purchase')} columns={4}>
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
          <Field
            label={t('devices.note')}
            hint={t('devices.noteHint')}
            htmlFor="device-note"
            span={3}
            error={check.error('note')}
          >
            <textarea
              id="device-note"
              className="inp"
              rows={2}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </Field>
        </FormSection>

        {/* Ảnh thiết bị (không bắt buộc): SỬA ghi thẳng như trang thiết bị; THÊM MỚI giữ ảnh ở
            trình duyệt tới lúc máy có id. Cùng một ô ảnh dùng chung ở cả hai chế độ. */}
        <FormSection
          title={t('devices.photoSectionTitle')}
          titleTip={device ? t('devices.photoLiveTip') : undefined}
          columns={1}
        >
          <p className="muted small">{t('devices.photoSectionHint')}</p>
          {device ? (
            <DevicePhotoEditor
              pendingModel={model?.id !== (device.deviceModelId ?? null) ? model : undefined}
              deviceId={device.id}
              deviceTypeId={device.deviceTypeId}
              deviceTypeName={device.deviceTypeName}
              csrfToken={csrfToken}
              canEdit={device.status !== 'retired'}
              canEditModel={canEditModel}
              rackUnits={formUnits}
            />
          ) : (
            <DevicePhotoSlots
              slots={{
                front: modelFront
                  ? { src: modelFront, level: 'model' }
                  : { src: photoDraft.previews.front ?? null, level: photoDraft.files.front ? 'draft' : 'unset' },
                back: { src: photoDraft.previews.back ?? null, level: photoDraft.files.back ? 'draft' : 'unset' },
              }}
              typeName={typeName}
              typeIconSrc={typeIconSrc}
              modelLabel={model?.model ?? null}
              readOnly={busy}
              onPick={photoDraft.set}
              onRemove={(side) => photoDraft.set(side, null)}
              rackUnits={formUnits}
              loadOriginal={(side) => {
                const held = photoDraft.files[side];
                return held ? Promise.resolve(held) : Promise.reject(new Error('none'));
              }}
            />
          )}
        </FormSection>

        {/*
          THÊM MỚI: chỉ chọn file, đẩy lên sau khi có id (`AttachmentDraftSection`).
          SỬA: hồ sơ đã có id nên dùng thẳng `AttachmentPanel` — nó hiện luôn danh sách giấy
          tờ đang có, tải về được, xóa được, và thêm file mới là lên ngay. Hai chế độ dùng hai
          khối khác nhau vì chúng trả lời hai câu khác nhau, không phải vì tiện tay.
        */}
        {device ? (
          /* Panel này GHI THẲNG: tải lên và xóa bay đi ngay lúc bấm, không nằm trong lượt lưu
             của form. Trong một hộp thoại CÓ nút Hủy thì điều đó không hiển nhiên, nên nói ra —
             ở nút (i) cạnh tiêu đề, không phải một băng cảnh báo làm hộp cao thêm. */
          <FormSection
            title={t('attachments.title')}
            titleTip={t('attachments.liveTip')}
            columns={1}
          >
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

        {rackOpen && form.cabinetId ? (
          <Dialog
            open
            onOpenChange={() => setRackOpen(false)}
            maxWidth={420}
            title={t('devices.rackViewTitle', { name: cabinetLabel, height: cabinet?.uHeight ?? '?' })}
          >
            <p className="muted small">{t(narrow ? 'devices.rackViewHintReadOnly' : 'devices.rackViewHint')}</p>
            <RackElevation
              label={cabinetLabel}
              height={cabinet?.uHeight ?? null}
              occupants={occupants.data ?? []}
              selfId={device?.id ?? null}
              onPick={
                narrow
                  ? undefined
                  : (u) => {
                      set('rackUStart', String(u));
                      if (!form.rackUSize.trim()) set('rackUSize', '1');
                      setRackOpen(false);
                    }
              }
            />
          </Dialog>
        ) : null}

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
    deviceModelId: form.deviceModelId || null,
    accessPoints: form.accessPoints
      .filter((point) => point.address.trim())
      .map((point) => ({ kind: point.kind, address: point.address.trim(), port: point.port ? Number(point.port) : null })),
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
    rackUStart: form.cabinetId && form.rackUStart.trim() ? Number(form.rackUStart) : null,
    rackUSize: form.cabinetId && form.rackUSize.trim() ? Number(form.rackUSize) : null,
  };
}

/** Một ô U: số nguyên 1–60, và hai ô cùng có hoặc cùng trống (cùng luật với API). */
function rackRule(t: (key: string) => string, form: FormState, value: string): string | false {
  if (!form.cabinetId) return false;
  const start = form.rackUStart.trim();
  const size = form.rackUSize.trim();
  if (!start && !size) return false;
  if (!value.trim()) return t('devices.rackUPair');
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 60 ? false : t('devices.rackURange');
}
