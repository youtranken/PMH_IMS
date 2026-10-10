import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Chevron } from '@/ui/chevron';
import { useScrollEdges } from '@/ui/scroll-x';
import { motionReduced } from '@/lib/motion';

/** Nội dung tab mờ dần vào — bằng `--dur` của tokens.css (Web Animations không đọc biến CSS). */
const TAB_FADE_MS = 200;

export interface TabItem {
  key: string;
  label: ReactNode;
  /** Số nhỏ bên phải nhãn (vd số dòng trong tab). */
  count?: number;
  /**
   * Tên nhóm (Q-27, màn Danh mục): tab liền nhau cùng nhóm đứng thành cụm, nhãn nhóm hiện trước
   * tab đầu của cụm. Nhãn chỉ để nhìn (`aria-hidden`) — vẫn là MỘT tablist, ←/→ đi qua mọi tab.
   */
  group?: string;
  /*
   * ===== KHÔNG CÓ PROP `dot` (chấm cảnh báo) =====
   *
   * Hệ thống chưa có TÍN HIỆU nào để quyết khi nào chấm sáng.
   * Mockup `thiet-bi.html:510` có vẽ một chấm ở tab Két sắt nhưng không nói chấm ấy nghĩa là
   * gì — "secret quá hạn xoay" là suy đoán, và chưa chỗ nào tính được con số đó. Đấu bừa vào
   * một tín hiệu tự nghĩ ra là thêm một lời hứa không ai kiểm được — và mã không ai gọi chỉ
   * làm người đọc sau tưởng việc đã xong.
   *
   * Ngày nào chốt được chấm ấy BÁO ĐIỀU GÌ thì bản cũ (kèm luật CSS `.tab-dot`) còn trong lịch
   * sử git.
   */
}

/**
 * Vị trí cuộn ngang đưa tab vào GIỮA khung tab, kẹp trong [0, phần nội dung còn cuộn được].
 * `tabOffset` là mép trái của tab tính trong nội dung (không phải trong khung nhìn).
 */
export function tabScrollLeft({
  barWidth,
  scrollWidth,
  tabOffset,
  tabWidth,
}: {
  scrollLeft: number;
  barWidth: number;
  scrollWidth: number;
  tabOffset: number;
  tabWidth: number;
}): number {
  const max = Math.max(0, scrollWidth - barWidth);
  const centered = tabOffset + tabWidth / 2 - barWidth / 2;
  return Math.round(Math.min(max, Math.max(0, centered)));
}

/**
 * Thanh tab dùng chung (AD-15) — màn Danh mục, các trang chi tiết (thiết bị, phần mềm…) đều
 * dùng bản này. Dùng lại CSS `.tabs/.tab` sẵn có.
 *
 * Bàn phím theo chuẩn tablist: ←/→ chuyển tab, Home/End nhảy đầu/cuối. Không có cái này
 * thì tab chỉ bấm được bằng chuột — màn Danh mục là màn nhập liệu, người dùng đi bằng Tab.
 */
