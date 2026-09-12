import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import type { SubnetRow } from './ipam-types';
import { useCatalogLists } from '@/ui/use-catalog-lists';

export function SubnetForm({
  subnet,
  csrfToken,
  onClose,
  onSaved,
}: {
  subnet: SubnetRow | null;
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
      maxWidth={560}
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
        data-columns={1}
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          // Ô VLAN để trống = XÓA số đang có, không phải "đừng đụng tới": form luôn hiện đủ ô.
          const raw = vlan.trim();
          let vlanValue: number | null = null;
          if (raw !== '') {
            const parsed = Number(raw);
            if (!Number.isInteger(parsed) || parsed < 1 || parsed > 4094) {
              setError(t('ipam.vlanInvalid'));
              return;
            }
            vlanValue = parsed;
          }
          save.mutate(
            {
              name: name.trim(),
              cidr: cidr.trim(),
              siteId,
              vlan: vlanValue,
              // Ô để trống = XÓA gateway đang có, cùng luật với VLAN — form luôn hiện đủ ô.
              gateway: gateway.trim(),
              description: description.trim(),
            },
            { onSuccess: onSaved, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <Field label={t('ipam.cidr')} required hint={t('ipam.cidrHint')} htmlFor="subnet-cidr">
          <input
            id="subnet-cidr"
            className="inp mono"
            required
            placeholder={t('ipam.phCidr')}
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
          />
        </Field>

        <Field label={t('ipam.name')} required htmlFor="subnet-name">
          <input
            id="subnet-name"
            className="inp"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label={t('ipam.vlan')} hint={t('ipam.vlanHint')} htmlFor="subnet-vlan">
          <input
            id="subnet-vlan"
            className="inp mono"
            inputMode="numeric"
            placeholder={t('ipam.phVlan')}
            value={vlan}
            onChange={(e) => setVlan(e.target.value)}
          />
        </Field>

        {/* Gateway (0035): câu hỏi ĐẦU TIÊN khi khai IP tĩnh cho một cái máy. Trước đây phải
            nhét vào ô mô tả, mỗi người một kiểu, nên không tra được. */}
        <Field label={t('ipam.gateway')} hint={t('ipam.gatewayHint')} htmlFor="subnet-gateway">
          <input
            id="subnet-gateway"
            className="inp mono"
            placeholder={t('ipam.phGateway')}
            value={gateway}
            onChange={(e) => setGateway(e.target.value)}
          />
        </Field>

        <Field label={t('ipam.site')}>
          <Select
            value={siteId}
            onChange={setSiteId}
            ariaLabel={t('ipam.site')}
            placeholder={t('ipam.noSite')}
            options={[
              { value: '', label: t('ipam.noSite') },
              ...(lists.data?.sites ?? []).map((site) => ({ value: site.id, label: site.code })),
            ]}
            failed={lists.isError}
          />
        </Field>

        <Field label={t('ipam.description')} htmlFor="subnet-description">
          <textarea
            id="subnet-description"
            className="inp"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        {/*
          SỬA một dải đang có thì mở khu giấy tờ: sơ đồ mạng, biên bản bàn giao dải IP tĩnh từ
          nhà mạng — trước đây không có chỗ đính nên nằm trong thư mục chia sẻ của phòng IT.

          KHAI MỚI thì chưa có id để gắn, nên chưa hiện.
        */}
        {subnet ? (
          <>
            {/* Panel GHI THẲNG, không nằm trong lượt Lưu — hộp có nút Hủy nên phải nói ra. */}
            <p className="alert">{t('attachments.liveWarning')}</p>
            <AttachmentPanel
              ownerType="subnet"
              ownerId={subnet.id}
              csrfToken={csrfToken}
              canEdit={!save.isPending}
            />
          </>
        ) : null}

        {error ? (
          <p className="alert error" role="alert">
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
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          hide.mutate(
            { reason: reason.trim() },
            { onSuccess: onDone, onError: (err) => setError(errorMessage(err)) },
          );
        }}
      >
        <p className="muted">{t('ipam.hideHint')}</p>
        <Field label={t('ipam.reason')} required htmlFor="hide-reason">
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
