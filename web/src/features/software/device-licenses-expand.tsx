import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { formatDate, formatMoney, orDash } from '@/lib/format';
import { SeatEndCell } from './seat-cells';
import type { InstalledLicense } from './software-types';
import { PATHS } from '@/lib/routes';

/**
 * Khu bung ra dưới một dòng THIẾT BỊ: máy này đang cài license nào, kỳ hạn và chi phí của
 * chính chỗ ngồi đó (nếp `seat-list` của code nền QLTS, AD-12).
 *
 * File nằm trong `features/software` chứ không phải `features/devices`, đúng nếp mà phía API
 * đã theo (`SoftwareDevicePanel` tự đăng ký vào sổ của `devices`): license là chuyện của
 * module software, `devices` không cần biết license là gì.
 *
 * Để câu "máy này đang cài gì" trả lời được ngay trên danh sách — chỉ có ở TRANG CHI TIẾT
 * thì nhìn danh sách 20 dòng phải bấm vào 20 lần.
 */
export function DeviceLicensesExpand({
  deviceId,
  showHeader = true,
}: {
  deviceId: string;
  /**
   * `false` khi khu đã có tiêu đề riêng (trang chi tiết thiết bị): hai tiêu đề chồng nhau
   * "License đang cài" / "Phần mềm đang cài (3)" đọc như hai khu khác nhau.
   */
  showHeader?: boolean;
}) {
  const { t } = useTranslation();

  const installed = useQuery({
    queryKey: ['software', 'installed', deviceId],
    queryFn: () => apiFetch<InstalledLicense[]>(`/api/v1/software/installed/${deviceId}`),
  });

  const rows = installed.data ?? [];
  /* Cột "Bắt đầu" toàn "—" thì bỏ hẳn: một cột rỗng chiếm 108px trong khi tên phần mềm bị cắt. */
  const hasStart = rows.some((item) => item.startDate);

  return (
    <div className="exp-soft">
      {showHeader ? (
        <div className="seat-head">
          <span>{t('devices.installedHeader', { count: rows.length })}</span>
        </div>
      ) : null}

      {installed.isLoading ? (
        <p className="muted">{t('app.loading')}</p>
      ) : installed.isError ? (
        <p className="muted">{t('app.loadError')}</p>
      ) : rows.length === 0 ? (
        <p className="seat-empty">{t('devices.noInstalled')}</p>
      ) : (
        <div className={hasStart ? 'seat-list inst-list' : 'seat-list inst-list no-start'}>
          <div className="seat-hd">
            <span>{t('devices.software')}</span>
            <span>{t('software.licenseModel')}</span>
            <span>{t('license.cost')}</span>
            {hasStart ? <span>{t('license.startDate')}</span> : null}
            <span>{t('license.endDate')}</span>
            <span>{t('license.contract')}</span>
            <span>{t('license.note')}</span>
          </div>
          {rows.map((item) => (
            <div key={item.id} className="seat-card">
              {/* TÊN là dòng chính (người ta tìm "Windows 11", không tìm "LIC-…"), mã là dòng
                  phụ mono — vẫn là link sang hồ sơ phần mềm. */}
              <div className="seat-mc seat-mc-stack" data-label={t('devices.software')}>
                <span className="seat-who" title={item.softwareName}>
                  {item.softwareName}
                </span>
                <Link className="mono seat-code" to={PATHS.softwareItem(item.softwareId)}>
                  {item.softwareCode}
                </Link>
              </div>
              <div data-label={t('software.licenseModel')}>
                {item.licenseModel === 'perpetual' ? (
                  <span className="badge outline plain">∞ {t('software.perpetual')}</span>
                ) : (
                  <span className="muted">{t('software.subscription')}</span>
                )}
              </div>
              <div className="seat-cost" data-label={t('license.cost')}>
                {formatMoney(item.cost)}
              </div>
              {hasStart ? (
                <div
                  className="seat-date"
                  data-label={t('license.startDate')}
                  data-empty={item.startDate ? undefined : true}
                >
                  {item.startDate ? formatDate(item.startDate) : '—'}
                </div>
              ) : null}
              {/* Mua đứt: cột Kỳ hạn đã nói "Vĩnh viễn" — nói lần hai ở cột Kết thúc là nhiễu. */}
              <div
                className="seat-date"
                data-label={t('license.endDate')}
                data-empty={item.licenseModel === 'perpetual' ? true : undefined}
              >
                {item.licenseModel === 'perpetual' ? (
                  <span className="muted">—</span>
                ) : (
                  <SeatEndCell
                    seat={item}
                    licenseModel={item.licenseModel}
                    fallbackEnd={item.softwareEndDate}
                  />
                )}
              </div>
              <div
                className="seat-note"
                data-label={t('license.contract')}
                data-empty={item.contract ? undefined : true}
                title={item.contract ?? undefined}
              >
                {orDash(item.contract)}
              </div>
              <div
                className="seat-note"
                data-label={t('license.note')}
                data-empty={item.note ? undefined : true}
                title={item.note ?? undefined}
              >
                {orDash(item.note)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
