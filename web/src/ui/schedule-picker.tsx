import { useTranslation } from 'react-i18next';
import i18n from '@/lib/i18n';
import { Select } from '@/ui/select';

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

export interface ScheduleValue {
  frequency: ScheduleFrequency;
  /** Giờ gửi trong ngày, 0–23. */
  hour: number;
  /** 1=Thứ Hai … 7=Chủ Nhật. Chỉ dùng khi frequency='weekly'. */
  weekday?: number;
  /** Ngày trong tháng 1–28. Chỉ dùng khi frequency='monthly' (giới hạn 28 để tháng nào cũng có). */
  dayOfMonth?: number;
}

/** 1=Thứ Hai … 7=Chủ Nhật — cùng quy ước với API (ISO 8601). Chữ ở `vi.ts`. */
const WEEKDAYS = [
  { value: 1, labelKey: 'schedule.weekday1' },
  { value: 2, labelKey: 'schedule.weekday2' },
  { value: 3, labelKey: 'schedule.weekday3' },
  { value: 4, labelKey: 'schedule.weekday4' },
  { value: 5, labelKey: 'schedule.weekday5' },
  { value: 6, labelKey: 'schedule.weekday6' },
  { value: 7, labelKey: 'schedule.weekday7' },
];

/**
 * Chọn lịch định kỳ dùng chung (AD-15) — dùng cho luật gửi email sắp-hết-hạn (FR-013),
 * lịch sinh kỳ phiếu ISO (FR-029) và mọi thứ chạy theo lịch sau này.
 * Không màn nào tự dựng combo "tần suất + giờ + thứ" riêng.
 */
export function SchedulePicker({
  value,
  onChange,
  idPrefix = 'schedule',
}: {
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  idPrefix?: string;
}) {
  const { t } = useTranslation();

  /* Ô chọn dùng `Select` chung chứ không phải `<select>` gốc: menu của hệ điều hành tô xanh
     dương, lệch hẳn mọi ô chọn khác của app (AD-15, UX-DR1). */
  return (
    <div className="row" role="group" aria-label={t('schedule.group')}>
      <div className="field">
        <label className="lbl-t" htmlFor={`${idPrefix}-freq`}>
          {t('schedule.frequency')}
        </label>
        <Select
          id={`${idPrefix}-freq`}
          value={value.frequency}
          options={[
            { value: 'daily', label: t('schedule.daily') },
            { value: 'weekly', label: t('schedule.weekly') },
            { value: 'monthly', label: t('schedule.monthly') },
          ]}
          onChange={(next) => onChange({ ...value, frequency: next as ScheduleFrequency })}
        />
      </div>

      {value.frequency === 'weekly' ? (
        <div className="field">
          <label className="lbl-t" htmlFor={`${idPrefix}-weekday`}>
            {t('schedule.weekdayLabel')}
          </label>
          <Select
            id={`${idPrefix}-weekday`}
            value={String(value.weekday ?? 1)}
            options={WEEKDAYS.map((d) => ({ value: String(d.value), label: t(d.labelKey) }))}
            onChange={(next) => onChange({ ...value, weekday: Number(next) })}
          />
        </div>
      ) : null}

      {value.frequency === 'monthly' ? (
        <div className="field">
          <label className="lbl-t" htmlFor={`${idPrefix}-dom`}>
            {t('schedule.dayOfMonthLabel')}
          </label>
          <Select
            id={`${idPrefix}-dom`}
            value={String(value.dayOfMonth ?? 1)}
            options={Array.from({ length: 28 }, (_, i) => i + 1).map((d) => ({
              value: String(d),
              label: t('schedule.dayOfMonth', { day: d }),
            }))}
            onChange={(next) => onChange({ ...value, dayOfMonth: Number(next) })}
          />
        </div>
      ) : null}

      <div className="field">
        <label className="lbl-t" htmlFor={`${idPrefix}-hour`}>
          {t('schedule.hourLabel')}
        </label>
        <Select
          id={`${idPrefix}-hour`}
          value={String(value.hour)}
          options={Array.from({ length: 24 }, (_, h) => ({
            value: String(h),
            label: `${String(h).padStart(2, '0')}:00`,
          }))}
          onChange={(next) => onChange({ ...value, hour: Number(next) })}
        />
      </div>
    </div>
  );
}

/** Mô tả lịch thành một câu — dùng ở bảng danh sách luật, email, tooltip. Chữ ở `vi.ts`. */
export function describeSchedule(value: ScheduleValue): string {
  const hour = `${String(value.hour).padStart(2, '0')}:00`;
  if (value.frequency === 'daily') return i18n.t('schedule.describeDaily', { hour });
  if (value.frequency === 'weekly') {
    const weekday = WEEKDAYS.find((d) => d.value === (value.weekday ?? 1)) ?? WEEKDAYS[0];
    return i18n.t('schedule.describeWeekly', { day: i18n.t(weekday.labelKey), hour });
  }
  return i18n.t('schedule.describeMonthly', { day: value.dayOfMonth ?? 1, hour });
}
