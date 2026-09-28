import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { useToast } from '@/ui/toast';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';
import { useFormErrors } from '@/ui/use-form-errors';
import {
  catalogLabel,
  SERVICE_PROTOCOLS,
  type CabinetRow,
  type CatalogEntity,
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
  csrfToken,
  onClose,
  onSaved,
}: {
  entity: CatalogEntity;
  /** null = thêm mới. */
  row: CatalogRow | null;
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
  /*
   * Form TỰ hỏi danh mục thay vì nhận qua props: `useCatalogLists` dùng chung `queryKey` nên
   * đây không phải lượt gọi thêm, nhưng form THẤY được `isError`. Props `CatalogLists |
   * undefined` không có đường nào phân biệt "danh mục hỏng" với "chưa tải xong".
   */
  const lists = useCatalogLists();
  const [form, setForm] = useState<FormState>(() => initialState(entity, row));
  const [error, setError] = useState<string | null>(null);

  const save = useApiMutation<Record<string, unknown>, CatalogRow>(
    row ? `/api/v1/catalog/${entity}/${row.id}` : `/api/v1/catalog/${entity}`,
    { method: row ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const built = buildBody(entity, form);
  const builtError = (field: BodyField) => built.field === field && t(built.key ?? '');
  const check = useFormErrors({
    code: (entity === 'site' || entity === 'cabinet') && !form.code.trim() && t('formErrors.required'),
    name: entity !== 'cabinet' && !form.name.trim() && t('formErrors.required'),
    siteId: builtError('siteId'),
    uHeight: builtError('uHeight'),
    portFrom: builtError('portFrom'),
    portTo: builtError('portTo'),
  });

  const submit = () => {
    setError(null);
    if (!check.check() || !built.body) return;
    save.mutate(built.body, {
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
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!save.isPending}
      guardUnsaved
      maxWidth={560}
      /* Hộp này dùng chung cho CẢ BẢY tab danh mục, nên một chữ "Sửa" không nói được
         đang sửa cái gì của nhóm nào. */
      title={
        row
          ? t('common.titleOf', { action: t('catalog.edit'), subject: catalogLabel(entity, row) })
          : t(ADD_KEY[entity])
      }
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
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {check.summary}
        {entity === 'site' || entity === 'cabinet' ? (
          <Field label={t('catalog.code')} required htmlFor="catalog-code" error={check.error('code')}>
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
          <Field label={t('catalog.name')} required htmlFor="catalog-name" error={check.error('name')}>
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
            <Field label={t('catalog.site')} required error={check.error('siteId')}>
              <Select
                required
                value={form.siteId}
                ariaLabel={t('catalog.site')}
                placeholder={t('catalog.pickSite')}
                failed={lists.isError}
                options={activeOptions(
                  lists.data?.sites,
                  (row as CabinetRow | null)?.siteId,
                  (site) => `${site.code} — ${site.name}`,
                )}
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
            <Field label={t('catalog.uHeight')} htmlFor="catalog-uheight" error={check.error('uHeight')}>
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
              error={check.error('portFrom')}
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
            <Field label={t('catalog.portTo')} htmlFor="catalog-port-to" error={check.error('portTo')}>
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

type BodyField = 'siteId' | 'uHeight' | 'portFrom' | 'portTo';

/** Kết quả gom body: MỘT hình dạng (web không bật `strict`, union `ok` không thu hẹp được). */
interface Built {
  body: Record<string, unknown> | null;
  /** Ô đang sai — `useFormErrors` hiện câu lỗi ngay dưới đúng ô đó. */
  field: BodyField | null;
  /** KHÓA i18n của câu lỗi — hàm này không có `t`, câu tiếng Việt chỉ sống ở `vi.ts`. */
  key: string | null;
}

const ok = (body: Record<string, unknown>): Built => ({ body, field: null, key: null });
const bad = (field: BodyField, key: string): Built => ({ body: null, field, key });

/**
 * Gom body gửi lên API, hoặc chỉ ra ô sai (không gọi API).
 * Chỉ gửi đúng trường của loại đang sửa: API bật `forbidNonWhitelisted`, thừa field là 400
 * (bài học story 1.4 — nút Khóa/Mở khóa từng luôn 400 vì lọt `id` vào body).
 */
function buildBody(entity: CatalogEntity, form: FormState): Built {
  switch (entity) {
    case 'site':
      return ok({ code: form.code.trim(), name: form.name.trim(), address: form.address.trim() });
    case 'cabinet': {
      if (!form.siteId) return bad('siteId', 'catalog.cabinetSiteRequired');
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
          return bad('uHeight', 'catalog.uHeightInvalid');
        }
        body.uHeight = value;
      }
      return ok(body);
    }
    case 'device_type':
      return ok({
        name: form.name.trim(),
        hasPortMap: form.hasPortMap,
        description: form.description.trim(),
      });
    case 'vendor':
      return ok({
        name: form.name.trim(),
        supplies: form.supplies.trim(),
        phone: form.phone.trim(),
        contact: form.contact.trim(),
      });
    case 'department':
      return ok({ name: form.name.trim(), description: form.description.trim() });
    case 'isp_provider':
      return ok({
        name: form.name.trim(),
        hotline: form.hotline.trim(),
        contact: form.contact.trim(),
      });
    case 'service_port': {
      // Ô trống là thiếu, không phải port 0: `Number('')` ra 0 và câu "port không hợp lệ"
      // cho một ô chưa gõ gì là câu sai.
      if (form.portFrom.trim() === '') return bad('portFrom', 'formErrors.required');
      const from = Number(form.portFrom.trim());
      if (!isPort(from)) return bad('portFrom', 'catalog.portInvalid');
      // Bỏ trống ô "đến" = một port duy nhất, không phải dải hở đầu kia.
      const rawTo = form.portTo.trim();
      const to = rawTo === '' ? from : Number(rawTo);
      if (!isPort(to)) return bad('portTo', 'catalog.portInvalid');
      if (to < from) return bad('portTo', 'catalog.portRangeReversed');
      return ok({
        name: form.name.trim(),
        protocol: form.protocol,
        portFrom: from,
        portTo: to,
        description: form.description.trim(),
      });
    }
  }
}

function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}
