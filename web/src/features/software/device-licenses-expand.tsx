import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';
import { TableWrap } from '@/ui/data-table';
import { PerpetualBadge } from '@/ui/perpetual-badge';
import { SeatEndCell } from './seat-cells';
import type { InstalledLicense } from './software-types';
import { PATHS } from '@/lib/routes';

/**
 * Máy này đang cài license nào, kỳ hạn và chi phí của chính chỗ ngồi đó — thân của khu bung
 * dòng ở danh sách thiết bị (trong `ExpandPanel`) và của khu "License đang cài" ở trang chi
 * tiết (khu đó đã có tiêu đề riêng, nên component này KHÔNG tự vẽ đầu khu).
 *
 * File nằm trong `features/software` chứ không phải `features/devices`, đúng nếp mà phía API
 * đã theo (`SoftwareDevicePanel` tự đăng ký vào sổ của `devices`): license là chuyện của
 * module software, `devices` không cần biết license là gì.
 *
 * Là `<table>` thật kiểu bảng con (`table-sub`), cùng kiểu với bảng ghế ở khu bung /software
 * (Q-20): trình đọc màn hình gắn được tiêu đề cột, và hai khu bung trông như một. Cột nào mọi
 * dòng đều trống (chi phí, bắt đầu, hợp đồng/ghi chú) thì không vẽ — cột toàn "—" chỉ làm bảng
 * rộng ra trong khu hẹp của trang chi tiết.
 */
export function DeviceLicensesExpand({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation();

  const installed = useQuery({
    queryKey: ['software', 'installed', deviceId],
    queryFn: () => apiFetch<InstalledLicense[]>(`/api/v1/software/installed/${deviceId}`),
  });

  const rows = installed.data ?? [];
  const hasCost = rows.some((item) => item.cost !== null);
  const hasStart = rows.some((item) => item.startDate);
  const hasNotes = rows.some((item) => item.contract || item.note);

  if (installed.isLoading) return <p className="muted">{t('app.loading')}</p>;
  if (installed.isError) return <p className="muted">{t('app.loadError')}</p>;
  if (rows.length === 0) return <p className="seat-empty">{t('devices.noInstalled')}</p>;

  return (
    <TableWrap>
      <table className="table table-stack table-sub">
        <thead>
          <tr>
            <th>{t('devices.software')}</th>
            <th>{t('software.licenseModel')}</th>
            {hasCost ? <th className="num">{t('license.cost')}</th> : null}
            {hasStart ? <th>{t('license.startDate')}</th> : null}
            <th>{t('license.endDate')}</th>
            {hasNotes ? <th>{t('license.contractNote')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <tr key={item.id}>
              {/* TÊN là dòng chính (người ta tìm "Windows 11", không tìm "LIC-…"), mã là dòng
                  phụ mono — vẫn là link sang hồ sơ phần mềm. */}
              <td data-label={t('devices.software')}>
                <span>{item.softwareName}</span>
                <span className="cell-sub">
                  <Link className="mono" to={PATHS.softwareItem(item.softwareId)}>
                    {item.softwareCode}
                  </Link>
                </span>
              </td>
              <td data-label={t('software.licenseModel')}>
                {item.licenseModel === 'perpetual' ? (
                  <PerpetualBadge />
                ) : (
                  <span className="muted">{t('software.subscription')}</span>
                )}
              </td>
              {hasCost ? (
                <td
                  className="num"
                  data-label={t('license.cost')}
                  data-empty={item.cost === null ? true : undefined}
                >
                  {formatMoney(item.cost)}
                </td>
              ) : null}
              {hasStart ? (
                <td data-label={t('license.startDate')} data-empty={item.startDate ? undefined : true}>
                  {item.startDate ? formatDate(item.startDate) : '—'}
                </td>
              ) : null}
              {/* Mua đứt: cột Kỳ hạn đã nói "Vĩnh viễn" — nói lần hai ở cột Kết thúc là nhiễu. */}
              <td
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
              </td>
              {hasNotes ? (
                <td
                  data-label={t('license.contractNote')}
                  data-empty={item.contract || item.note ? undefined : true}
                >
                  {item.contract ? <span className="mono">{item.contract}</span> : null}
                  {item.note ? <span className="cell-sub">{item.note}</span> : null}
                  {item.contract || item.note ? null : '—'}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