export function Tabs({
  items,
  value,
  onChange,
  ariaLabel,
  wrap = false,
}: {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
  /**
   * Tab xuống dòng thay vì cuộn ngang: khung hẹp (panel bên phải của /diagrams) mà tên dài thì
   * cuộn ngang giấu mất tab đầu sau một mép mờ, và chuột không có cách nào cuộn ngang.
   */
  wrap?: boolean;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const barRef = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(barRef);
  const mounted = useRef(false);
  // Khoá theo nhãn + số đếm: mảng `items` nơi gọi dựng lại mỗi lượt render, không dùng làm phụ thuộc được.
  const layoutKey = items.map((item) => `${item.key}:${item.count ?? ''}`).join('|');
  const ink = useTabInk(barRef, refs, value, layoutKey);

  /*
   * Tab đang chọn phải NẰM TRONG khung. Trên điện thoại thanh tab cuộn ngang và giấu thanh
   * cuộn, nên mở `?tab=vault` mà không cuộn thì không thấy tab nào sáng cả.
   *
   * Tự tính `scrollLeft` trên chính khung tab, KHÔNG dùng `scrollIntoView`: hàm đó cuộn mọi
   * tổ tiên, kể cả trang — trên điện thoại thanh tab nằm dưới rail ở y≈590, vừa mở trang đã
   * bị kéo xuống giữa chừng.
   */
  useLayoutEffect(() => {
    const bar = barRef.current;
    const tab = refs.current[value];
    if (!bar || !tab || wrap) return;
    const barRect = bar.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const left = tabScrollLeft({
      scrollLeft: bar.scrollLeft,
      barWidth: bar.clientWidth,
      scrollWidth: bar.scrollWidth,
      tabOffset: tabRect.left - barRect.left + bar.scrollLeft,
      tabWidth: tabRect.width,
    });
    // Lần đầu nhảy thẳng (trang vừa mở, không có gì để "đi theo"); người dùng tắt chuyển
    // động thì cũng nhảy thẳng.
    const reduced = motionReduced();
    const behavior: ScrollBehavior = mounted.current && !reduced ? 'smooth' : 'auto';
    mounted.current = true;
    if (left === bar.scrollLeft) return;
    if (typeof bar.scrollTo === 'function') bar.scrollTo({ left, behavior });
    else bar.scrollLeft = left;
  }, [value, wrap]);

  const move = (delta: number) => {
    const index = items.findIndex((item) => item.key === value);
    const next = items[(index + delta + items.length) % items.length];
    onChange(next.key);
    refs.current[next.key]?.focus();
  };

  /* Mũi tên cuộn cho CHUỘT: mép mờ nói "còn tab", nhưng trên máy tính không có thanh cuộn để kéo.
     Bàn phím đã có ← → nên mũi tên ra khỏi thứ tự Tab và khỏi cây trợ năng. */
  const scrollBy = (direction: 1 | -1) => {
    const bar = barRef.current;
    if (!bar) return;
    const left = bar.scrollLeft + direction * Math.round(bar.clientWidth * 0.7);
    if (typeof bar.scrollTo === 'function') bar.scrollTo({ left, behavior: motionReduced() ? 'auto' : 'smooth' });
    else bar.scrollLeft = left;
  };

  return (
    <div
      className="tabs-shell"
      /* Chừa chỗ mũi tên ở CẢ HAI mép khi thanh tràn — không chỉ lúc mũi tên đang hiện: đệm bật
         tắt theo mép thì thanh co giãn ngay dưới con trỏ khi vừa cuộn khỏi mép. */
      data-overflow={!wrap && (edges.start || edges.end) ? 'true' : undefined}
    >
    {!wrap && edges.start ? (
      <button type="button" className="tabs-arrow" data-side="start" tabIndex={-1} aria-hidden="true" onClick={() => scrollBy(-1)}>
        <Chevron direction="left" />
      </button>
    ) : null}
    <div
      ref={barRef}
      className="tabs"
      role="tablist"
      aria-label={ariaLabel}
      // Mép còn tab khuất — CSS làm mờ mép đó để báo "còn nữa" (thanh cuộn đã bị giấu).
      data-more-start={edges.start ? 'true' : undefined}
      data-more-end={edges.end ? 'true' : undefined}
      // Có vạch trượt thì CSS bỏ gạch chân riêng của tab đang chọn (không vẽ hai vạch).
      data-ink={ink ? 'true' : undefined}
      data-wrap={wrap ? 'true' : undefined}
    >
      {items.map((item, index) => (
        <Fragment key={item.key}>
        {item.group && item.group !== items[index - 1]?.group ? (
          <span className="tab-group" aria-hidden="true" data-first={index === 0 ? 'true' : undefined}>
            {item.group}
          </span>
        ) : null}
        <button
          ref={(el) => {
            refs.current[item.key] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${item.key}`}
          aria-selected={item.key === value}
          /*
           * `aria-controls` CHỈ trên tab đang chọn.
           *
           * Đặt nó lên MỌI tab, trỏ tới `tabpanel-<khoá>` của từng tab, là sai: cả bốn
           * trang chi tiết (và `catalog`, `expiry`, `approvals`) đều render đúng MỘT `TabPanel`
           * — cái của tab đang chọn. Nên với mọi tab còn lại, `aria-controls` trỏ vào một id
           * không tồn tại: axe báo `aria-valid-attr-value`, và người dùng JAWS đứng ở tab "Cổng"
           * chưa bấm rồi ra lệnh "nhảy tới khu được điều khiển" thì không có gì để nhảy tới.
           *
           * Hai đường: render đủ mọi panel rồi ẩn bằng `hidden` (như `#rmap-cut-sum`), hoặc chỉ
           * khai quan hệ khi nó CÓ THẬT. Chọn cách sau vì render
           * đủ panel nghĩa là mọi tab đều chạy truy vấn của nó ngay khi mở trang — đắt hơn hẳn,
           * và `TabPanel` hiện được dùng ở 8 chỗ gọi trên 7 màn (`expiry-screen` gọi hai lần).
           */
          aria-controls={item.key === value ? `tabpanel-${item.key}` : undefined}
          // Chỉ tab đang chọn nằm trong luồng Tab; các tab khác đi bằng phím mũi tên.
          tabIndex={item.key === value ? 0 : -1}
          className={`tab${item.key === value ? ' active' : ''}`}
          onClick={() => onChange(item.key)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              move(1);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              move(-1);
            } else if (e.key === 'Home') {
              e.preventDefault();
              onChange(items[0].key);
            } else if (e.key === 'End') {
              e.preventDefault();
              onChange(items[items.length - 1].key);
            }
          }}
        >
          {item.label}
          {/*
            Dấu cách RÕ RÀNG trước con số, không dựa vào `margin` của `.tab-count`.
            Khoảng cách CSS chỉ có nghĩa với mắt: tên khả truy cập của nút ghép thẳng hai node
            văn bản, nên thiếu nó là trình đọc màn hình đọc "Giấy tờ0" thành một từ — và mọi
            selector theo tên tab cũng phải viết dính vào nhau mới khớp.
          */}
          {/*
            SỐ 0 THÌ KHÔNG VẼ SỐ.
            `!== undefined` để số 0 lọt, nên tab hiện ra "Giấy tờ 0" — đo trên trình duyệt
            thật thì tab Giấy tờ và Két sắt của một hồ sơ trống đều mang đuôi "0". Con số đó
            không nói thêm gì so với việc mở tab ra và thấy khu rỗng, mà lại làm tab trông như
            đang hỏng. `_SPEC.md:61` xếp đây là lỗi.
            Dùng phép thử truthy CHỦ Ý: nó gộp `0` với `undefined` ("chưa biết" — xem hợp đồng
            của `useTabCounts`) vào cùng một nhánh không-vẽ, đúng thứ ta muốn ở cả hai.
          */}
          {item.count ? (
            <>
              {' '}
              <span className="tab-count">{item.count}</span>
            </>
          ) : null}
        </button>
        </Fragment>
      ))}
      {ink ? (
        <span
          className="tab-ink"
          aria-hidden="true"
          style={{ transform: `translate(${ink.x}px, ${ink.y}px) scaleX(${ink.w})` }}
        />
      ) : null}
    </div>
    {!wrap && edges.end ? (
      <button type="button" className="tabs-arrow" data-side="end" tabIndex={-1} aria-hidden="true" onClick={() => scrollBy(1)}>
        <Chevron direction="right" />
      </button>
    ) : null}
    </div>
  );
}

type Ink = { x: number; y: number; w: number };

/**
 * Vị trí vạch dưới của tab đang chọn, đo từ chính nút tab (Q-21: vạch TRƯỢT sang tab mới thay
 * vì tắt chỗ này bật chỗ kia). Vạch rộng 1px rồi `scaleX` theo bề ngang tab, nên chuyển động chỉ
 * là `transform` — không đổi `left`/`width` (đổi bố cục mỗi khung hình).
 *
 * Chưa đo được (bề ngang 0: chưa vẽ, môi trường không có bố cục) thì trả `null` và gạch chân CSS
 * của `.tab.active` vẫn đứng đó — không bao giờ mất dấu tab đang chọn.
 */
function useTabInk(
  barRef: RefObject<HTMLDivElement | null>,
  refs: RefObject<Record<string, HTMLButtonElement | null>>,
  value: string,
  layoutKey: string,
): Ink | null {
  const [ink, setInk] = useState<Ink | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const tab = refs.current?.[value];
      if (!tab || tab.offsetWidth === 0) {
        setInk(null);
        return;
      }
      // Vạch 2px nằm ở đáy nút tab — đúng chỗ gạch chân CSS của tab đang chọn.
      const next = { x: tab.offsetLeft, y: tab.offsetTop + tab.offsetHeight - 2, w: tab.offsetWidth };
      setInk((prev) => (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w ? prev : next));
    };
    measure();
    // Nhãn đổi bề ngang (số đếm về, cửa sổ co giãn) thì đo lại, kẻo vạch lệch khỏi chữ.
    const bar = barRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    for (const el of Object.values(refs.current ?? {})) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [barRef, refs, value, layoutKey]);
  return ink;
}

