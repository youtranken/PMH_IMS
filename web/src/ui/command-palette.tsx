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
export const SU_KIEN_MO_TIM_NHANH = 'ims:mo-tim-nhanh';

/** Mở hộp tìm nhanh từ bất kỳ đâu. Dùng ở nút tìm trên topbar. */
export function moTimNhanh(): void {
  window.dispatchEvent(new CustomEvent(SU_KIEN_MO_TIM_NHANH));
}

export function CommandPalette({ me }: { me: Me }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [at, setAt] = useState(0);
  /** Đích đến của dòng đang chọn. Khai ở đây vì hai lượt đặt lại `at` về 0 nằm phía trên chỗ
      dùng chính — xem khối chú thích dài ở `chon()` bên dưới. */
  const dangChon = useRef<string | null>(null);
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

  /* Nút tìm trên topbar xin mở. Cùng hàng rào với phím tắt: đang có hộp thoại thì không mở. */
  useEffect(() => {
    const onMo = () => {
      if (coHopThoaiDangMo()) return;
      openedBy.current = document.activeElement;
      setOpen(true);
    };
    window.addEventListener(SU_KIEN_MO_TIM_NHANH, onMo);
    return () => window.removeEventListener(SU_KIEN_MO_TIM_NHANH, onMo);
  }, []);

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
      dangChon.current = null;
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

  /* Đổi từ khoá = bỏ neo. Giữ neo lại thì effect khôi phục bên dưới sẽ kéo con trỏ về dòng của
     từ khoá CŨ ngay khi kết quả mới về — người dùng gõ từ mới mà con trỏ đứng ở dòng 8. */
  useEffect(() => {
    dangChon.current = null;
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
  const chon = (toi: number) => {
    const kep = Math.max(0, Math.min(toi, hits.length - 1));
    dangChon.current = hits[kep]?.to ?? null;
    setAt(kep);
  };
  useEffect(() => {
    const cu = dangChon.current;
    if (cu === null) return;
    const moi = hits.findIndex((hit) => hit.to === cu);
    const den = moi >= 0 ? moi : 0;
    // Dòng cũ mất thì neo phải theo dòng mới, nếu không lượt `hits` sau lại kéo về 0 lần nữa.
    dangChon.current = hits[den]?.to ?? null;
    setAt(den);
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
      chon(at + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      chon(at - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(hits[at]);
    } else if (event.key === 'Tab') {
      /*
       * TIÊU ĐIỂM KHÔNG ĐƯỢC RỜI HỘP (19/09/2026).
       *
       * Hộp này khai `role="dialog" aria-modal="true"` từ lâu, nhưng chưa bao giờ giữ tiêu
       * điểm lại. Đo ngày 19/09: mở ⌘K rồi gõ Tab một lần là `activeElement` về `<body>`, gõ
       * tiếp thì đi vào sidebar và nội dung trang phía sau. Mà `aria-modal="true"` chính là
       * lời dặn trình đọc màn hình CẤT toàn bộ phần ngoài hộp khỏi bộ đệm ảo — nên người dùng
       * đang Tab vào những phần tử mà họ không nghe thấy gì, và không có dấu hiệu nào cho biết
       * mình đã rời hộp.
       *
       * Ở mẫu combobox thì ô nhập là chỗ dừng Tab DUY NHẤT trong hộp: các dòng kết quả mang
       * `tabIndex={-1}` và được điều khiển bằng ↑/↓ + `aria-activedescendant`, không phải bằng
       * Tab. Nên "vòng lại" ở đây rút gọn thành "ở nguyên" — không cần quét danh sách phần tử
       * bấm được, không cần vòng lặp. Đường ra khỏi hộp là Esc, và `<kbd>Esc</kbd>` nằm ngay
       * cạnh ô nhập để nói điều đó.
       */
      event.preventDefault();
      inputRef.current?.focus();
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
  /*
   * Gom `hits` thành từng nhóm LIỀN NHAU để mỗi nhóm thành một `role="group"` thật.
   *
   * `hits` vốn đã xếp theo nhóm (thiết bị → phần mềm → ISP → tài khoản → điều hướng), nên chỉ
   * cần so với nhóm của phần tử liền trước — không cần sắp lại, và thứ tự hiển thị giữ nguyên.
   * `index` đi kèm vì nó là chỉ số vào `hits` mà `aria-activedescendant` và `at` đang dùng;
   * đánh số lại theo từng nhóm sẽ làm `cp-hit-${index}` trỏ nhầm.
   */
  const nhomKetQua: { ten: string; mucs: { hit: Hit; index: number }[] }[] = [];
  hits.forEach((hit, index) => {
    const cuoi = nhomKetQua[nhomKetQua.length - 1];
    if (cuoi && cuoi.ten === hit.group) cuoi.mucs.push({ hit, index });
    else nhomKetQua.push({ ten: hit.group, mucs: [{ hit, index }] });
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
      <div className="cp" role="dialog" aria-modal="true" aria-label={t('palette.title')}>
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
        {nhomHong.length > 0 && hits.length > 0 ? (
          <p className="cp-warn" role="status">
            {t('palette.partial', { list: nhomHong.join(', ') })}
          </p>
        ) : null}

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
                  : nhomHong.length > 0
                    ? t('palette.emptyPartial', { list: nhomHong.join(', '), q })
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
            {nhomKetQua.map((nhom) => (
              <div key={nhom.ten} className="cp-group" role="group" aria-label={nhom.ten}>
                <p className="cp-group-title" aria-hidden="true">
                  {nhom.ten}
                </p>
                {nhom.mucs.map(({ hit, index }) => (
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
                    onMouseEnter={() => chon(index)}
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
