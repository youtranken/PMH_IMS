import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { visibleGroups } from '@/shell/app-nav';
import { isAnyDialogOpen, useAnyDialogOpen } from '@/ui/dialog';
import { foldSearch } from '@/lib/search-fold';
import { looksLikeIp, parseIpv4, subnetOf } from '@/lib/ipv4';

/**
 * Tìm nhanh ⌘K — đường ngắn nhất từ "tôi nhớ mang máng cái mã" tới đúng hồ sơ.
 *
 * VÌ SAO CẦN. Kho thật có hàng trăm thiết bị; muốn mở một máy thì đường duy nhất là vào màn
 * danh sách, gõ ô tìm, chờ bảng vẽ lại, rồi bấm. Với người trực đang cầm điện thoại hỏi "cái
 * SW-CORE-01 ở tủ nào", ba bước đó là ba lần quá nhiều.
 *
 * PHẦN CSS ĐÃ NẰM SẴN TRONG REPO TỪ TRƯỚC. `css/command-palette.css` có đủ 275 dòng và vẫn
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

type IconKey = 'device' | 'software' | 'isp' | 'account' | 'ip' | 'subnet' | 'nav';

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
  ip: (
    <>
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <path d="M7 11v2M10 11v2M14 11h3" />
    </>
  ),
  subnet: (
    <>
      <rect x="9" y="3" width="6" height="5" rx="1" />
      <rect x="3" y="16" width="6" height="5" rx="1" />
      <rect x="15" y="16" width="6" height="5" rx="1" />
      <path d="M12 8v4M6 16v-4h12v4" />
    </>
  ),
  nav: <path d="M4 7h16M4 12h16M4 17h10" />,
};

/** Một hồ sơ IP khớp — `GET ipam/addresses?search=` trả kèm dải chứa nó. */
interface IpHit {
  id: string;
  subnetId: string;
  address: string;
  deviceCode: string | null;
  usedBy: string | null;
  subnetName: string;
  subnetCidr: string;
}

interface SubnetHit {
  id: string;
  name: string;
  cidr: string;
  vlan: number | null;
  voidedAt: string | null;
}

/** Nhận "vlan 20", "VLAN20" hay chỉ "20" — ở PMH người ta gọi dải theo VLAN. */
function vlanOf(q: string): number | null {
  const match = /^(?:vlan\s*)?(\d{1,4})$/i.exec(q.trim());
  return match ? Number(match[1]) : null;
}

/** Hai endpoint IPAM trả thẳng mảng; bảo hiểm cho một phản hồi lạ để hộp không vỡ cả khối. */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Bảng phân trang chung của API: `{ items, total }`. Dải IP thì trả thẳng mảng. */
interface Page<T> {
  items: T[];
}

/**
 * Tên sự kiện để MỞ hộp tìm nhanh từ nơi khác (nút trên topbar).
 *
 * ===== VÌ SAO LÀ SỰ KIỆN, KHÔNG PHẢI KÉO STATE LÊN SHELL =====
 *
 * Tới 18/09/2026 hộp này chỉ mở được bằng ⌘K/Ctrl+K. Trên điện thoại — nơi UX-DR2 bắt màn ĐỌC
 * phải dùng được ở 390px — không có phím tắt, nên tính năng KHÔNG TỒN TẠI; với người dùng
 * chuột thì nó tồn tại nhưng không ai biết, vì không có gì trên màn hình nói ra.
 *
 * Kéo `open` lên `AppShell` thì shell phải giữ state của một thứ nó không sở hữu, và mọi màn
 * render lại theo. Một sự kiện trên `window` giữ nguyên ranh giới: nút chỉ biết "tôi xin mở",
 * hộp vẫn là chủ state của chính nó.
 */
export const OPEN_PALETTE_EVENT = 'ims:open-command-palette';

/** Mở hộp tìm nhanh từ bất kỳ đâu. Dùng ở nút tìm trên topbar. */
export function openCommandPalette(): void {
  window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));
}

