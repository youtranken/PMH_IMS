import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '@/lib/api-client';
import { errorMessage, useApiMutation } from '@/lib/api';
import { cidrContains, cidrOverlaps, parseIpv4, previewCidr } from '@/lib/ipv4';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import type { SubnetRow } from './ipam-types';
import { useIpamSettings } from './ipam-settings';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';
import { secretTextRule, textRule, useFormErrors } from '@/ui/use-form-errors';

/**
 * Khai / sửa một dải.
 *
 * Ô Dải được kiểm NGAY KHI GÕ (dạng chuẩn, số host, mask, chồng dải khác, gateway ngoài dải):
 * đợi tới lúc bấm Lưu mới biết 10.77.1.5/24 bị quy về 10.77.1.0/24, hay biết dải vừa gõ chồng
 * lên một dải đã có, là bắt người khai đoán. API vẫn là hàng rào thật — ở đây chỉ nói sớm.
 *
 * Giấy tờ của dải KHÔNG nằm trong hộp này: panel giấy tờ ghi thẳng, đặt nó trong một form có
 * nút Hủy là mời người dùng tin rằng Hủy hoàn tác được. Nó ở đầu cột phải của màn IP.
 */
export function SubnetForm({
  subnet,
  existing,
  csrfToken,
  onClose,
  onSaved,
}: {
  subnet: SubnetRow | null;
  /** Các dải đã khai — để báo chồng dải ngay khi gõ. */
  existing: SubnetRow[];
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(subnet?.name ?? '');
  const [cidr, setCidr] = useState(subnet?.cidr ?? '');
  const [siteId, setSiteId] = useState(subnet?.siteId ?? '');
  const [vlan, setVlan] = useState(subnet?.vlan != null ? String(subnet.vlan) : '');
  const [gateway, setGateway] = useState(subnet?.gateway ?? '');
  const [description, setDescription] = useState(subnet?.description ?? '');
  const [error, setError] = useState<string | null>(null);

  const lists = useCatalogLists();

  /*
   * Dải đã có hồ sơ IP thì KHÔNG đổi CIDR được — API từ chối (`SubnetService.update`), vì mọi
   * hồ sơ bên trong sẽ thành địa chỉ ngoài dải. Nói trước bằng một ô chỉ đọc, thay vì để người
   * dùng sửa rồi ăn lỗi.
   */
  const cidrLocked = subnet !== null && subnet.addressCount > 0;

  const { subnetMinPrefix } = useIpamSettings();
  const preview = previewCidr(cidr, subnetMinPrefix);
  const typed = preview.value;
  const overlap = typed
    ? existing.find(
        (other) =>
          other.id !== subnet?.id &&
          other.voidedAt === null &&
          cidrOverlaps(other.cidr, typed.cidr),
      )
    : undefined;
  const gatewayText = gateway.trim();
  const gatewayOutside =
    preview.value !== null &&
    gatewayText !== '' &&
    parseIpv4(gatewayText) !== null &&
    !cidrContains(preview.value.cidr, gatewayText);

  // Ô VLAN để trống = XÓA số đang có, không phải "đừng đụng tới": form luôn hiện đủ ô.
  const vlanRaw = vlan.trim();
  const vlanValue = vlanRaw === '' ? null : Number(vlanRaw);
  const vlanBad =
    vlanValue !== null && (!/^\d+$/.test(vlanRaw) || vlanValue < 1 || vlanValue > 4094);
  const cidrError =
    !cidr.trim()
      ? t('formErrors.required')
      : cidrLocked
        ? false
        : preview.reason === 'format'
          ? t('ipam.cidrFormat')
          : preview.reason === 'tooWide'
            ? t('ipam.cidrTooWide', {
                prefix: subnetMinPrefix,
                hosts: 2 ** (32 - subnetMinPrefix) - 2,
              })
            : overlap
              ? t('ipam.cidrOverlap', { cidr: overlap.cidr, name: overlap.name })
              : false;
  const check = useFormErrors({
    cidr: cidrError,
    name: !name.trim() && t('formErrors.required'),
    vlan: vlanBad && t('ipam.vlanInvalid'),
    gateway:
      gatewayOutside &&
      t('ipam.gatewayOutside', { gateway: gatewayText, cidr: preview.value?.cidr ?? '' }),
    description: secretTextRule(t, description),
  });

  const save = useApiMutation<Record<string, unknown>, unknown>(
    subnet ? `/api/v1/ipam/subnets/${subnet.id}` : '/api/v1/ipam/subnets',
    { method: subnet ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!save.isPending}
      guardUnsaved
      initialFocus="first-field"
      maxWidth={640}
      title={
        subnet
          ? t('common.titleOf', { action: t('ipam.editSubnet'), subject: subnet.cidr })
          : t('ipam.addSubnet')
      }
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="subnet-form" className="btn primary" disabled={save.isPending}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="subnet-form"
        className="form-grid"
        data-columns={2}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          save.mutate(
            {
              name: name.trim(),
              // Dải đã khoá thì không gửi CIDR: gửi lại đúng giá trị cũ cũng là "đụng" vào nó.
              ...(cidrLocked ? {} : { cidr: cidr.trim() }),
              siteId,
              vlan: vlanValue,
              // Ô để trống = XÓA gateway đang có, cùng luật với VLAN — form luôn hiện đủ ô.
              gateway: gatewayText,
              description: description.trim(),
            },
            { onSuccess: onSaved, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        {check.summary}
        <Field
          label={t('ipam.cidr')}
          required
          hint={cidrLocked ? t('ipam.cidrLocked') : t('ipam.cidrHint')}
          htmlFor="subnet-cidr"
          error={check.error('cidr')}
        >
          <input
            id="subnet-cidr"
            className="inp mono"
            required
            readOnly={cidrLocked}
            placeholder={t('ipam.phCidr')}
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
          />
        </Field>

        <Field label={t('ipam.name')} required htmlFor="subnet-name" error={check.error('name')}>
          <input
            id="subnet-name"
            className="inp"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        {/* Xem trước NGAY dưới ô: số host và host đầu–cuối (Q-20) — đủ để biết dải gõ đúng chưa. */}
        {preview.value && !cidrLocked ? (
          <p className="muted span-2 mono" aria-live="polite">
            {t('ipam.cidrPreview', { ...preview.value })}
          </p>
        ) : null}

        <Field
          label={t('ipam.vlan')}
          hint={t('ipam.vlanHint')}
          htmlFor="subnet-vlan"
          error={check.error('vlan')}
        >
          <input
            id="subnet-vlan"
            className="inp mono"
            inputMode="numeric"
            placeholder={t('ipam.phVlan')}
            value={vlan}
            onChange={(e) => setVlan(e.target.value)}
          />
        </Field>

        {/* Gateway: câu hỏi ĐẦU TIÊN khi khai IP tĩnh cho một cái máy. Là một ô riêng
            để tra được, thay vì nhét vào ô mô tả, mỗi người một kiểu. */}
        <Field
          label={t('ipam.gateway')}
          hint={t('ipam.gatewayHint')}
          htmlFor="subnet-gateway"
          error={check.error('gateway')}
        >
          <input
            id="subnet-gateway"
            className="inp mono"
            placeholder={t('ipam.phGateway')}
            value={gateway}
            onChange={(e) => setGateway(e.target.value)}
          />
        </Field>
        {/* Gateway gần như luôn là host đầu của dải — gợi ý một cú bấm, không tự điền: dải
            không có gateway là chuyện có thật và ô trống phải là lựa chọn người khai tự làm. */}
        {typed && !gatewayText && typed.hosts > 1 ? (
          <p className="span-2">
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => setGateway(typed.first)}
            >
              {t('ipam.gatewayUse', { gateway: typed.first })}
            </button>
          </p>
        ) : null}

        <Field label={t('ipam.site')} hint={t('ipam.siteHint')}>
          <Select
            value={siteId}
            onChange={setSiteId}
            ariaLabel={t('ipam.site')}
            placeholder={t('ipam.noSite')}
            options={[
              { value: '', label: t('ipam.noSite') },
              ...activeOptions(lists.data?.sites, subnet?.siteId, (site) => site.code),
            ]}
            failed={lists.isError}
          />
        </Field>

        <Field
          label={t('ipam.description')}
          htmlFor="subnet-description"
          span={2}
          error={check.error('description')}
        >
          <textarea
            id="subnet-description"
            className="inp"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        {error ? (
          <p className="alert error span-2" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/**
 * "Xóa" = ẩn, và ẩn thì PHẢI nói lý do (quyết định 2026-08-23).
 *
 * Dùng hộp riêng chứ không dùng `useConfirm` chung: hộp xác nhận chung chỉ hỏi có/không, còn
 * ở đây lý do là dữ liệu bắt buộc — nó đi vào audit và là thứ trả lời "sao dải này biến mất"
 * sáu tháng sau.
 */
export function HideDialog({
  subnet,
  csrfToken,
  onClose,
  onDone,
}: {
  subnet: SubnetRow;
  csrfToken: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const check = useFormErrors({ reason: textRule(t, reason, 3) ?? secretTextRule(t, reason) });
  /* Luật NAT còn trỏ vào IP trong dải. Sổ NAT của một văn phòng chỉ vài chục dòng, lọc theo
     CIDR ngay ở đây. Hỏng thì im — API vẫn là nơi chặn. */
  const nat = useQuery({
    queryKey: ['ipam', 'nat', 'all-live'],
    queryFn: () => apiFetch<{ internalIp: string }[]>('/api/v1/ipam/nat'),
  });
  const natInSubnet = nat.data?.filter((rule) => cidrContains(subnet.cidr, rule.internalIp)).length;

  /*
   * `PATCH :id/void`, KHÔNG phải `DELETE` (2026-08-27).
   *
   * `DELETE` giờ mang đúng nghĩa của nó — xóa hẳn — và chỉ nhận dải chưa từng có hồ sơ IP.
   * Vô hiệu hóa là việc khác: dải đã từng dùng, bản ghi phải ở lại kèm lý do.
   */
  const hide = useApiMutation<{ reason: string }, unknown>(
    `/api/v1/ipam/subnets/${subnet.id}/void`,
    { method: 'PATCH', csrfToken, refreshMe: false },
  );

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!hide.isPending}
      guardUnsaved
      initialFocus="first-field"
      maxWidth={480}
      title={t('ipam.hideSubnetTitle', { cidr: subnet.cidr })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="hide-subnet-form"
            className="btn danger"
            disabled={hide.isPending}
          >
            {hide.isPending ? t('common.loading') : t('ipam.hide')}
          </button>
        </>
      }
    >
      <form
        id="hide-subnet-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          hide.mutate(
            { reason: reason.trim() },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">{t('ipam.hideHint')}</p>
        {/* API chặn ngừng dùng khi còn luật NAT sống trỏ vào dải: nói TRƯỚC khi người dùng gõ
            lý do và bấm, thay vì để họ nhận lỗi sau. */}
        {natInSubnet ? (
          <p className="alert warn" role="note">
            {t('ipam.hideImpactNat', { count: natInSubnet })}
          </p>
        ) : null}
        {/* Con số ảnh hưởng, không phải văn xuôi: người bấm phải biết bao nhiêu máy đang cắm
            IP tĩnh của dải này trước khi cất nó đi. */}
        <ul className="muted">
          <li>{t('ipam.hideImpactUsed', { count: subnet.used })}</li>
          <li>{t('ipam.hideImpactHistory')}</li>
          <li>{t('ipam.hideImpactRestore')}</li>
        </ul>
        <Field label={t('ipam.reason')} required htmlFor="hide-reason" error={check.error('reason')}>
          <input
            id="hide-reason"
            className="inp"
            required
            minLength={3}
            placeholder={t('ipam.reasonPlaceholder')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
