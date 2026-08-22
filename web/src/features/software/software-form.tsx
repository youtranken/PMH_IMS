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
  KIND_KEY,
  SOFTWARE_KINDS,
  SOFTWARE_STATUSES,
  STATUS_KEY,
  supportsSeats,
  type SoftwareKind,
  type SoftwareRow,
  type SoftwareStatus,
} from './software-types';

interface FormState {
  code: string;
  name: string;
  kind: SoftwareKind;
  vendorId: string;
  seatTotal: string;
  startDate: string;
  endDate: string;
  note: string;
  status: SoftwareStatus;
}

function initialState(row: SoftwareRow | null): FormState {
  return {
    code: row?.code ?? '',
    name: row?.name ?? '',
    kind: row?.kind ?? 'license',
    vendorId: row?.vendorId ?? '',
    seatTotal: row?.seatTotal != null ? String(row.seatTotal) : '',
    startDate: row?.startDate ?? '',
    endDate: row?.endDate ?? '',
    note: row?.note ?? '',
    status: row?.status ?? 'active',
  };
}

/** Form hồ sơ phần mềm (story 3.1, FR-008). Màn nhập — desktop-first. */
export function SoftwareForm({
  row,
  lists,
  csrfToken,
  onClose,
  onSaved,
}: {
  /** null = thêm mới. */
  row: SoftwareRow | null;
  lists: CatalogLists | undefined;
  csrfToken: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => initialState(row));
  const [error, setError] = useState<string | null>(null);

  const save = useApiMutation<Record<string, unknown>, unknown>(
    row ? `/api/v1/software/${row.id}` : '/api/v1/software',
    { method: row ? 'PATCH' : 'POST', csrfToken, refreshMe: false },
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => {
      // Đổi sang loại không có seat thì xóa luôn ô seat — gửi lên sẽ bị API từ chối,
      // và giữ lại một con số vô nghĩa trên màn hình chỉ tổ gây hiểu nhầm.
      if (key === 'kind' && !supportsSeats(value as SoftwareKind)) {
        return { ...current, kind: value as SoftwareKind, seatTotal: '' };
      }
      return { ...current, [key]: value };
    });

  const hasSeats = supportsSeats(form.kind);

  return (
    <Dialog open onOpenChange={onClose} maxWidth={760}>
      <DialogTitle>
        {row ? `${t('software.edit')} — ${row.code}` : t('software.add')}
      </DialogTitle>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!form.code.trim() || !form.name.trim()) {
            setError('Cần ít nhất mã hồ sơ và tên hồ sơ.');
            return;
          }
          save.mutate(
            {
              code: form.code.trim(),
              name: form.name.trim(),
              kind: form.kind,
              vendorId: form.vendorId,
              seatTotal: hasSeats && form.seatTotal.trim() ? Number(form.seatTotal) : null,
              startDate: form.startDate,
              endDate: form.endDate,
              note: form.note.trim(),
              status: form.status,
            },
            {
              onSuccess: () => {
                toast({ message: t('software.saved') });
                onSaved();
              },
              onError: (err) => setError(errorMessage(err)),
            },
          );
        }}
      >
        <FormSection title={t('software.tabProfile')} columns={3}>
          <Field label={t('software.code')} required htmlFor="sw-code">
            <input
              id="sw-code"
              className="inp mono"
              required
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>
          <Field label={t('software.name')} required htmlFor="sw-name" span={2}>
            <input
              id="sw-name"
              className="inp"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>

          <Field label={t('software.kind')} required>
            <Select
              value={form.kind}
              ariaLabel={t('software.kind')}
              options={SOFTWARE_KINDS.map((kind) => ({
                value: kind,
                label: t(KIND_KEY[kind]),
              }))}
              onChange={(value) => set('kind', value as SoftwareKind)}
            />
          </Field>
          <Field label={t('software.vendor')}>
            <Select
              value={form.vendorId}
              ariaLabel={t('software.vendor')}
              placeholder={`— ${t('software.noVendor')} —`}
              options={(lists?.vendors ?? []).map((vendor) => ({
                value: vendor.id,
                label: vendor.name,
              }))}
              onChange={(value) => set('vendorId', value)}
            />
          </Field>
          <Field label={t('software.status')}>
            <Select
              value={form.status}
              ariaLabel={t('software.status')}
              options={SOFTWARE_STATUSES.map((status) => ({
                value: status,
                label: t(STATUS_KEY[status]),
              }))}
              onChange={(value) => set('status', value as SoftwareStatus)}
            />
          </Field>
        </FormSection>

        <FormSection title={t('software.expiry')} columns={3}>
          <Field label={t('software.startDate')}>
            <DatePicker
              value={form.startDate}
              ariaLabel={t('software.startDate')}
              onChange={(value) => set('startDate', value)}
            />
          </Field>
          <Field label={t('software.endDate')}>
            <DatePicker
              value={form.endDate}
              ariaLabel={t('software.endDate')}
              onChange={(value) => set('endDate', value)}
            />
          </Field>
          {/* Ô seat chỉ hiện với license — loại khác thấy ô này là hiểu sai ý nghĩa cột. */}
          {hasSeats ? (
            <Field label={t('software.seatTotal')} hint={t('software.seatHint')} htmlFor="sw-seat">
              <input
                id="sw-seat"
                className="inp"
                inputMode="numeric"
                value={form.seatTotal}
                onChange={(e) => set('seatTotal', e.target.value)}
              />
            </Field>
          ) : null}
          <Field label={t('software.note')} hint={t('software.noteHint')} htmlFor="sw-note" span={3}>
            <textarea
              id="sw-note"
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
