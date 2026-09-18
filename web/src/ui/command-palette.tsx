import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { visibleGroups } from '@/shell/app-nav';
import { coHopThoaiDangMo, useCoHopThoaiDangMo } from '@/ui/dialog';

/**
 * Tìm nhanh ⌘K — đường ngắn nhất từ "tôi nhớ mang máng cái mã" tới đúng hồ sơ.
 *
 * VÌ SAO CẦN. Kho thật có hàng trăm thiết bị; muốn mở một máy thì đường duy nhất là vào màn
 * danh sách, gõ ô tìm, chờ bảng vẽ lại, rồi bấm. Với người trực đang cầm điện thoại hỏi "cái
 * SW-CORE-01 ở tủ nào", ba bước đó là ba lần quá nhiều.
 *
 * PHẦN CSS ĐÃ NẰM SẴN TRONG REPO TỪ TRƯỚC. `css/command-palette.css` có đủ 230 dòng và vẫn
 * được `@import` ở `index.css`, nhưng **chưa component nào dùng** — grep `.cp-wrap` trong
 * `web/src` ra rỗng. Tức là bundle vẫn chở nguyên khối CSS chết, còn cái hộp mà `CLAUDE.md`
 * viết như đã có ("shell (sidebar + command palette)") thì chưa từng được dựng. Component này
 * dựng đúng cấu trúc DOM mà file CSS đó chờ, nên không phải viết thêm một dòng CSS nào.
 *
 * TÌM XUYÊN MODULE, KHÔNG CHỈ THIẾT BỊ: mỗi module tự trả kết quả của mình qua đúng endpoint
 * danh sách nó vẫn dùng (`?search=`), nên quyền vẫn do từng module gác (AD-9) và không sinh ra
 * một cửa "tìm tất cả" đứng ngoài luật.
 */

interface Hit {
  group: string;
  title: string;
  sub: string;
  to: string;
  icon: IconKey;
}

type IconKey = 'device' | 'software' | 'isp' | 'account' | 'nav';

const ICON: Record<IconKey, ReactNode> = {
  device: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  software: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </>
  ),
  isp: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
    </>
  ),
  account: (
    <>
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M18 12v4" />
    </>
  ),
  nav: <path d="M4 7h16M4 12h16M4 17h10" />,
};

/** Bảng phân trang chung của API: `{ items, total }`. Dải IP thì trả thẳng mảng. */
interface Page<T> {
  items: T[];
}