/** Vùng nội dung của một tab — gắn aria đúng cặp với `Tabs`. */
export function TabPanel({ tabKey, children }: { tabKey: string; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const shownKey = useRef(tabKey);
  /*
   * Đổi tab thì nội dung mờ dần vào. Chạy bằng Web Animations trên chính node, KHÔNG đổi `key`
   * để CSS chạy lại animation: đổi `key` là tháo cả cây con, mất trạng thái (bộ lọc, trang)
   * của những tab dùng chung một component. Lần hiện đầu không mờ — trang vừa mở đã có hiệu
   * ứng vào trang riêng.
   */
  useEffect(() => {
    if (shownKey.current === tabKey) return;
    shownKey.current = tabKey;
    const el = panelRef.current;
    if (!el || typeof el.animate !== 'function' || motionReduced()) return;
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: TAB_FADE_MS, easing: 'ease-out' });
  }, [tabKey]);
  return (
    <div
      ref={panelRef}
      className="tab-panel"
      role="tabpanel"
      id={`tabpanel-${tabKey}`}
      aria-labelledby={`tab-${tabKey}`}
    >
      {children}
    </div>
  );
}

/**
 * Tab mở sẵn đọc từ `?tab=`, CÓ KIỂM: chuỗi lạ phải rơi về tab đầu.
 *
 * Chuỗi ternary render của các trang chi tiết kết thúc ở nhánh cuối, nên `?tab=rác` không kiểm
 * sẽ vẽ nhánh cuối (thường là Lịch sử) mà KHÔNG tab nào sáng — và vì truy vấn lịch sử
 * `enabled: tab === 'history'` nên nó còn chẳng gọi API: `isLoading`/`isError` đều false, panel
 * nhận mảng rỗng. Một link cũ gõ sai một chữ hiện ra "chưa có lịch sử gì" rất thuyết phục.
 *
 * Dùng trong khởi tạo `useState`. Nó KHÔNG thay được `useVisibleTab` bên dưới: lúc này dữ liệu
 * chưa về nên `allowed` chỉ là danh sách TĨNH — mọi tab có thể xuất hiện, kể cả tab mà hồ sơ
 * này rốt cuộc không có.
 */
