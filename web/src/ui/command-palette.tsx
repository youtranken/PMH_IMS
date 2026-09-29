import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '@/lib/api-client';
import { disposalStatusKey } from '@/lib/disposal-kinds';
import type { Me } from '@/lib/me';
import { PATHS } from '@/lib/routes';
import { visibleGroups } from '@/shell/app-nav';
import { isAnyDialogOpen, useAnyDialogOpen } from '@/ui/dialog';
import { NavIcon } from '@/ui/nav-icon';
import { useMediaQuery } from '@/ui/use-media-query';
import { NARROW_QUERY } from '@/ui/use-narrow';
import { foldSearch, foldedMatchRange } from '@/lib/search-fold';
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
  /**
   * Icon lấy từ `NavIcon` theo khoá menu của NHÓM (AD-15): một thực thể chỉ có một icon, cùng
   * cái người dùng thấy ở sidebar — bộ icon thứ hai riêng của palette từng vẽ phần mềm thành
   * mặt trời còn sidebar vẽ chìa khoá.
   */
  navKey: string;
  /** `more` = "Xem tất cả N…", `action` = "Tìm trong …"/"Đi tới" — chữ thường, không phải mã mono. */
  kind?: 'more' | 'action';
  /**
   * Trạng thái của hồ sơ theo module chủ. Chỉ trạng thái CUỐI (thanh lý / ngừng dùng) mới vẽ
   * chip — tên do `disposalStatusKey` gọi, cùng chữ với Kho thanh lý. Trạng thái giữa đường
   * (Hỏng, Tạm ngưng…) mỗi module gọi một kiểu, nên không vẽ để khỏi nói sai.
   */
  status?: string;
}

