import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { AttachmentDraftSection, useAttachmentDraft } from '@/ui/attachment-draft';
import { AttachmentPanel } from '@/ui/attachment-panel';
import { Dialog } from '@/ui/dialog';
import { Field, FormSection } from '@/ui/page-header';
import { Select } from '@/ui/select';
import { SuggestInput } from '@/ui/suggest-input';
import { useToast } from '@/ui/toast';
import { useDepartments } from '@/features/ipam/use-departments';
import {
  KIND_KEY,
  SERVICE_ACCOUNT_KINDS,
  SERVICE_ACCOUNT_STATUSES,
  STATUS_KEY,
  supportsVpnFields,
  type ServiceAccountKind,
  type ServiceAccountRow,
  type ServiceAccountStatus,
} from './service-account-types';

interface FormState {
  code: string;
  kind: ServiceAccountKind;
  name: string;
  login: string;
  department: string;
  ownerName: string;
  groupName: string;
  allowedIps: string;
  note: string;
  status: ServiceAccountStatus;
}

function initialState(row: ServiceAccountRow | null): FormState {
  return {
    code: row?.code ?? '',
    kind: row?.kind ?? 'shared',
    name: row?.name ?? '',
    login: row?.login ?? '',
    department: row?.department ?? '',
    ownerName: row?.ownerName ?? '',
    groupName: row?.groupName ?? '',
    allowedIps: row?.allowedIps ?? '',
    note: row?.note ?? '',
    status: row?.status ?? 'active',
  };
}

/**
 * Form tài khoản dịch vụ (0032). Màn nhập — desktop-first.
 *
 * Một hộp cho CẢ HAI loại, và ô nào chỉ thuộc một loại thì chỉ hiện với loại đó — đúng khuôn
 * của form Phần mềm (ô Số seat chỉ hiện với license). Đổi loại sang "dùng chung" thì xóa
 * luôn nhóm VPN và dải IP đang gõ dở: gửi lên sẽ bị API từ chối, mà giữ lại trên màn hình chỉ
 * tổ làm người dùng tưởng nó vẫn được lưu.
 */