export function initialTab(raw: string | null, allowed: string[], fallback = 'profile'): string {
  return raw && allowed.includes(raw) ? raw : fallback;
}

/**
 * Kẹp lại tab theo danh sách THẬT SỰ đang hiện, sau khi dữ liệu đã về.
 *
 * `initialTab` chạy TRƯỚC khi hồ sơ về nên không thể biết tab nào có mặt, vì vài tab chỉ hiện
 * theo dữ liệu: Port map chỉ có với loại thiết bị `hasPortMap`, "Máy đang dùng" chỉ có với
 * license. Nên `?tab=ports` trên một cái máy in lọt qua danh sách tĩnh: thanh tab không sáng ô
 * nào, mà khu port map vẫn được vẽ ra cho một máy đáng lẽ không có port map — đúng kiểu hỏng
 * mà `initialTab` sinh ra để chặn.
 *
 * Gọi TRƯỚC mọi nhánh `return` sớm của trang: đây là hook, đặt sau `if (isLoading) return` thì
 * số hook giữa hai lượt render lệch nhau.
 */
export function useVisibleTab(
  tab: string,
  keys: string[],
  setTab: (next: string) => void,
  fallback = 'profile',
): string {
  const safe = keys.includes(tab) ? tab : fallback;
  useEffect(() => {
    if (safe !== tab) setTab(safe);
  }, [safe, tab, setTab]);
  return safe;
}
