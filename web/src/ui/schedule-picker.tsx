import { useTranslation } from 'react-i18next';

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

const WEEKDAYS = [
  { value: 1, label: 'Thứ Hai' },
  { value: 2, label: 'Thứ Ba' },
  { value: 3, label: 'Thứ Tư' },
  { value: 4, label: 'Thứ Năm' },
  { value: 5, label: 'Thứ Sáu' },
  { value: 6, label: 'Thứ Bảy' },
  { value: 7, label: 'Chủ Nhật' },
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

  return (
    <div className="row" role="group" aria-label={t('common.filter')}>
      <div className="field">
        <label className="lbl-t" htmlFor={`${idPrefix}-freq`}>
          Tần suất
        </label>
        <select
          id={`${idPrefix}-freq`}
          className="inp pick"
          value={value.frequency}
          onChange={(e) =>
            onChange({ ...value, frequency: e.target.value as ScheduleFrequency })
          }
        >
          <option value="daily">{t('schedule.daily')}</option>
          <option value="weekly">{t('schedule.weekly')}</option>
          <option value="monthly">{t('schedule.monthly')}</option>
        </select>
      </div>

      {value.frequency === 'weekly' ? (
        <div className="field">
          <label className="lbl-t" htmlFor={`${idPrefix}-weekday`}>
            Vào thứ
          </label>
          <select
            id={`${idPrefix}-weekday`}
            className="inp pick"
            value={value.weekday ?? 1}
            onChange={(e) => onChange({ ...value, weekday: Number(e.target.value) })}
          >
            {WEEKDAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {value.frequency === 'monthly' ? (
        <div className="field">
          <label className="lbl-t" htmlFor={`${idPrefix}-dom`}>
            Ngày trong tháng
          </label>
          <select
            id={`${idPrefix}-dom`}
            className="inp pick"
            value={value.dayOfMonth ?? 1}
            onChange={(e) => onChange({ ...value, dayOfMonth: Number(e.target.value) })}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                Ngày {d}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="field">
        <label className="lbl-t" htmlFor={`${idPrefix}-hour`}>
          Lúc
        </label>
        <select
          id={`${idPrefix}-hour`}
          className="inp pick"
          value={value.hour}
          onChange={(e) => onChange({ ...value, hour: Number(e.target.value) })}
        >
          {Array.from({ length: 24 }, (_, h) => h).map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, '0')}:00
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Mô tả lịch bằng tiếng Việt — dùng ở bảng danh sách luật, email, tooltip. */
export function describeSchedule(value: ScheduleValue): string {
  const hour = `${String(value.hour).padStart(2, '0')}:00`;
  if (value.frequency === 'daily') return `Hằng ngày lúc ${hour}`;
  if (value.frequency === 'weekly') {
    const day = WEEKDAYS.find((d) => d.value === (value.weekday ?? 1))?.label ?? 'Thứ Hai';
    return `Hằng tuần, ${day} lúc ${hour}`;
  }
  return `Hằng tháng, ngày ${value.dayOfMonth ?? 1} lúc ${hour}`;
}