export function CommandPalette({ me }: { me: Me }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [at, setAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const openedBy = useRef<Element | null>(null);

  /*
   * Gõ xong 200ms mới hỏi API. Không có bước này thì mỗi phím là BỐN request (thiết bị ·
   * phần mềm · đường truyền · tài khoản), gõ "SW-CORE-01" thành bốn mươi lượt.
   */
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQ(raw.trim()), 200);
    return () => clearTimeout(timer);
  }, [raw]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        /*
         * ĐANG CÓ HỘP THOẠI THÌ KHÔNG MỞ (18/09/2026).
         *
         * Hộp Radix đặt `pointer-events: none` lên `body` và chỉ mở lại cho vùng bên trong
         * `Content`. Palette gắn ở shell, tức NGOÀI vùng ấy — nên khi mở chồng lên một hộp
         * thoại nó thành một lớp phủ chết: `--z-palette` (85) cao hơn `--z-modal` (60) nên
         * nó che kín màn hình, mà `pointer-events` kế thừa `none` nên không bấm được, tiêu
         * điểm vẫn nằm trong hộp thoại nên gõ không vào ô tìm, và Esc rơi xuống đóng nhầm
         * hộp bên dưới. Đo ngày 18/09/2026: gõ "abc" xong giá trị ô tìm vẫn là chuỗi rỗng.
         *
         * Kể cả nếu bấm được thì `go()` gọi thẳng `navigate()`, đi vòng qua `guardUnsaved`
         * của hộp đang mở — mất trắng dữ liệu đang gõ mà không một câu hỏi lại.
         *
         * Không nuốt luôn phím: để `event.preventDefault()` cho nhánh này thì trình duyệt
         * cũng không nhận được Ctrl+K, mà người dùng thì không hiểu vì sao không có gì xảy ra.
         */
        if (!open && coHopThoaiDangMo()) return;
        event.preventDefault();
        // Chỉ ghi chỗ đứng cũ ở nhánh MỞ: lúc đóng, `activeElement` chính là ô tìm sắp bị
        // tháo, ghi lại rồi `.focus()` lên một node đã rời DOM là tiêu điểm rơi về `<body>`.
        if (!open) openedBy.current = document.activeElement;
        setOpen((was) => !was);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  /* Hộp thoại mở ra trong lúc palette đang mở (nút trên một kết quả, một luồng nào đó tự mở
     hộp) — palette phải nhường đường, vì từ giây đó trở đi nó là lớp phủ chết. */
  const coHopThoai = useCoHopThoaiDangMo();
  useEffect(() => {
    if (coHopThoai) setOpen(false);
  }, [coHopThoai]);

  useEffect(() => {
    if (open) {
      setRaw('');
      setQ('');
      setAt(0);
      // Ô tìm phải nhận tiêu điểm ngay, nếu không người dùng gõ vào khoảng không.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (openedBy.current instanceof HTMLElement) {
      // Trả tiêu điểm về đúng chỗ đã mở hộp — cùng luật với `ui/dialog.tsx`.
      openedBy.current.focus();
      openedBy.current = null;
    }
  }, [open]);

  const enabled = open && q.length >= 2;

  const devices = useQuery({
    queryKey: ['palette', 'devices', q],
    queryFn: () =>
      apiFetch<Page<{ id: string; code: string; name: string; siteCode: string | null }>>(
        `/api/v1/devices?page=1&limit=5&search=${encodeURIComponent(q)}`,
      ),
    enabled,
  });
  const software = useQuery({
    queryKey: ['palette', 'software', q],
    queryFn: () =>
      apiFetch<Page<{ id: string; code: string; name: string }>>(
        `/api/v1/software?page=1&limit=4&search=${encodeURIComponent(q)}`,
      ),
    enabled,
  });
  const isp = useQuery({
    queryKey: ['palette', 'isp', q],
    queryFn: () =>
      apiFetch<Page<{ id: string; code: string; provider: string }>>(
        `/api/v1/isp-lines?page=1&limit=3&search=${encodeURIComponent(q)}`,
      ),
    enabled,
  });
  const accounts = useQuery({
    queryKey: ['palette', 'service-accounts', q],
    queryFn: () =>
      apiFetch<Page<{ id: string; code: string; name: string; login: string | null }>>(
        `/api/v1/service-accounts?page=1&limit=3&search=${encodeURIComponent(q)}`,
      ),
    enabled,
  });

  /** Màn hình cũng tìm được — gõ "nat" là nhảy thẳng sang Sổ NAT, khỏi rê chuột xuống sidebar. */
  const navHits = useMemo<Hit[]>(() => {
    if (q.length < 2) return [];
    const needle = q.toLowerCase();
    return visibleGroups(me)
      .flatMap((group) => group.items)
      .filter((item) => !item.planned && t(item.key).toLowerCase().includes(needle))
      .slice(0, 4)
      .map((item) => ({
        group: t('palette.groupNav'),
        title: t(item.key),
        sub: item.to,
        to: item.to,
        icon: 'nav' as const,
      }));
  }, [q, me, t]);

  const hits = useMemo<Hit[]>(() => {
    if (!enabled) return [];
    return [
      ...(devices.data?.items ?? []).map((row) => ({
        group: t('nav.devices'),
        title: row.code,
        sub: [row.name, row.siteCode].filter(Boolean).join(' · '),
        to: PATHS.device(row.id),
        icon: 'device' as const,
      })),
      ...(software.data?.items ?? []).map((row) => ({
        group: t('nav.software'),
        title: row.code,
        sub: row.name,
        to: PATHS.softwareItem(row.id),
        icon: 'software' as const,
      })),
      ...(isp.data?.items ?? []).map((row) => ({
        group: t('nav.isp'),
        title: row.code,
        sub: row.provider,
        to: PATHS.ispLine(row.id),
        icon: 'isp' as const,
      })),
      ...(accounts.data?.items ?? []).map((row) => ({
        group: t('nav.serviceAccounts'),
        title: row.code,
        sub: [row.name, row.login].filter(Boolean).join(' · '),
        to: PATHS.serviceAccount(row.id),
        icon: 'account' as const,
      })),
      ...navHits,
    ];
  }, [enabled, devices.data, software.data, isp.data, accounts.data, navHits, t]);

  useEffect(() => setAt(0), [q]);

  /*
   * GIỮ LỰA CHỌN THEO ĐÍCH ĐẾN, KHÔNG THEO CHỖ NGỒI (18/09/2026).
   *
   * `at` là một CHỈ SỐ vào `hits`, mà `hits` ghép theo thứ tự cố định (thiết bị → phần mềm →
   * ISP → tài khoản → điều hướng) từ bốn truy vấn giải quyết ĐỘC LẬP. `setAt(0)` chỉ chạy lại
   * khi `q` đổi, nên trong lúc người dùng đang chọn thì mảng bên dưới vẫn có thể dài ra.
   *
   * Cảnh hỏng: gõ "core", nhóm Phần mềm về trước (cache, hoặc mạng nhanh hơn), người dùng bấm
   * ↓↓ để chọn dòng thứ ba — đúng lúc đó truy vấn Thiết bị về và CHÈN 5 dòng vào ĐẦU mảng.
   * Enter mở một hồ sơ hoàn toàn khác với dòng đang sáng lúc bấm.
   *
   * Ghi lại `to` của dòng đang chọn rồi tìm lại nó sau mỗi lượt `hits` đổi: dòng cũ còn thì
   * con trỏ bám theo nó, dòng cũ mất thì về đầu danh sách.
   */
  const dangChon = useRef<string | null>(null);
  useEffect(() => {
    dangChon.current = hits[at]?.to ?? null;
  }, [at, hits]);
  useEffect(() => {
    const cu = dangChon.current;
    if (cu === null) return;
    const moi = hits.findIndex((hit) => hit.to === cu);
    setAt(moi >= 0 ? moi : 0);
    // Chỉ chạy khi DANH SÁCH đổi; `at` đổi là do chính người dùng, đừng kéo ngược lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits]);

  if (!open) return null;

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    setOpen(false);
    navigate(hit.to);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setAt((i) => Math.min(i + 1, hits.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setAt((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(hits[at]);
    }
  };

  /*
   * BỐN NHÓM, KHÔNG PHẢI HAI (18/09/2026).
   *
   * `loading` trước đây chỉ đọc `devices` và `software`, bỏ sót `isp` và `accounts` — nên chỉ
   * cần một nhóm về chậm hơn hai nhóm kia là hộp nháy "Không có hồ sơ nào khớp" rồi mới đổ
   * kết quả ra.
   *
   * Nặng hơn là nhánh LỖI: cả bốn nhóm đều `?? []`, nên một lượt 500 hoá thành danh sách rỗng
   * và hộp khẳng định thẳng là không có gì khớp. Đo bằng cách ép `/isp-lines` trả 500: gõ
   * "fpt" ra đúng câu "Không có hồ sơ nào khớp "fpt"" — người trực đọc xong sẽ đi khai trùng
   * một đường truyền đã có trong hệ thống.
   */
  const nhomHong = [
    isp.isError ? t('nav.isp') : null,
    devices.isError ? t('nav.devices') : null,
    software.isError ? t('nav.software') : null,
    accounts.isError ? t('nav.serviceAccounts') : null,
  ].filter((ten): ten is string => ten !== null);
  const loading =
    enabled &&
    (devices.isFetching || software.isFetching || isp.isFetching || accounts.isFetching);
  let lastGroup: string | null = null;

  return (
    <div
      className="cp-wrap"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="cp" role="dialog" aria-modal="true" aria-label={t('palette.title')}>
        <div className="cp-search">
          <span className="cp-search-ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <input
            ref={inputRef}
            type="text"
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.title')}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="cp-list">
          {/* Có kết quả nhưng danh sách KHÔNG đầy đủ — nói ra, đừng để người dùng tin là đã
              thấy hết. `role="status"` để trình đọc màn hình cũng nghe được. */}
          {nhomHong.length > 0 && hits.length > 0 ? (
            <p className="cp-warn" role="status">
              {t('palette.partial', { list: nhomHong.join(', ') })}
            </p>
          ) : null}
          {q.length < 2 ? (
            <div className="cp-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <p>{t('palette.hint')}</p>
            </div>
          ) : hits.length === 0 ? (
            <div className="cp-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <p>
                {loading
                  ? t('app.loading')
                  : nhomHong.length > 0
                    ? t('palette.emptyPartial', { list: nhomHong.join(', '), q })
                    : t('palette.empty', { q })}
              </p>
            </div>
          ) : (
            hits.map((hit, index) => {
              const head = hit.group !== lastGroup ? hit.group : null;
              lastGroup = hit.group;
              return (
                <div key={`${hit.to}-${index}`} className={head ? 'cp-group' : undefined}>
                  {head ? <p className="cp-group-title">{head}</p> : null}
                  <button
                    type="button"
                    className={`cp-item${index === at ? ' active' : ''}`}
                    onMouseEnter={() => setAt(index)}
                    onClick={() => go(hit)}
                  >
                    <span className="it-ic">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                        {ICON[hit.icon]}
                      </svg>
                    </span>
                    <span className="it-name">
                      <b>{hit.title}</b>
                      <span>{hit.sub}</span>
                    </span>
                    <span className="it-arrow">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="m10 6 6 6-6 6" />
                      </svg>
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="cp-foot">
          <span className="fh">
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t('palette.footMove')}
          </span>
          <span className="fh">
            <kbd>↵</kbd> {t('palette.footOpen')}
          </span>
          <span className="fh">
            <kbd>Esc</kbd> {t('palette.footClose')}
          </span>
        </div>
      </div>
    </div>
  );
}
