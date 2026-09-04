import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import {
  SERVICE_PROTOCOLS,
  type CabinetRow,
  type CatalogEntity,
  type CatalogLists,
  type CatalogRow,
  type ServiceProtocol,
} from '@/lib/catalog-types';

type FormState = {
  code: string;
  name: string;
  address: string;
  siteId: string;
  description: string;
  uHeight: string;
  hasPortMap: boolean;
  supplies: string;
  phone: string;
  contact: string;
  hotline: string;
  protocol: ServiceProtocol;
  portFrom: string;
  portTo: string;
};

function initialState(entity: CatalogEntity, row: CatalogRow | null): FormState {
  const any = (row ?? {}) as Partial<
    CabinetRow & {
      name: string;
      address: string | null;
      supplies: string | null;
      phone: string | null;
      contact: string | null;
      hasPortMap: boolean;
      hotline: string | null;
      protocol: ServiceProtocol;
      portFrom: number;
      portTo: number;
    }
  >;
  return {
    code: any.code ?? '',
    name: any.name ?? '',
    address: any.address ?? '',
    siteId: any.siteId ?? '',
    description: any.description ?? '',
    uHeight: any.uHeight != null ? String(any.uHeight) : '',
    hasPortMap: any.hasPortMap ?? (entity === 'device_type' ? false : false),
    supplies: any.supplies ?? '',
    phone: any.phone ?? '',
    contact: any.contact ?? '',
    hotline: any.hotline ?? '',
    protocol: any.protocol ?? 'tcp',
    portFrom: any.portFrom != null ? String(any.portFrom) : '',
    // Một port thì ô "đến" để TRỐNG, không lặp lại con số: nhìn "443 → 443" người ta phải
    // dừng lại kiểm xem có phải mình gõ nhầm không.
    portTo:
      any.portTo != null && any.portTo !== any.portFrom ? String(any.portTo) : '',
  };
}

/**
 * Form thêm/sửa một mục danh mục (story 2.1). Một form cho cả bốn loại: các loại chỉ khác
 * nhau vài trường, tách thành bốn file thì mỗi lần đổi luật lại phải sửa bốn chỗ (AD-15).
 */
