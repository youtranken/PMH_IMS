import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { nextPortLabel } from '@/lib/port-label';
import type { PortRow } from '@/lib/port-types';
import { DeviceCombobox } from '@/ui/device-combobox';
import { Dialog, DialogCancel } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { SuggestInput } from '@/ui/suggest-input';
import { useToast } from '@/ui/toast';
import { activeOptions, useCatalogLists } from '@/ui/use-catalog-lists';
import { useDepartments } from '@/ui/use-departments';
import { secretTextRule, useFormErrors, useSubmitError } from '@/ui/use-form-errors';

type PeerMode = 'device' | 'free';

/**
 * Hộp khai/sửa MỘT dòng sơ đồ cổng (AD-14) — dùng chung cho trang thiết bị và nút "Khai kết nối"
 * của màn sơ đồ mạng (AD-15, Q-23): một hộp, một luật, ghi NGAY qua endpoint của `devices`.
 *
 * `device` vắng (màn sơ đồ) thì hộp hỏi thêm "Thiết bị" trước — máy giữ bản ghi của sợi dây.
 */
export function PortFormDialog({
  device,
  port,
  csrfToken,
  onClose,
  onSaved,
}: {
  device: { id: string; code: string } | null;
  /** `null` = thêm dòng mới. */
  port: PortRow | null;
  csrfToken: string;
  onClose: () => void;
  /**
   * `keepOpen`: người dùng chọn "Ghi rồi khai cổng kế tiếp" — hộp đã tự chuẩn bị cổng kế tiếp.
   * `saved` + `deviceId` (máy giữ bản ghi) để màn sơ đồ chèn nét cho dây vừa khai.
   */
  onSaved: (keepOpen: boolean, saved: PortRow, deviceId: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const lists = useCatalogLists();
  const [holder, setHolder] = useState<{ id: string; code: string } | null>(device);
  const [holderTerm, setHolderTerm] = useState(device?.code ?? '');
  const [portLabel, setPortLabel] = useState(port?.portLabel ?? '');
  /* Đầu kia là MỘT trong hai: một máy trong kho, hoặc một mô tả tự do (uplink nhà mạng, ổ cắm
     tường). Hai ô cùng hiện thì không rõ phải điền cái nào hay cả hai. */
  const [mode, setMode] = useState<PeerMode>(port?.connectedLabel && !port.connectedDeviceId ? 'free' : 'device');
  const [peer, setPeer] = useState<{ id: string; code: string } | null>(
    port?.connectedDeviceId ? { id: port.connectedDeviceId, code: port.connectedDeviceCode ?? '' } : null,
  );
  const [query, setQuery] = useState(port?.connectedDeviceCode ?? '');
  const [connectedLabel, setConnectedLabel] = useState(port?.connectedLabel ?? '');
  const [connectedPort, setConnectedPort] = useState(port?.connectedPort ?? '');
  const [cableTypeId, setCableTypeId] = useState(port?.cableTypeId ?? '');
  const [usedBy, setUsedBy] = useState(port?.usedBy ?? '');
  const [vlan, setVlan] = useState(port?.vlan ?? '');
  const departments = useDepartments();
  const [note, setNote] = useState(port?.note ?? '');
  const [error, setError] = useSubmitError([holder, portLabel, mode, peer, connectedLabel, connectedPort, cableTypeId, usedBy, vlan, note]);
  const keepOpen = useRef(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const check = useFormErrors({
    holder: !holder && t('ports.holderRequired'),
    portLabel: !portLabel.trim() && t('ports.portRequired'),
    note: secretTextRule(t, note),
    connectedLabel: mode === 'free' ? secretTextRule(t, connectedLabel) : null,
  });

  const holderId = holder?.id ?? '';
  const save = useApiMutation<Record<string, unknown>, PortRow>(
    port ? `/api/v1/devices/${holderId}/ports/${port.id}` : `/api/v1/devices/${holderId}/ports`,
    { method: port ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  /** Sau "Ghi rồi thêm cổng khác": giữ VLAN, người dùng và loại dây (cả dãy cổng thường chung), tăng nhãn. */
  const prepareNext = () => {
    setPortLabel(nextPortLabel(portLabel));
    setPeer(null);
    setQuery('');
    setConnectedLabel('');
    setConnectedPort('');
    setNote('');
    labelRef.current?.focus();
  };

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ. */
      dismissible={!save.isPending}
      guardUnsaved
      maxWidth={620}
      /* "{Việc} — {máy nào}": hộp "Sửa — Gi1/0/1" không nói cổng của máy nào. */
      title={
        device
          ? t('common.titleOf', {
              action: port ? t('ports.editOf', { port: port.portLabel }) : t('ports.add'),
              subject: device.code,
            })
          : t('ports.declareTitle')
      }
      footer={
        <>
          <DialogCancel>{t('common.cancel')}</DialogCancel>
          {/* Khai cả dãy cổng: tên nút cố ý không chứa chữ "Lưu" — nút chính vẫn là "Lưu". */}
          {port ? null : (
            <button
              type="submit"
              form="port-form"
              className="btn"
              disabled={save.isPending}
              onClick={() => {
                keepOpen.current = true;
              }}
            >
              {t('ports.saveAndNext')}
            </button>
          )}
          <button
            type="submit"
            form="port-form"
            className="btn primary"
            disabled={save.isPending}
            onClick={() => {
              keepOpen.current = false;
            }}
          >
            {save.isPending ? t('common.saving') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="port-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check() || !holder) return;
          const label = portLabel.trim();
          const next = keepOpen.current;
          const owner = holder.id;
          save.mutate(
            {
              portLabel: label,
              // Mỗi sợi dây chỉ có MỘT nguồn sự thật về đầu kia: chế độ nào thì gửi ô đó.
              connectedDeviceId: mode === 'device' ? (peer?.id ?? '') : '',
              connectedLabel: mode === 'free' ? connectedLabel.trim() : '',
              connectedPort: connectedPort.trim(),
              cableTypeId,
              usedBy: usedBy.trim(),
              vlan: vlan.trim(),
              note: note.trim(),
            },
            {
              onSuccess: (saved) => {
                toast({ message: t('ports.saved', { port: label }) });
                if (next) prepareNext();
                onSaved(next, saved, owner);
              },
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        {/* Lỗi ở ĐẦU form: hộp dài thì lỗi ở cuối nằm ngoài tầm nhìn, người dùng bấm Lưu mãi. */}
        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
        {check.summary}

        {device ? null : (
          <Field label={t('ports.holder')} required error={check.error('holder')}>
            <DeviceCombobox
              placeholder={t('ports.peerSearch')}
              ariaLabel={t('ports.holder')}
              value={{ deviceId: holder?.id ?? '', term: holderTerm }}
              onChange={(next) => {
                setHolderTerm(next.term);
                setHolder(next.device ? { id: next.device.id, code: next.device.code } : null);
              }}
              minChars={2}
            />
          </Field>
        )}

        <Field label={t('ports.port')} required htmlFor="port-label" error={check.error('portLabel')}>
          <input
            ref={labelRef}
            id="port-label"
            className="inp mono"
            required
            placeholder={t('ports.phPort')}
            value={portLabel}
            onChange={(e) => setPortLabel(e.target.value)}
          />
        </Field>

        <div className="segmented fill" role="radiogroup" aria-label={t('ports.peerKind')}>
          {(['device', 'free'] as const).map((value) => (
            <label key={value}>
              <input type="radio" name="peer-kind" value={value} checked={mode === value} onChange={() => setMode(value)} />
              {t(value === 'device' ? 'ports.peerKindDevice' : 'ports.peerKindFree')}
            </label>
          ))}
        </div>

        {mode === 'device' ? (
          <Field label={t('ports.peerDevice')} hint={t('ports.peerDeviceHint')}>
            <DeviceCombobox
              placeholder={t('ports.peerSearch')}
              /* Tên trợ năng tường minh: form này có nhiều combobox (máy giữ bản ghi, đầu kia, ô
                 "ai dùng" gợi ý theo danh mục Bộ phận). */
              ariaLabel={t('ports.peerDevice')}
              value={{ deviceId: peer?.id ?? '', term: query }}
              onChange={(next) => {
                setQuery(next.term);
                setPeer(next.device ? { id: next.device.id, code: next.device.code } : null);
              }}
              minChars={2}
              // Cổng không nối vào chính máy chứa nó.
              exclude={holder ? [holder.id] : []}
            />
          </Field>
        ) : (
          <Field label={t('ports.freeText')} hint={t('ports.freeTextHint')} htmlFor="port-free" error={check.error('connectedLabel')}>
            <input id="port-free" className="inp" value={connectedLabel} onChange={(e) => setConnectedLabel(e.target.value)} />
          </Field>
        )}

        <Field label={t('ports.peerPort')} htmlFor="port-peer-port">
          <input id="port-peer-port" className="inp mono" value={connectedPort} onChange={(e) => setConnectedPort(e.target.value)} />
        </Field>
        <Field label={t('ports.cableType')}>
          <Select
            value={cableTypeId}
            onChange={setCableTypeId}
            ariaLabel={t('ports.cableType')}
            options={[
              { value: '', label: t('ports.cableTypeNone') },
              // Loại đã ngừng dùng chỉ hiện khi dòng đang mang nó (Q-14).
              ...activeOptions(lists.data?.cableTypes, port?.cableTypeId, (row) => row.name),
            ]}
          />
        </Field>
        <Field label={t('ports.vlan')} hint={t('ports.vlanHint')} htmlFor="port-vlan">
          <input id="port-vlan" className="inp mono" placeholder={t('ports.phVlan')} value={vlan} onChange={(e) => setVlan(e.target.value)} />
        </Field>

        <Field label={t('ports.usedBy')}>
          {/* Cùng danh mục Bộ phận với ô "ai đang dùng" của hồ sơ IP và của sổ NAT — ba chỗ
              trả lời cùng một câu, viết lệch nhau thì tra chéo không ra. */}
          <SuggestInput
            value={usedBy}
            onChange={setUsedBy}
            options={departments.names}
            failed={departments.failed}
            placeholder={t('ports.usedByPlaceholder')}
            ariaLabel={t('ports.usedBy')}
          />
        </Field>
        <Field label={t('ports.note')} htmlFor="port-note" error={check.error('note')}>
          <input id="port-note" className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
