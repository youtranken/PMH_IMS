import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PATHS } from '@/lib/routes';
import { Chevron } from '@/ui/chevron';
import { monthKey, monthLabel, shiftMonth } from './iso-rules';
import {
  PERIOD_STATE_KEY,
  PERIOD_STATE_TONE,
  type FormOwners,
  type IsoFormType,
  type PeriodDisplayState,
} from './iso-types';

/** ‹ Tháng mm/yyyy › — tháng sau tháng hiện tại không mở được (kỳ tương lai không có gì để ghi). */
export function MonthNav({
  year,
  month,
  today,
  onChange,
}: {
  year: number;
  month: number;
  today: string;
  onChange: (next: { year: number; month: number }) => void;
}) {
  const { t } = useTranslation();
  const next = shiftMonth(year, month, 1);
  const atLatest = monthKey(next.year, next.month) > today.slice(0, 7);
  return (
    <div className="sheet-month" role="group" aria-label={t('iso.month')}>
      <button type="button" className="btn sm ghost" aria-label={t('iso.prevMonth')} onClick={() => onChange(shiftMonth(year, month, -1))}>
        <Chevron direction="left" />
      </button>
      <span className="sheet-month-label">{t('iso.monthOf', { month: monthLabel(year, month) })}</span>
      <button type="button" className="btn sm ghost" aria-label={t('iso.nextMonth')} disabled={atLatest} onClick={() => onChange(next)}>
        <Chevron direction="right" />
      </button>
    </div>
  );
}

export function PeriodStateBadge({ state }: { state: PeriodDisplayState }) {
  const { t } = useTranslation();
  return <span className={`badge ${PERIOD_STATE_TONE[state]}`}>{t(PERIOD_STATE_KEY[state])}</span>;
}

/** Dải "Đã chốt · chỉ xem" của kỳ từ Chờ duyệt trở đi — ô không bấm được, không có nút gửi chốt. */
export function LockedBanner({ form, year, month, state }: { form: IsoFormType; year: number; month: number; state: PeriodDisplayState }) {
  const { t } = useTranslation();
  return (
    <div className="alert info" role="status">
      <div>
        <strong>{t('iso.lockedTitle', { month: monthLabel(year, month), state: t(PERIOD_STATE_KEY[state]) })}</strong>{' '}
        <span>{t('iso.lockedHint')}</span>
      </div>
      <Link to={PATHS.isoPeriod(form, monthKey(year, month))}>{t('iso.openPeriods')}</Link>
    </div>
  );
}

/** Người không phụ trách thấy phiếu chỉ xem, kèm lý do (Q-28). */
export function OwnerNotice({ form, owners }: { form: IsoFormType; owners: FormOwners | undefined }) {
  const { t } = useTranslation();
  if (!owners) return null;
  const names = [owners.primary?.fullName, owners.backup?.fullName].filter(Boolean).join(', ');
  return (
    <p className="alert warn" role="note">
      {names ? t('iso.readOnlyOwners', { form, names }) : t('iso.noOwner', { form })}
    </p>
  );
}

const STEP_KEYS: PeriodDisplayState[] = ['open', 'pending', 'locked', 'done'];

/** Thanh 4 bước của kỳ: Đang ghi → Chờ duyệt → Đã chốt · chờ bản ký → Hoàn tất. */
export function PeriodSteps({ state }: { state: PeriodDisplayState }) {
  const { t } = useTranslation();
  const at = STEP_KEYS.indexOf(state);
  return (
    <ol className="sheet-steps" aria-label={t('iso.steps')}>
      {STEP_KEYS.map((key, i) => (
        <li key={key} data-done={i < at ? '' : undefined} aria-current={i === at ? 'step' : undefined}>
          {t(PERIOD_STATE_KEY[key])}
        </li>
      ))}
    </ol>
  );
}
