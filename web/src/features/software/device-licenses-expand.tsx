import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { formatDate, formatMoney, orDash } from '@/lib/format';
import { SeatEndCell } from './seat-cells';
import type { InstalledLicense } from './software-types';

/**
 * Khu bung ra dưới một dòng THIẾT BỊ: máy này đang cài license nào, kỳ hạn và chi phí của
 * chính chỗ ngồi đó (nếp `seat-list` của code nền QLTS, AD-12).
 *
 * File nằm trong `features/software` chứ không phải `features/devices`, đúng nếp mà phía API
 * đã theo (`SoftwareDevicePanel` tự đăng ký vào sổ của `devices`): license là chuyện của
 * module software, `devices` không cần biết license là gì.
 *
 * Trước đây câu "máy này đang cài gì" chỉ trả lời được ở TRANG CHI TIẾT của từng máy — nhìn
 * danh sách 20 dòng thì phải bấm vào 20 lần.
 */
export function DeviceLicensesExpand({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation();

  const installed = useQuery({
    queryKey: ['software', 'installed', deviceId],
    queryFn: () => apiFetch<InstalledLicense[]>(`/api/v1/software/installed/${deviceId}`),
  });

  const rows = installed.data ?? [];

  return (
    <div className="exp-soft">
      <div className="seat-head">
        <span>{t('devices.installedHeader', { count: rows.length })}</span>
      </div>

      {installed.isLoading ? (
        <p className="muted">{t('app.loading')}</p>
      ) : installed.isError ? (
        <p className="muted">{t('app.loadError')}</p>
      ) : rows.length === 0 ? (
        <p className="seat-empty">{t('devices.noInstalled')}</p>
      ) : (
        <div className="seat-list inst-list">
          <div className="seat-hd">
            <span>{t('devices.software')}</span>
            <span>{t('software.licenseModel')}</span>
            <span>{t('license.cost')}</span>
            <span>{t('license.startDate')}</span>
            <span>{t('license.endDate')}</span>
            <span>{t('license.contract')}</span>
            <span>{t('license.note')}</span>
          </div>
          {rows.map((item) => (
            <div key={item.id} className="seat-card">
              <div className="seat-mc" data-label={t('devices.software')}>
                <Link className="mono" to={`/phan-mem/${item.softwareId}`}>
                  {item.softwareCode}
                </Link>
                <span className="seat-who">{item.softwareName}</span>
              </div>
              <div data-label={t('software.licenseModel')}>
                {item.licenseModel === 'perpetual' ? (
                  <span className="badge ok plain">{t('software.perpetual')}</span>
                ) : (
                  <span className="muted">{t('software.subscription')}</span>
                )}
              </div>
              <div className="seat-cost" data-label={t('license.cost')}>
                {formatMoney(item.cost)}
              </div>
              <div className="seat-date" data-label={t('license.startDate')}>
                {item.startDate ? formatDate(item.startDate) : '—'}
              </div>
              <div className="seat-date" data-label={t('license.endDate')}>
                <SeatEndCell
                  seat={item}
                  licenseModel={item.licenseModel}
                  fallbackEnd={item.softwareEndDate}
                />
              </div>
              <div
                className="seat-note"
                data-label={t('license.contract')}
                title={item.contract ?? undefined}
              >
                {orDash(item.contract)}
              </div>
              <div className="seat-note" data-label={t('license.note')} title={item.note ?? undefined}>
                {orDash(item.note)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
