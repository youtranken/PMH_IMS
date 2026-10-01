import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { orDash } from '@/lib/format';
import { parseIpv4, subnetOf } from '@/lib/ipv4';
import { PATHS } from '@/lib/routes';
import { CloseIcon } from '@/ui/glyph-icons';
import { LoadError, Loading } from '@/ui/load-state';
import type { IpSearchHit, SubnetRow } from './ipam-types';

/**
 * Ô "Tra IP hoặc máy…" cấp trang — trả lời câu hay gặp nhất mà không phải đoán dải rồi lật
 * trang: "10.77.1.53 là của ai" và "máy CAM-01 đang giữ những IP nào".
 *
 * Gõ đủ một IP: mở thẳng dải chứa nó ở đúng dòng (kể cả khi địa chỉ đang trống — tra dải bằng
 * phép tính CIDR phía web, không cần hồ sơ). Gõ thứ khác: hỏi `GET ipam/addresses?search=`
 * rồi liệt kê mọi IP khớp, mỗi dòng dẫn về đúng chỗ của nó.
 *
 * Câu chỉ gồm số và dấu chấm (có ít nhất một chấm) là người ta ĐANG gõ IP: sai dạng (thiếu phần,
 * phần > 255) thì báo lỗi đỏ ngay dưới ô và không tìm (Q-20) — gửi đi tìm theo máy thì chỉ ra
 * "không có hồ sơ nào khớp", và người gõ "172.16.1100.10" không biết mình gõ sai ở đâu.
 */
export function IpLookup({ subnets }: { subnets: SubnetRow[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [asked, setAsked] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  /** Lỗi tra IP (sai dạng, không dải nào chứa): khung đỏ, người dùng tự đóng. */
  const [problem, setProblem] = useState<string | null>(null);

  const hits = useQuery({
    queryKey: ['ipam', 'lookup', asked],
    queryFn: () =>
      apiFetch<IpSearchHit[]>(
        `/api/v1/ipam/addresses?limit=50&search=${encodeURIComponent(asked)}`,
      ),
    enabled: asked.length >= 2,
  });

  return (
    <>
      <form
        className="filter-bar"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const q = term.trim();
          setMessage(null);
          setProblem(null);
          if (parseIpv4(q) !== null) {
            setAsked('');
            // Chỉ dải còn dùng: dải đã vô hiệu thì bảng chỉ đọc, cấp không được.
            const subnet = subnetOf(q, subnets.filter((s) => s.voidedAt === null));
            if (subnet) navigate(PATHS.subnetAt(subnet.id, q));
            else setProblem(t('ipam.lookupNoSubnet', { ip: q }));
            return;
          }
          if (/^[\d.]+$/.test(q) && q.includes('.')) {
            setAsked('');
            setProblem(t('ipam.lookupInvalid'));
            return;
          }
          if (q.length < 2) {
            setAsked('');
            setMessage(t('ipam.lookupTooShort'));
            return;
          }
          setAsked(q);
        }}
      >
        <input
          className="inp search grow"
          type="search"
          value={term}
          placeholder={t('ipam.lookup')}
          aria-label={t('ipam.lookup')}
          title={t('ipam.lookupHint')}
          onChange={(event) => {
            setTerm(event.target.value);
            // Khung lỗi / câu nhắc nói về câu VỪA tra: sửa ô là chữ đó không còn trên màn.
            setProblem(null);
            setMessage(null);
          }}
        />
        <button type="submit" className="btn">
          {t('ipam.lookupButton')}
        </button>
      </form>

      {problem ? (
        <div className="alert error dismissible" role="alert">
          <span className="grow">{problem}</span>
          <button
            type="button"
            className="ghost alert-close"
            aria-label={t('ipam.lookupDismiss')}
            onClick={() => setProblem(null)}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}

      {message ? (
        <p className="alert" role="status">
          {message}
        </p>
      ) : null}

      {asked ? (
        <section className="card section-gap" aria-label={t('ipam.lookupResults', { q: asked })}>
          <div className="row">
            <h2 className="form-section-title grow">{t('ipam.lookupResults', { q: asked })}</h2>
            <button type="button" className="btn sm" onClick={() => setAsked('')}>
              {t('common.close')}
            </button>
          </div>
          {hits.isLoading ? (
            <Loading />
          ) : hits.isError ? (
            <LoadError error={hits.error} onRetry={() => void hits.refetch()} />
          ) : (hits.data ?? []).length === 0 ? (
            <p className="muted">{t('ipam.lookupEmpty', { q: asked })}</p>
          ) : (
            <div className="table-wrap">
              <table className="table table-stack">
                <thead>
                  <tr>
                    <th>{t('ipam.address')}</th>
                    <th>{t('ipam.device')}</th>
                    <th>{t('ipam.usedBy')}</th>
                    <th>{t('ipam.cidr')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(hits.data ?? []).map((hit) => (
                    <tr key={hit.id}>
                      <td data-label={t('ipam.address')}>
                        <Link
                          className="mono"
                          to={PATHS.subnetAt(hit.subnetId, hit.address)}
                          onClick={() => setAsked('')}
                        >
                          {hit.address}
                        </Link>
                      </td>
                      <td data-label={t('ipam.device')}>
                        {hit.deviceCode ? (
                          <>
                            <span className="mono">{hit.deviceCode}</span>
                            {hit.deviceName ? (
                              <span className="cell-sub">{hit.deviceName}</span>
                            ) : null}
                          </>
                        ) : hit.status === 'free' ? (
                          t('ipam.lookupFree')
                        ) : (
                          '—'
                        )}
                      </td>
                      <td data-label={t('ipam.usedBy')}>{orDash(hit.usedBy)}</td>
                      <td data-label={t('ipam.cidr')}>
                        {hit.subnetName} <span className="mono cell-sub">{hit.subnetCidr}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
