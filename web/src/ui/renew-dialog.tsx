import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage, useApiMutation } from '@/lib/api';
import { daysUntil } from '@/lib/expiry';
import { formatDate, todayIso } from '@/lib/format';
import { formatMoneyInput, parseMoneyInput } from '@/lib/money-input';
import { renewMinDate, renewPreset } from '@/lib/renew-dates';
import { AttachmentDraftSection, useAttachmentDraft } from '@/ui/attachment-draft';
import type { AttachmentOwnerType } from '@/ui/attachment-panel';
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
  seatEnds,
  withTerms,
  attachTo,
  onClose,
  onDone,
}: {
  row: RenewTarget;
  kindLabel: string;
  csrfToken: string;
  url?: string;
  /**
   * Hạn riêng (YYYY-MM-DD) của các ghế CÒN HIỆU LỰC có kỳ hạn riêng — chỉ license truyền. Có
   * ghế sẽ bị bỏ lại phía sau hạn mới thì hộp hiện ô "Cập nhật luôn N ghế" (bật sẵn) và gửi
   * `seats: true` lên endpoint của module chủ (`url`).
   */
  seatEnds?: string[];
  /**
   * Hiện hai ô tuỳ chọn "Số hợp đồng" + "Chi phí kỳ mới" và gửi `contract`/`cost` lên endpoint
   * của module chủ (`url`) — nó ghi vào sổ gia hạn của RIÊNG lượt này (Q-15). Chỉ bật cho cửa
   * có `url` nhận hai trường đó; `POST /expiry/renew` không nhận.
   */
  withTerms?: boolean;
  /** Hồ sơ nhận hoá đơn/hợp đồng gia hạn đính kèm — tải lên sau khi gia hạn xong. */
  attachTo?: { ownerType: AttachmentOwnerType; ownerId: string };
  onClose: () => void;
  onDone: (newEnd: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const today = todayIso();
  const min = renewMinDate(row.end, today);
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [withSeats, setWithSeats] = useState(true);
  const showTerms = !!url && !!withTerms;
  const [contract, setContract] = useState('');
  // Chi phí giữ dạng CHUỖI lúc gõ: ô trống (chưa khai) phải khác được với 0 ₫.
  const [cost, setCost] = useState('');
  const money = parseMoneyInput(cost);
  const draft = useAttachmentDraft();
  const [uploading, setUploading] = useState(false);
  /* Ghế nào sẽ bị bỏ lại: hạn riêng TRƯỚC hạn mới (chưa chọn hạn mới thì trước hạn hiện tại
     cũng tính — đó là ghế sẽ hiện "Quá hạn" cùng lúc với hồ sơ). Cùng luật với API. */
  const staleSeats = url
    ? (seatEnds ?? []).filter((end) => (endDate ? end < endDate : end <= row.end)).length
    : 0;
  const check = useFormErrors({
    endDate: !endDate
      ? t('expiry.pickDate')
      : endDate < min && t('expiry.renewTooEarly', { date: formatDate(min) }),
    cost: showTerms && money.reason === 'invalid' && t('license.costInvalid'),
  });
  const renew = useApiMutation<Record<string, unknown>, { seatsRenewed?: number } | undefined>(
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
      dismissible={!renew.isPending && !uploading}
      guardUnsaved
      maxWidth={520}
      title={t('expiry.renewTitleOf', { subject })}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="renew-form"
            className="btn primary"
            disabled={renew.isPending || uploading}
          >
            {renew.isPending || uploading ? t('common.loading') : t('expiry.renew')}
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
          const seats = staleSeats > 0 && withSeats;
          const terms = showTerms
            ? {
                ...(contract.trim() ? { contract: contract.trim() } : {}),
                ...(money.value !== null ? { cost: money.value } : {}),
              }
            : {};
          const body = url
            ? { endDate, ...(seats ? { seats: true } : {}), ...terms }
            : { kind: row.kind, id: row.id, endDate };
          renew.mutate(body, {
            onSuccess: async (result) => {
              const renewedSeats = result?.seatsRenewed ?? 0;
              toast({
                message:
                  renewedSeats > 0
                    ? t('expiry.renewedToSeats', {
                        subject,
                        date: formatDate(endDate),
                        count: renewedSeats,
                      })
                    : t('expiry.renewedTo', { subject, date: formatDate(endDate) }),
              });
              /* Gia hạn đã ghi xuống DB: file hỏng thì báo riêng từng file, không biến lượt
                 gia hạn thành "thất bại". */
              if (attachTo && draft.files.length > 0) {
                setUploading(true);
                const failures = await draft.upload(attachTo.ownerType, attachTo.ownerId, csrfToken);
                setUploading(false);
                for (const failure of failures) toast({ message: failure, tone: 'warn' });
              }
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

        {staleSeats > 0 ? (
          <label className="row" style={{ gap: 'var(--space-3)' }}>
            <input
              type="checkbox"
              checked={withSeats}
              onChange={(e) => setWithSeats(e.target.checked)}
            />
            <span>{t('expiry.renewSeats', { count: staleSeats })}</span>
          </label>
        ) : null}

        {showTerms ? (
          <>
            <Field
              label={t('expiry.renewContract')}
              hint={t('expiry.renewContractHint')}
              htmlFor="renew-contract"
            >
              <input
                id="renew-contract"
                className="inp"
                maxLength={200}
                value={contract}
                onChange={(e) => setContract(e.target.value)}
              />
            </Field>
            <Field
              label={t('expiry.renewCost')}
              hint={t('license.costHint')}
              htmlFor="renew-cost"
              error={check.error('cost')}
            >
              {/* Ô chữ, không `type="number"`: phải nhận "5.600.000" hay "5,6tr" như chép từ
                  hoá đơn (`lib/money-input`). */}
              <input
                id="renew-cost"
                className="inp"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                onBlur={() => {
                  if (money.reason === null && money.value !== null) {
                    setCost(formatMoneyInput(money.value));
                  }
                }}
              />
            </Field>
          </>
        ) : null}

        {attachTo ? <AttachmentDraftSection draft={draft} disabled={renew.isPending || uploading} /> : null}

        {error ? (
          <p className="alert error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