export function CommandPalette({ me }: { me: Me }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [at, setAt] = useState(0);
  /** Đích đến của dòng đang chọn. Khai ở đây vì hai lượt đặt lại `at` về 0 nằm phía trên chỗ
      dùng chính — xem khối chú thích dài ở `select()` bên dưới. */
  const anchoredTo = useRef<string | null>(null);
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
        if (!open && isAnyDialogOpen()) return;
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

  /* Nút tìm trên topbar xin mở. Cùng hàng rào với phím tắt: đang có hộp thoại thì không mở. */
  useEffect(() => {
    const onOpen = () => {
      if (isAnyDialogOpen()) return;
      openedBy.current = document.activeElement;
      setOpen(true);
    };
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
  }, []);

  /* Hộp thoại mở ra trong lúc palette đang mở (nút trên một kết quả, một luồng nào đó tự mở
     hộp) — palette phải nhường đường, vì từ giây đó trở đi nó là lớp phủ chết. */
  const dialogOpen = useAnyDialogOpen();
  useEffect(() => {
    if (dialogOpen) setOpen(false);
  }, [dialogOpen]);

  useEffect(() => {
    if (open) {
      setRaw('');
      setQ('');
      anchoredTo.current = null;
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

  /*
   * Địa chỉ IP: "10.77.30.5 là máy nào" — hỏi xuyên mọi dải. Dải mạng: danh sách nhỏ (vài chục
   * dải), tải một lần rồi lọc tại chỗ theo tên / VLAN / CIDR, và để tra dải chứa một IP còn
   * trống (chưa có hồ sơ nên endpoint IP không trả gì).
   */
  const ipAddresses = useQuery({
    queryKey: ['palette', 'ip', q],
    queryFn: () =>
      apiFetch<IpHit[]>(`/api/v1/ipam/addresses?limit=5&search=${encodeURIComponent(q)}`),
    enabled,
  });
  const subnets = useQuery({
    queryKey: ['palette', 'subnets'],
    queryFn: () => apiFetch<SubnetHit[]>('/api/v1/ipam/subnets'),
    enabled,
    staleTime: 60_000,
  });
  const ipFirst = looksLikeIp(q);

  const ipHits = useMemo<Hit[]>(() => {
    if (!enabled) return [];
    const group = t('palette.groupIp');
    const found = asArray<IpHit>(ipAddresses.data).map((row) => ({
      group,
      title: t('palette.ipTitle', { address: row.address }),
      sub: t('palette.ipSub', {
        owner: row.deviceCode ?? row.usedBy ?? t('ipam.statusFree'),
        subnet: `${row.subnetName} (${row.subnetCidr})`,
      }),
      to: PATHS.subnetAt(row.subnetId, row.address),
      icon: 'ip' as const,
    }));
    // IP đủ bốn khúc mà chưa có hồ sơ: vẫn chỉ ra dải chứa nó — đó là chỗ để cấp.
    if (found.length === 0 && parseIpv4(q) !== null) {
      const live = asArray<SubnetHit>(subnets.data).filter((s) => s.voidedAt === null);
      const home = subnetOf(q, live);
      if (home) {
        found.push({
          group,
          title: t('palette.ipTitle', { address: q }),
          sub: t('palette.ipSub', {
            owner: t('ipam.statusFree'),
            subnet: `${home.name} (${home.cidr})`,
          }),
          to: PATHS.subnetAt(home.id, q),
          icon: 'ip' as const,
        });
      }
    }
    return found;
  }, [enabled, ipAddresses.data, subnets.data, q, t]);

  const subnetHits = useMemo<Hit[]>(() => {
    if (!enabled) return [];
    const needle = foldSearch(q);
    const vlan = vlanOf(q);
    const ip = parseIpv4(q) !== null ? q : null;
    const cidrPrefix = q.replace(/\/.*$/, '');
    return asArray<SubnetHit>(subnets.data)
      .filter((s) => s.voidedAt === null)
      .filter(
        (s) =>
          foldSearch(s.name).includes(needle) ||
          (vlan !== null && s.vlan === vlan) ||
          (ipFirst && s.cidr.startsWith(cidrPrefix)) ||
          (ip !== null && subnetOf(ip, [s]) !== null),
      )
      .slice(0, 4)
      .map((s) => ({
        group: t('palette.groupSubnet'),
        title: s.cidr,
        sub: [s.name, s.vlan !== null ? t('ipam.vlanBadge', { vlan: s.vlan }) : null]
          .filter(Boolean)
          .join(' · '),
        to: PATHS.subnet(s.id),
        icon: 'subnet' as const,
      }));
  }, [enabled, subnets.data, q, ipFirst, t]);

  /** Màn hình cũng tìm được — gõ "nat" là nhảy thẳng sang Sổ NAT, khỏi rê chuột xuống sidebar. */
  const navHits = useMemo<Hit[]>(() => {
    if (q.length < 2) return [];
    // Gấp dấu cả hai vế (B-01): nhãn màn hình là tiếng Việt có dấu ("Thiết bị", "Sổ NAT"),
    // nên gõ `thiet` phải nhảy được sang màn Thiết bị.
    const needle = foldSearch(q);
    return visibleGroups(me)
      .flatMap((group) => group.items)
      .filter((item) => !item.planned && foldSearch(t(item.key)).includes(needle))
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
    // Câu gõ có dáng IP/CIDR thì người hỏi đang tra mạng: IP và dải lên đầu.
    const network = [...ipHits, ...subnetHits];
    return [
      ...(ipFirst ? network : []),
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
      ...(ipFirst ? [] : network),
      ...navHits,
    ];
  }, [
    enabled,
    devices.data,
    software.data,
    isp.data,
    accounts.data,
    ipHits,
    subnetHits,
    ipFirst,
    navHits,
    t,
  ]);

  /* Đổi từ khoá = bỏ neo. Giữ neo lại thì effect khôi phục bên dưới sẽ kéo con trỏ về dòng của
     từ khoá CŨ ngay khi kết quả mới về — người dùng gõ từ mới mà con trỏ đứng ở dòng 8. */
  useEffect(() => {
    anchoredTo.current = null;
    setAt(0);
  }, [q]);

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
   *
   * ───────────────────────────────────────────────────────────────────────────────────────
   * GHI NEO Ở NƠI NGƯỜI DÙNG ĐỔI LỰA CHỌN, KHÔNG GHI TRONG EFFECT (19/09/2026).
   *
   * Bản 18/09 dựng đúng ý tưởng trên nhưng đấu dây sai, thành một no-op hoàn chỉnh: neo được
   * ghi trong một `useEffect([at, hits])` khai TRƯỚC effect khôi phục. React chạy effect theo
   * thứ tự khai trong cùng một commit, nên khi `hits` đổi thì effect ghi chạy trước — với
   * `hits` MỚI và `at` CŨ — và đè neo thành phần tử ở đúng CHỖ NGỒI cũ. Effect khôi phục sau đó
   * đi tìm chính giá trị vừa bị đè, thấy nó ở đúng chỉ số cũ, rồi `setAt` một con số không
   * đổi. Cảnh hỏng mô tả bên trên vì thế vẫn xảy ra nguyên vẹn; đợt rà 19/09 dựng lại được nó
   * bằng hai bài độc lập (`SW-3` → `DEV-3` sau khi nhóm Thiết bị về muộn). Nó còn kéo theo một
   * hệ quả thứ hai: `setAt(0)` khi đổi từ khoá cũng bị kéo ngược, nên gõ từ mới mà con trỏ
   * đứng nguyên ở dòng 8.
   *
   * Cách chữa là bỏ hẳn effect ghi. `at` chỉ đổi ở BA chỗ do người dùng (mũi tên, rê chuột, và
   * lượt đặt lại về 0), nên ghi neo ngay tại đó là ghi đúng ý định — không lượt render nào chen
   * vào giữa được nữa.
   */
  /** Đổi dòng đang chọn: kẹp vào biên, ghi neo, rồi mới đặt chỉ số. Dùng cho MỌI lượt đổi. */
  const select = (to: number) => {
    const clamped = Math.max(0, Math.min(to, hits.length - 1));
    anchoredTo.current = hits[clamped]?.to ?? null;
    setAt(clamped);
  };
  useEffect(() => {
    const previous = anchoredTo.current;
    if (previous === null) return;
    const next = hits.findIndex((hit) => hit.to === previous);
    const target = next >= 0 ? next : 0;
    // Dòng cũ mất thì neo phải theo dòng mới, nếu không lượt `hits` sau lại kéo về 0 lần nữa.
    anchoredTo.current = hits[target]?.to ?? null;
    setAt(target);
    // Chỉ chạy khi DANH SÁCH đổi; `at` đổi là do chính người dùng, đừng kéo ngược lại.
    // (Không cần `eslint-disable`: `anchoredTo` là ref và `setAt` bền tham chiếu, nên
    //  `exhaustive-deps` không đòi gì thêm. Chỉ thị disable cũ đã thừa và bị gỡ 20/09/2026 —
    //  một disable thừa sẽ nuốt im một cảnh báo THẬT về sau.)
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
      select(at + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      select(at - 1);
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
  const failedGroups = [
    isp.isError ? t('nav.isp') : null,
    devices.isError ? t('nav.devices') : null,
    software.isError ? t('nav.software') : null,
    accounts.isError ? t('nav.serviceAccounts') : null,
    ipAddresses.isError ? t('palette.groupIp') : null,
    subnets.isError ? t('palette.groupSubnet') : null,
  ].filter((name): name is string => name !== null);
  const loading =
    enabled &&
    (devices.isFetching ||
      software.isFetching ||
      isp.isFetching ||
      accounts.isFetching ||
      ipAddresses.isFetching ||
      subnets.isFetching);
  /*
   * Gom `hits` thành từng nhóm LIỀN NHAU để mỗi nhóm thành một `role="group"` thật.
   *
   * `hits` vốn đã xếp theo nhóm (thiết bị → phần mềm → ISP → tài khoản → điều hướng), nên chỉ
   * cần so với nhóm của phần tử liền trước — không cần sắp lại, và thứ tự hiển thị giữ nguyên.
   * `index` đi kèm vì nó là chỉ số vào `hits` mà `aria-activedescendant` và `at` đang dùng;
   * đánh số lại theo từng nhóm sẽ làm `cp-hit-${index}` trỏ nhầm.
   */
  const resultGroups: { name: string; items: { hit: Hit; index: number }[] }[] = [];
  hits.forEach((hit, index) => {
    const last = resultGroups[resultGroups.length - 1];
    if (last && last.name === hit.group) last.items.push({ hit, index });
    else resultGroups.push({ name: hit.group, items: [{ hit, index }] });
  });

  return (
    <div
      className="cp-wrap"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      {/*
        `aria-modal="true"` Ở LẠI, CÓ CHỦ Ý (19/09/2026).

        Đợt rà soát đề xuất hai đường: dựng lại hộp bằng `ui/dialog.tsx`, hoặc BỎ `aria-modal`
        rồi tự vòng Tab. Thứ thật sự hỏng là cái thứ hai trong cặp — hộp khai mình chặn mà
        không chặn. Bỏ lời khai đi thì khai đúng, nhưng đổi lại trình đọc màn hình lại được
        phép dạo qua nội dung phía sau bằng con trỏ ảo, trong khi màn hình đang bị hộp này phủ
        kín (`--z-palette` 85 > `--z-modal` 60) và bàn phím thì đã bị giữ lại. Ba giác quan nói
        ba chuyện khác nhau.

        `aria-modal` CHÍNH LÀ cách khai báo "phần ngoài hộp coi như không có" — nên giữ nó và
        bổ sung phép giữ tiêu điểm (xem nhánh `Tab` trong `onKeyDown`) làm lời khai ấy thành
        SỰ THẬT, thay vì hạ lời khai xuống cho khớp một hiện trạng sai.
      */}
      <div
        className="cp"
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        /*
         * BẪY TAB ĐẶT Ở PHẦN TỬ BỌC, KHÔNG PHẢI Ở Ô NHẬP (19/09/2026).
         *
         * Bản vài giờ trước xử `Tab` trong `onKeyDown` của `<input>`, nên nó chỉ giữ được khi
         * tiêu điểm ĐANG ở ô nhập. Các dòng kết quả mang `tabIndex={-1}` — không nhận Tab, nhưng
         * VẪN nhận tiêu điểm khi bấm CHUỘT (Safari/Firefox focus nút được click). Từ đó gõ Tab
         * là thoát ra ngoài hộp, đúng cảnh mà `aria-modal="true"` đang hứa là không thể. Bài
         * `command-palette-focus.test.tsx` không bắt được vì nó chỉ thử Tab ngay sau khi mở.
         *
         * Đặt ở đây thì mọi đường vào đều đi qua: sự kiện bàn phím nổi bọt lên phần tử bọc dù
         * tiêu điểm đang ở đâu bên trong hộp.
         */
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="cp-search">
          <span className="cp-search-ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          {/*
            MẪU COMBOBOX CHUẨN (18/09/2026).

            Bản trước chỉ có `aria-label`. Mũi tên ↑/↓ đổi dòng đang chọn nhưng tiêu điểm KHÔNG
            rời ô nhập, nên với trình đọc màn hình không có gì thay đổi cả: người dùng nghe
            được ô tìm rồi... hết. Danh sách kết quả cũng chỉ là một đống `<button>` rời, không
            phải một listbox, nên không ai đọc được "dòng 3 trên 12".

            `aria-activedescendant` là cách chuẩn để nói "tiêu điểm ở ô nhập, nhưng mục ĐANG
            CHỌN là cái kia" — đúng cơ chế mà bàn phím ở đây đang dùng.
          */}
          <input
            ref={inputRef}
            type="text"
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.title')}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="cp-ket-qua"
            aria-autocomplete="list"
            aria-activedescendant={hits.length > 0 ? `cp-hit-${at}` : undefined}
          />
          <kbd>Esc</kbd>
        </div>

        {/*
          DẢI CẢNH BÁO Ở NGOÀI KHUNG CUỘN VÀ NGOÀI LISTBOX (19/09/2026).

          Trước đó nó là con ĐẦU TIÊN của `.cp-list` — mà `.cp-list` vừa là `role="listbox"`
          vừa có `overflow-y: auto`. Hai hỏng cùng lúc: (1) ARIA chỉ cho `listbox` chứa
          `option`/`group`, nên NVDA/JAWS có quyền lược bỏ đoạn này — người dùng trình đọc màn
          hình nghe đủ kết quả nhưng KHÔNG nghe câu "danh sách còn thiếu", rồi đi khai trùng
          đúng thứ họ vừa tìm không ra; (2) nó cuộn theo danh sách, nên bấm ↓ vài lần là câu
          cảnh báo trôi khỏi màn hình và người ta chọn tiếp trong một danh sách mà họ không còn
          biết là khuyết.

          Ra ngoài `.cp-list` thì nó đứng yên dưới ô nhập, và chạm được hai mép hộp như một dải
          thật (xem `.cp-warn` trong `css/command-palette.css`).
        */}
        {/*
          VÙNG SỐNG PHẢI CÓ MẶT TRƯỚC KHI NỘI DUNG ĐỔI (19/09/2026).

          Bản vài giờ trước chỉ render `<p role="status">` KHI có nhóm hỏng — tức node và chữ
          sinh ra cùng một lượt. Trình đọc màn hình chỉ theo dõi những vùng sống đã có mặt TRƯỚC
          đó, nên một node mới chèn vào kèm sẵn chữ thường không được đọc lên: người dùng NVDA
          nghe đủ kết quả mà KHÔNG nghe câu "danh sách còn thiếu", rồi đi khai trùng đúng thứ họ
          vừa tìm không ra. Đúng lỗi mà cùng đợt này vừa gỡ ở `#rmap-cut-sum` — và tôi dựng lại
          nó ở đây trong chính lượt sửa ấy.

          Nay `<p>` thường trực, `hidden` khi rỗng: DOM không vẽ gì, nhưng vùng sống đã được
          đăng ký từ lượt mở hộp nên lời cảnh báo tới sau sẽ được đọc.
        */}
        <p className="cp-warn" role="status" hidden={!(failedGroups.length > 0 && hits.length > 0)}>
          {failedGroups.length > 0 && hits.length > 0
            ? t('palette.partial', { list: failedGroups.join(', ') })
            : null}
        </p>

        <div className="cp-list">
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
                  : failedGroups.length > 0
                    ? t('palette.emptyPartial', { list: failedGroups.join(', '), q })
                    : t('palette.empty', { q })}
              </p>
            </div>
          ) : null}

          {/*
            LISTBOX CHỈ CHỨA `option` VÀ `group` (19/09/2026).

            Bản trước để dải cảnh báo, hai khối rỗng và các `<p>` tên nhóm nằm thẳng trong
            `role="listbox"`, còn mỗi `option` thì bị bọc trong một `<div>` trơn — tức option
            KHÔNG phải con của listbox. Quan hệ sở hữu listbox→option đứt thì trình đọc màn
            hình không nói được "mục 3 trên 8", và vài bộ bỏ qua hẳn option không được listbox
            sở hữu. Đúng thứ mẫu combobox dựng ngày 18/09 sinh ra để cung cấp.

            `role="group"` ĐƯỢC phép đứng giữa listbox và option, nên tên nhóm nay là
            `aria-label` của group (và `<p>` chỉ còn là phần nhìn, `aria-hidden` để khỏi đọc
            hai lần). Listbox LUÔN có mặt kể cả khi rỗng — `aria-controls="cp-ket-qua"` trên ô
            nhập phải luôn có đích, nếu không lại là một IDREF chết.
          */}
          <div id="cp-ket-qua" role="listbox" aria-label={t('palette.title')}>
            {resultGroups.map((group) => (
              <div key={group.name} className="cp-group" role="group" aria-label={group.name}>
                <p className="cp-group-title" aria-hidden="true">
                  {group.name}
                </p>
                {group.items.map(({ hit, index }) => (
                  <button
                    key={`${hit.to}-${index}`}
                    type="button"
                    /* Không phải chỗ dừng Tab: dòng đang chọn do ↑/↓ + `aria-activedescendant`
                       quyết định, tiêu điểm thật luôn ở ô nhập. Để chúng nhận Tab là biến một
                       hộp tìm nhanh thành hai mươi nhịp Tab. */
                    tabIndex={-1}
                    id={`cp-hit-${index}`}
                    role="option"
                    aria-selected={index === at}
                    className={`cp-item${index === at ? ' active' : ''}`}
                    onMouseEnter={() => select(index)}
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
                ))}
              </div>
            ))}
          </div>
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