export function ServiceAccountForm({
  row,
  csrfToken,
  onClose,
  onSaved,
}: {
  /** null = thêm mới. */
  row: ServiceAccountRow | null;
  csrfToken: string;
  onClose: () => void;
  onSaved: (warnings: string[]) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const departments = useDepartments();
  const [form, setForm] = useState<FormState>(() => initialState(row));
  const [error, setError] = useState<string | null>(null);
  const draft = useAttachmentDraft();
  const [uploading, setUploading] = useState(false);

  const save = useApiMutation<Record<string, unknown>, ServiceAccountRow>(
    row ? `/api/v1/service-accounts/${row.id}` : '/api/v1/service-accounts',
    { method: row ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );
  const busy = save.isPending || uploading;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => {
      if (key === 'kind' && !supportsVpnFields(value as ServiceAccountKind)) {
        return { ...current, kind: value as ServiceAccountKind, groupName: '', allowedIps: '' };
      }
      return { ...current, [key]: value };
    });

  const vpn = supportsVpnFields(form.kind);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      maxWidth={780}
      title={row ? `${t('serviceAccounts.edit')} — ${row.code}` : t('serviceAccounts.add')}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="sa-form" className="btn primary" disabled={busy}>
            {busy ? t('common.loading') : t('common.save')}
          </button>
        </>
      }
    >
      <form
        id="sa-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          save.mutate(
            {
              code: form.code.trim(),
              kind: form.kind,
              name: form.name.trim(),
              login: form.login.trim(),
              department: form.department.trim(),
              ownerName: form.ownerName.trim(),
              groupName: vpn ? form.groupName.trim() : '',
              allowedIps: vpn ? form.allowedIps.trim() : '',
              note: form.note.trim(),
              status: form.status,
            },
            {
              onSuccess: (created) => {
                void (async () => {
                  toast({ message: t('serviceAccounts.saved') });
                  if (draft.files.length > 0) {
                    setUploading(true);
                    const count = draft.files.length;
                    const failures = await draft.upload(
                      'service_account',
                      row?.id ?? created.id,
                      csrfToken,
                    );
                    setUploading(false);
                    if (failures.length < count) {
                      toast({
                        message: t('attachments.draftUploaded', {
                          count: count - failures.length,
                        }),
                      });
                    }
                    for (const message of failures) toast({ message, tone: 'warn' });
                  }
                  onSaved(created.warnings ?? []);
                })();
              },
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        <FormSection title={t('serviceAccounts.sectionProfile')} columns={3}>
          <Field label={t('serviceAccounts.code')} required htmlFor="sa-code">
            <input
              id="sa-code"
              className="inp mono"
              required
              placeholder="TK-KETOAN"
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
          <Field label={t('serviceAccounts.name')} required htmlFor="sa-name" span={2}>
            <input
              id="sa-name"
              className="inp"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>

          <Field label={t('serviceAccounts.kind')} required hint={t('serviceAccounts.kindHint')}>
            <Select
              value={form.kind}
              ariaLabel={t('serviceAccounts.kind')}
              options={SERVICE_ACCOUNT_KINDS.map((kind) => ({
                value: kind,
                label: t(KIND_KEY[kind]),
              }))}
              onChange={(value) => set('kind', value as ServiceAccountKind)}
            />
          </Field>
          <Field label={t('serviceAccounts.login')} hint={t('serviceAccounts.loginHint')} htmlFor="sa-login">
            <input
              id="sa-login"
              className="inp mono"
              value={form.login}
              onChange={(e) => set('login', e.target.value)}
            />
          </Field>
          <Field label={t('serviceAccounts.status')}>
            <Select
              value={form.status}
              ariaLabel={t('serviceAccounts.status')}
              options={SERVICE_ACCOUNT_STATUSES.map((status) => ({
                value: status,
                label: t(STATUS_KEY[status]),
              }))}
              onChange={(value) => set('status', value as ServiceAccountStatus)}
            />
          </Field>
        </FormSection>

        <FormSection title={t('serviceAccounts.sectionOwner')} columns={3}>
          <Field label={t('serviceAccounts.department')}>
            {/* Cùng danh mục Bộ phận với hồ sơ IP và sổ NAT — ba chỗ trả lời cùng một câu,
                viết lệch nhau thì lọc chéo không ra. */}
            <SuggestInput
              value={form.department}
              onChange={(value) => set('department', value)}
              options={departments}
              placeholder={t('serviceAccounts.departmentPlaceholder')}
              ariaLabel={t('serviceAccounts.department')}
            />
          </Field>
          <Field
            label={t('serviceAccounts.ownerName')}
            hint={t('serviceAccounts.ownerNameHint')}
            htmlFor="sa-owner"
            span={2}
          >
            <input
              id="sa-owner"
              className="inp"
              value={form.ownerName}
              onChange={(e) => set('ownerName', e.target.value)}
            />
          </Field>
        </FormSection>

        {/* Khối này CHỈ hiện với tài khoản VPN — hai ô của nó vô nghĩa với email dùng chung,
            và khai vào là ghi ra dữ liệu mà sáu tháng sau không ai dám xóa. */}
        {vpn ? (
          <FormSection title={t('serviceAccounts.sectionVpn')} columns={3}>
            <Field
              label={t('serviceAccounts.groupName')}
              hint={t('serviceAccounts.groupNameHint')}
              htmlFor="sa-group"
            >
              <input
                id="sa-group"
                className="inp mono"
                value={form.groupName}
                onChange={(e) => set('groupName', e.target.value)}
              />
            </Field>
            <Field
              label={t('serviceAccounts.allowedIps')}
              hint={t('serviceAccounts.allowedIpsHint')}
              htmlFor="sa-ips"
              span={2}
            >
              <textarea
                id="sa-ips"
                className="inp mono"
                rows={2}
                placeholder="203.113.1.5, 118.70.2.0/24"
                value={form.allowedIps}
                onChange={(e) => set('allowedIps', e.target.value)}
              />
            </Field>
          </FormSection>
        ) : null}

        <FormSection title={t('serviceAccounts.note')} columns={1}>
          <Field label={t('serviceAccounts.note')} hint={t('serviceAccounts.noteHint')} htmlFor="sa-note">
            <textarea
              id="sa-note"
              className="inp"
              rows={3}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
            />
          </Field>
        </FormSection>

        {row ? (
          <FormSection title={t('attachments.title')} columns={1}>
            <AttachmentPanel
              ownerType="service_account"
              ownerId={row.id}
              csrfToken={csrfToken}
              canEdit={!busy}
            />
          </FormSection>
        ) : (
          <AttachmentDraftSection draft={draft} disabled={busy} />
        )}

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