/** Hồ sơ vừa mở gần đây — chỉ đường dẫn, mã và tên; không bao giờ có bí mật. */
const RECENT_LIMIT = 5;
function recentKey(email: string): string {
  return `ims_palette_recent:${email.toLowerCase()}`;
}
function readRecent(email: string): Hit[] {
  try {
    const raw = JSON.parse(localStorage.getItem(recentKey(email)) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? (raw as Hit[])
          .filter(
            (h) =>
              typeof h?.to === 'string' &&
              h.to.startsWith('/') &&
              !h.to.startsWith('//') &&
              typeof h.title === 'string' &&
              typeof h.navKey === 'string',
          )
          .slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}
function rememberRecent(email: string, hit: Hit): void {
  try {
    const next = [
      { to: hit.to, title: hit.title, sub: hit.sub, navKey: hit.navKey, group: '' },
      ...readRecent(email).filter((h) => h.to !== hit.to),
    ].slice(0, RECENT_LIMIT);
    localStorage.setItem(recentKey(email), JSON.stringify(next));
  } catch {
    // Kho bị chặn: chỉ mất danh sách "mở gần đây", tìm vẫn chạy.
  }
}

/** Phím tắt đúng nền tảng: người dùng Mac bấm ⌘K, không phải Ctrl K. */
export function paletteShortcut(): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
  return /mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K';
}

/** Tô đậm phần khớp (gấp dấu) trong một dòng kết quả. */
function Highlight({ text, q }: { text: string; q: string }) {
  const range = q.length >= 2 ? foldedMatchRange(text, q) : null;
  if (!range) return <>{text}</>;
  return (
    <>
      {text.slice(0, range[0])}
      <mark>{text.slice(range[0], range[1])}</mark>
      {text.slice(range[1])}
    </>
  );
}

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
  total?: number;
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
const OPEN_PALETTE_EVENT = 'ims:open-command-palette';

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
  // `useMediaQuery` chứ không `useIsNarrow`: hộp này dựng cả ở nơi không có `matchMedia`.
  const narrow = useMediaQuery(NARROW_QUERY);
  const [recent, setRecent] = useState<Hit[]>([]);

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
      setRecent(readRecent(me.email));
      anchoredTo.current = null;
      setAt(0);
      // Ô tìm phải nhận tiêu điểm ngay, nếu không người dùng gõ vào khoảng không.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (openedBy.current instanceof HTMLElement) {
      // Trả tiêu điểm về đúng chỗ đã mở hộp — cùng luật với `ui/dialog.tsx`.
      openedBy.current.focus();
      openedBy.current = null;
    }
  }, [open, me.email]);

  const enabled = open && q.length >= 2;

  const devices = useQuery({
    queryKey: ['palette', 'devices', q],
    queryFn: () =>
      apiFetch<
        Page<{ id: string; code: string; name: string; siteCode: string | null; status?: string }>
      >(
        `/api/v1/devices?page=1&limit=5&search=${encodeURIComponent(q)}`,
      ),
    enabled,
  });
  const software = useQuery({
    queryKey: ['palette', 'software', q],
    queryFn: () =>
      apiFetch<Page<{ id: string; code: string; name: string; status?: string }>>(
        `/api/v1/software?page=1&limit=4&search=${encodeURIComponent(q)}`,
      ),
    enabled,
  });
  const isp = useQuery({
    queryKey: ['palette', 'isp', q],
    queryFn: () =>
      apiFetch<Page<{ id: string; code: string; provider: string; status?: string }>>(
        `/api/v1/isp-lines?page=1&limit=3&search=${encodeURIComponent(q)}`,
      ),
    enabled,
  });
  const accounts = useQuery({
    queryKey: ['palette', 'service-accounts', q],
    queryFn: () =>
      apiFetch<
        Page<{ id: string; code: string; name: string; login: string | null; status?: string }>
      >(
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
      navKey: 'nav.ipam',
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
          navKey: 'nav.ipam',
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
        navKey: 'nav.ipam',
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
        navKey: item.key,
      }));
  }, [q, me, t]);

  const found = useMemo<Hit[]>(() => {
    if (!enabled) return [];
    /*
     * Dòng "Xem tất cả N kết quả trong …" cuối mỗi nhóm bị cắt: gõ "E2E" thấy 5 thiết bị mà
     * không biết còn 20 cái nữa là tưởng hết. Mở đúng màn danh sách với ô tìm đã điền.
     */
    const more = (group: string, total: number | undefined, shown: number, list: string, navKey: string): Hit[] =>
      total !== undefined && total > shown
        ? [
            {
              group,
              title: t('palette.seeAll', { count: total, group }),
              sub: '',
              to: `${list}?q=${encodeURIComponent(q)}`,
              navKey,
              kind: 'more',
            },
          ]
        : [];
    // Câu gõ có dáng IP/CIDR thì người hỏi đang tra mạng: IP và dải lên đầu.
    const network = [...ipHits, ...subnetHits];
    const deviceRows = devices.data?.items ?? [];
    const softwareRows = software.data?.items ?? [];
    const ispRows = isp.data?.items ?? [];
    const accountRows = accounts.data?.items ?? [];
    return [
      ...(ipFirst ? network : []),
      ...deviceRows.map((row) => ({
        group: t('nav.devices'),
        title: row.code,
        sub: [row.name, row.siteCode].filter(Boolean).join(' · '),
        to: PATHS.device(row.id),
        navKey: 'nav.devices',
        status: row.status,
      })),
      ...more(t('nav.devices'), devices.data?.total, deviceRows.length, PATHS.devices, 'nav.devices'),
      ...softwareRows.map((row) => ({
        group: t('nav.software'),
        title: row.code,
        sub: row.name,
        to: PATHS.softwareItem(row.id),
        navKey: 'nav.software',
        status: row.status,
      })),
      ...more(t('nav.software'), software.data?.total, softwareRows.length, PATHS.software, 'nav.software'),
      ...ispRows.map((row) => ({
        group: t('nav.isp'),
        title: row.code,
        sub: row.provider,
        to: PATHS.ispLine(row.id),
        navKey: 'nav.isp',
        status: row.status,
      })),
      ...more(t('nav.isp'), isp.data?.total, ispRows.length, PATHS.ispLines, 'nav.isp'),
      ...accountRows.map((row) => ({
        group: t('nav.serviceAccounts'),
        title: row.code,
        sub: [row.name, row.login].filter(Boolean).join(' · '),
        to: PATHS.serviceAccount(row.id),
        navKey: 'nav.serviceAccounts',
        status: row.status,
      })),
      ...more(
        t('nav.serviceAccounts'),
        accounts.data?.total,
        accountRows.length,
        PATHS.serviceAccounts,
        'nav.serviceAccounts',
      ),
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
    q,
    t,
  ]);

  const searching =
    enabled &&
    (devices.isFetching ||
      software.isFetching ||
      isp.isFetching ||
      accounts.isFetching ||
      ipAddresses.isFetching ||
      subnets.isFetching);
  const anyFailed =
    devices.isError ||
    software.isError ||
    isp.isError ||
    accounts.isError ||
    ipAddresses.isError ||
    subnets.isError;

  /*
   * Ba cảnh của danh sách, và cả ba đều CHỌN ĐƯỢC bằng mũi tên:
   *  - chưa gõ đủ 2 ký tự: "Mở gần đây" + "Đi tới" (các màn trong menu) — lúc mở hộp là lúc tốt
   *    nhất để đưa lại đúng hồ sơ người trực đang xử lý dở;
   *  - không có gì khớp (và không nhóm nào hỏng): lối đi tiếp "Tìm "x" trong …" thay cho ngõ cụt;
   *  - còn lại: kết quả tìm.
   */
  const hits = useMemo<Hit[]>(() => {
    if (q.length < 2) {
      const recentGroup = t('palette.groupRecent');
      const gotoGroup = t('palette.groupGoto');
      return [
        ...recent.map((hit) => ({ ...hit, group: recentGroup })),
        ...visibleGroups(me)
          .flatMap((group) => group.items)
          .filter((item) => !item.planned)
          .map((item) => ({
            group: gotoGroup,
            title: t(item.key),
            sub: '',
            to: item.to,
            navKey: item.key,
            kind: 'action' as const,
          })),
      ];
    }
    if (found.length > 0 || searching || anyFailed) return found;
    const group = t('palette.groupSearchIn');
    return [
      { list: PATHS.devices, key: 'nav.devices' },
      { list: PATHS.software, key: 'nav.software' },
      { list: PATHS.ispLines, key: 'nav.isp' },
      { list: PATHS.serviceAccounts, key: 'nav.serviceAccounts' },
    ].map(({ list, key }) => ({
      group,
      title: t('palette.searchIn', { q, where: t(key) }),
      sub: '',
      to: `${list}?q=${encodeURIComponent(q)}`,
      navKey: key,
      kind: 'action' as const,
    }));
  }, [q, recent, me, found, searching, anyFailed, t]);

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
    if (!hit.kind && q.length >= 2) rememberRecent(me.email, hit);
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
  const loading = searching;
  const retryFailed = () => {
    for (const query of [devices, software, isp, accounts, ipAddresses, subnets]) {
      if (query.isError) void query.refetch();
    }
  };
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
            // Điện thoại: câu ngắn, câu dài bị cắt ngang giữa chữ.
            placeholder={t(narrow ? 'palette.placeholderShort' : 'palette.placeholder')}
            aria-label={t('palette.title')}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="cp-ket-qua"
            aria-autocomplete="list"
            aria-activedescendant={hits.length > 0 ? `cp-hit-${at}` : undefined}
          />
          {narrow ? (
            // Màn cảm ứng không có phím Esc: nút chữ đủ lớn để chạm.
            <button type="button" className="cp-cancel" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          ) : (
            <kbd>Esc</kbd>
          )}
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
        <p className="cp-warn" role="status" hidden={!(failedGroups.length > 0 && found.length > 0)}>
          {failedGroups.length > 0 && found.length > 0 ? (
            <>
              {t('palette.partial', { list: failedGroups.join(', ') })}{' '}
              <button type="button" className="cp-retry" onClick={retryFailed} disabled={loading}>
                {t('app.retry')}
              </button>
            </>
          ) : null}
        </p>

        <div className="cp-list">
          {q.length >= 2 && found.length === 0 ? (
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
              {!loading && failedGroups.length === 0 ? (
                <p className="cp-empty-hint">{t('palette.emptyHint')}</p>
              ) : null}
              {!loading && failedGroups.length > 0 ? (
                <button type="button" className="btn sm" onClick={retryFailed}>
                  {t('app.retry')}
                </button>
              ) : null}
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
                    className={`cp-item${index === at ? ' active' : ''}${hit.kind ? ` is-${hit.kind}` : ''}`}
                    onMouseEnter={() => select(index)}
                    onClick={() => go(hit)}
                  >
                    <span className="it-ic">
                      <NavIcon navKey={hit.navKey} />
                    </span>
                    <span className="it-name">
                      <b>{hit.kind ? hit.title : <Highlight text={hit.title} q={q} />}</b>
                      {hit.sub ? (
                        <span>
                          <Highlight text={hit.sub} q={q} />
                        </span>
                      ) : null}
                    </span>
                    {hit.status && disposalStatusKey(hit.status) ? (
                      <span className="badge muted it-status">
                        {t(disposalStatusKey(hit.status) ?? '')}
                      </span>
                    ) : null}
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
          {/* Luật "gõ ít nhất 2 ký tự" thu về một dòng nhỏ: chỗ chính của hộp để cho gợi ý. */}
          <span className="fh cp-foot-hint">{t('palette.hintShort')}</span>
          {narrow ? null : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