export function CatalogForm({
  entity,
  row,
  lists,
  csrfToken,
  onClose,
  onSaved,
}: {
  entity: CatalogEntity;
  /** null = thêm mới. */
  row: CatalogRow | null;
  lists: CatalogLists | undefined;
  csrfToken: string;
  onClose: () => void;
  /**
   * Nhận luôn BẢN GHI vừa lưu.
   *
   * Màn Danh mục không cần tới nó (chỉ tải lại bảng), nhưng hộp "Thêm rule" của sổ NAT thì
   * có: khai xong một dịch vụ mới phải áp được ngay vào ô port đang dở. Không có tham số này
   * thì nơi gọi phải đi tải lại cả danh mục rồi mò tìm theo tên — dò bằng tên là chỗ sinh lỗi.
   */
  onSaved: (saved: CatalogRow) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => initialState(entity, row));
  const [error, setError] = useState<string | null>(null);

  const save = useApiMutation<Record<string, unknown>, CatalogRow>(
    row ? `/api/v1/catalog/${entity}/${row.id}` : `/api/v1/catalog/${entity}`,
    { method: row ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = () => {
    setError(null);
    const body = buildBody(entity, form);
    if (typeof body === 'string') {
      setError(body);
      return;
    }
    save.mutate(body, {
      onSuccess: (saved) => {
        toast({ message: t('catalog.saved') });
        onSaved(saved);
      },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={560}
      title={row ? t('catalog.edit') : t(ADD_KEY[entity])}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="catalog-form" className="btn primary" disabled={save.isPending}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="catalog-form"
        className="form-grid"
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {entity === 'site' || entity === 'cabinet' ? (
          <Field label={t('catalog.code')} required htmlFor="catalog-code">
            <input
              id="catalog-code"
              className="inp"
              required
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
        ) : null}

        {entity === 'site' ||
        entity === 'device_type' ||
        entity === 'vendor' ||
        entity === 'department' ||
        entity === 'isp_provider' ||
        entity === 'service_port' ? (
          <Field label={t('catalog.name')} required htmlFor="catalog-name">
            <input
              id="catalog-name"
              className="inp"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
        ) : null}

        {entity === 'site' ? (
          <Field label={t('catalog.address')} htmlFor="catalog-address">
            <input
              id="catalog-address"
              className="inp"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
            />
          </Field>
        ) : null}

        {entity === 'cabinet' ? (
          <>
            <Field label={t('catalog.site')} required>
              <Select
                value={form.siteId}
                ariaLabel={t('catalog.site')}
                placeholder="— Chọn site —"
                options={(lists?.sites ?? []).map((site) => ({
                  value: site.id,
                  label: `${site.code} — ${site.name}`,
                }))}
                onChange={(value) => set('siteId', value)}
              />
            </Field>
            <Field label={t('catalog.description')} htmlFor="catalog-description">
              <input
                id="catalog-description"
                className="inp"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>
            <Field label={t('catalog.uHeight')} htmlFor="catalog-uheight">
              <input
                id="catalog-uheight"
                className="inp"
                inputMode="numeric"
                value={form.uHeight}
                onChange={(e) => set('uHeight', e.target.value)}
              />
            </Field>
          </>
        ) : null}

        {entity === 'device_type' ? (
          <>
            <Field label={t('catalog.hasPortMap')} htmlFor="catalog-portmap">
              <label className="row" style={{ gap: 'var(--space-3)' }}>
                <input
                  id="catalog-portmap"
                  type="checkbox"
                  checked={form.hasPortMap}
                  onChange={(e) => set('hasPortMap', e.target.checked)}
                />
                <span className="muted">{t('catalog.hasPortMapHint')}</span>
              </label>
            </Field>
            <Field label={t('catalog.description')} htmlFor="catalog-description">
              <input
                id="catalog-description"
                className="inp"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>
          </>
        ) : null}

        {entity === 'vendor' ? (
          <>
            <Field label={t('catalog.supplies')} htmlFor="catalog-supplies">
              <input
                id="catalog-supplies"
                className="inp"
                value={form.supplies}
                onChange={(e) => set('supplies', e.target.value)}
              />
            </Field>
            <Field label={t('catalog.phone')} htmlFor="catalog-phone">
              <input
                id="catalog-phone"
                className="inp"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            </Field>
            <Field label={t('catalog.contact')} htmlFor="catalog-contact">
              <input
                id="catalog-contact"
                className="inp"
                value={form.contact}
                onChange={(e) => set('contact', e.target.value)}
              />
            </Field>
          </>
        ) : null}

        {entity === 'department' ? (
          <Field
            label={t('catalog.description')}
            hint={t('catalog.departmentHint')}
            htmlFor="catalog-description"
          >
            <input
              id="catalog-description"
              className="inp"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
        ) : null}

        {entity === 'isp_provider' ? (
          <>
            <Field
              label={t('catalog.hotline')}
              hint={t('catalog.hotlineHint')}
              htmlFor="catalog-hotline"
            >
              <input
                id="catalog-hotline"
                className="inp mono"
                value={form.hotline}
                onChange={(e) => set('hotline', e.target.value)}
              />
            </Field>
            <Field label={t('catalog.contact')} htmlFor="catalog-contact">
              <input
                id="catalog-contact"
                className="inp"
                value={form.contact}
                onChange={(e) => set('contact', e.target.value)}
              />
            </Field>
          </>
        ) : null}

        {entity === 'service_port' ? (
          <>
            <Field label={t('catalog.protocol')}>
              <Select
                value={form.protocol}
                ariaLabel={t('catalog.protocol')}
                options={SERVICE_PROTOCOLS.map((item) => ({
                  value: item,
                  label: item === 'both' ? t('catalog.protocolBoth') : item.toUpperCase(),
                }))}
                onChange={(value) => set('protocol', value as ServiceProtocol)}
              />
            </Field>
            <Field
              label={t('catalog.portFrom')}
              required
              hint={t('catalog.portHint')}
              htmlFor="catalog-port-from"
            >
              <input
                id="catalog-port-from"
                className="inp mono"
                required
                inputMode="numeric"
                value={form.portFrom}
                onChange={(e) => set('portFrom', e.target.value)}
              />
            </Field>
            <Field label={t('catalog.portTo')} htmlFor="catalog-port-to">
              <input
                id="catalog-port-to"
                className="inp mono"
                inputMode="numeric"
                placeholder={t('catalog.portToPlaceholder')}
                value={form.portTo}
                onChange={(e) => set('portTo', e.target.value)}
              />
            </Field>
            <Field label={t('catalog.description')} htmlFor="catalog-description">
              <input
                id="catalog-description"
                className="inp"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>
          </>
        ) : null}

        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

const ADD_KEY: Record<CatalogEntity, string> = {
  site: 'catalog.addSite',
  cabinet: 'catalog.addCabinet',
  device_type: 'catalog.addDeviceType',
  vendor: 'catalog.addVendor',
  department: 'catalog.addDepartment',
  isp_provider: 'catalog.addIspProvider',
  service_port: 'catalog.addServicePort',
};

/**
 * Gom body gửi lên API. Trả về CHUỖI = thông báo lỗi hiện tại chỗ (không gọi API).
 * Chỉ gửi đúng trường của loại đang sửa: API bật `forbidNonWhitelisted`, thừa field là 400
 * (bài học story 1.4 — nút Khóa/Mở khóa từng luôn 400 vì lọt `id` vào body).
 */
function buildBody(entity: CatalogEntity, form: FormState): Record<string, unknown> | string {
  switch (entity) {
    case 'site':
      return { code: form.code.trim(), name: form.name.trim(), address: form.address.trim() };
    case 'cabinet': {
      if (!form.siteId) return 'Chọn site cho tủ này.';
      const body: Record<string, unknown> = {
        code: form.code.trim(),
        siteId: form.siteId,
        description: form.description.trim(),
      };
      const raw = form.uHeight.trim();
      if (raw === '') {
        // Gửi null (không phải bỏ trống field): người dùng xóa ô là muốn XÓA giá trị cũ.
        // `@IsOptional()` của class-validator bỏ qua null nên DTO vẫn hợp lệ.
        body.uHeight = null;
      } else {
        const value = Number(raw);
        if (!Number.isInteger(value) || value < 1 || value > 60) {
          return 'Số U phải là số nguyên từ 1 đến 60.';
        }
        body.uHeight = value;
      }
      return body;
    }
    case 'device_type':
      return {
        name: form.name.trim(),
        hasPortMap: form.hasPortMap,
        description: form.description.trim(),
      };
    case 'vendor':
      return {
        name: form.name.trim(),
        supplies: form.supplies.trim(),
        phone: form.phone.trim(),
        contact: form.contact.trim(),
      };
    case 'department':
      return { name: form.name.trim(), description: form.description.trim() };
    case 'isp_provider':
      return {
        name: form.name.trim(),
        hotline: form.hotline.trim(),
        contact: form.contact.trim(),
      };
    case 'service_port': {
      const from = Number(form.portFrom.trim());
      if (!isPort(from)) return 'Port phải là số nguyên từ 1 đến 65535.';
      // Bỏ trống ô "đến" = một port duy nhất, không phải dải hở đầu kia.
      const rawTo = form.portTo.trim();
      const to = rawTo === '' ? from : Number(rawTo);
      if (!isPort(to)) return 'Port phải là số nguyên từ 1 đến 65535.';
      if (to < from) return 'Dải port viết ngược — số đầu phải nhỏ hơn số cuối (vd 50000-52000).';
      return {
        name: form.name.trim(),
        protocol: form.protocol,
        portFrom: from,
        portTo: to,
        description: form.description.trim(),
      };
    }
  }
}

function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}
