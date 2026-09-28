import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { daysUntil } from '@/lib/expiry';
import { formatDate, todayIso } from '@/lib/format';
import { renewMinDate, renewPreset } from '@/lib/renew-dates';
import { DatePicker } from '@/ui/date-picker';
import { Dialog } from '@/ui/dialog';
import { Field } from '@/ui/page-header';
import { useToast } from '@/ui/toast';
import { useFormErrors } from '@/ui/use-form-errors';

/** Đủ để gia hạn một mục: `kind` + `id` là khoá của `POST /expiry/renew`. */
export interface RenewTarget {
  kind: string;
  id: string;
  label: string;
  /** Mã hồ sơ cho tiêu đề ngắn "Gia hạn LIC-01"; thiếu thì dùng `label`. */
  code?: string | null;
  /** Hạn hiện tại (YYYY-MM-DD) — hạn mới phải sau ngày này. */
  end: string;
}

/** Các nút chọn nhanh, tính bằng tháng. Gần như mọi lần gia hạn là tròn năm. */
const PRESETS = [1, 6, 12, 24, 36];

/**
 * Hộp Gia hạn một mục có hạn — MỘT hộp cho mọi cửa (AD-15): màn `/expiry`, khối "Sắp hết hạn"
 * của trang chủ, trang chi tiết và danh sách phần mềm. Hai bản riêng từng nói khác chữ ("Hết
 * hạn" và "Hạn mới") và khác luật chặn ngày.
 *
 * `url` bỏ trống thì gọi `POST /expiry/renew` (kind + id); có `url` thì gửi `{ endDate }` thẳng
 * vào endpoint gia hạn của module chủ. Hộp tự báo toast "Đã gia hạn X tới ngày Y" để mọi cửa
 * nói cùng một câu; nơi gọi chỉ làm mới dữ liệu trong `onDone`.
 */
export function RenewDialog({
  row,
  kindLabel,
  csrfToken,
  url,
  onClose,
  onDone,
}: {
  row: RenewTarget;
  kindLabel: string;
  csrfToken: string;
  url?: string;
  onClose: () => void;
  onDone: (newEnd: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const today = todayIso();
  const min = renewMinDate(row.end, today);
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const check = useFormErrors({
    endDate: !endDate
      ? t('expiry.pickDate')
      : endDate < min && t('expiry.renewTooEarly', { date: formatDate(min) }),
  });
  const renew = useApiMutation<Record<string, unknown>, unknown>(
    url ?? '/api/v1/expiry/renew',
    { csrfToken, refreshMe: false },
  );
  const subject = row.code || row.label;
  const left = daysUntil(row.end);

  return (
    <Dialog
      open
      onOpenChange={onClose}
      /* Đang ghi thì KHÔNG cho đóng bằng Esc / bấm nền: hộp biến mất nhưng lượt ghi
         vẫn chạy tiếp, nên người dùng tin là đã hủy trong khi dữ liệu đã vào sổ.
         `guardUnsaved`: chưa bấm Lưu mà lỡ Esc thì hỏi lại, đừng xoá trắng. */
      dismissible={!renew.isPending}
      guardUnsaved
      maxWidth={520}
      title={t('expiry.renewTitleOf', { subject })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" form="renew-form" className="btn primary" disabled={renew.isPending}>
            {renew.isPending ? t('common.loading') : t('expiry.renew')}
          </button>
        </>
      }
    >
      <form
        id="renew-form"
        className="form-grid"
        data-columns={1}
        ref={check.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check.check()) return;
          renew.mutate(url ? { endDate } : { kind: row.kind, id: row.id, endDate }, {
            onSuccess: () => {
              toast({
                message: t('expiry.renewedTo', { subject, date: formatDate(endDate) }),
              });
              onDone(endDate);
            },
            onError: (err) => setError(errorMessage(err)),
          });
        }}
      >
        <p className="muted">
          {kindLabel} · {row.label}
        </p>
        <p>
          {t('expiry.currentEnd')}: <strong>{formatDate(row.end)}</strong>{' '}
          <span className={left < 0 ? 'renew-overdue' : 'muted'}>
            (
            {left < 0
              ? t('expiry.labelOverdue', { count: -left })
              : left === 0
                ? t('expiry.labelToday')
                : t('expiry.labelLeft', { count: left })}
            )
          </span>
        </p>
        {/* Nút chọn nhanh đứng NGOÀI `Field`: `Field` gắn nhãn vào đứa con duy nhất của nó, và
            nhóm nút nằm trong nhãn thì bấm vào chữ "Hạn mới" là bấm luôn nút đầu tiên. */}
        <div className="renew-presets" role="group" aria-label={t('expiry.renewPresets')}>
          {PRESETS.map((months) => {
            const value = renewPreset(row.end, today, months);
            return (
              <button
                key={months}
                type="button"
                className="btn sm"
                aria-pressed={endDate === value}
                onClick={() => setEndDate(value)}
              >
                {months % 12 === 0
                  ? t('expiry.presetYears', { count: months / 12 })
                  : t('expiry.presetMonths', { count: months })}
              </button>
            );
          })}
        </div>
        <Field
          label={t('expiry.newEnd')}
          required
          hint={t('expiry.renewMinHint', { date: formatDate(min) })}
          error={check.error('endDate')}
        >
          <DatePicker
            value={endDate}
            ariaLabel={t('expiry.newEnd')}
            /* Chặn trên lịch; API vẫn kiểm lại vì chốt chặn thật phải nằm ở server. */
            min={min}
            onChange={setEndDate}
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
