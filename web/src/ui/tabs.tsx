import { useEffect, useRef, type ReactNode } from 'react';

export interface TabItem {
  key: string;
  label: ReactNode;
  /** Số nhỏ bên phải nhãn (vd số dòng trong tab). */
  count?: number;
  /*
   * ===== ĐÃ GỠ `dot` (19/09/2026) =====
   *
   * Prop chấm cảnh báo được viết đủ bộ — kiểu, CSS `.tab-dot`, chữ ẩn `.sr-only` cho trình
   * đọc màn hình (WCAG 1.4.1) — nhưng KHÔNG một màn nào truyền nó, từ lúc ra đời tới lúc gỡ.
   *
   * Lý do gỡ chứ không đấu dây: hệ thống chưa có TÍN HIỆU nào để quyết khi nào chấm sáng.
   * Mockup `thiet-bi.html:510` có vẽ một chấm ở tab Két sắt nhưng không nói chấm ấy nghĩa là
   * gì — "secret quá hạn xoay" là suy đoán, và chưa chỗ nào tính được con số đó. Đấu bừa vào
   * một tín hiệu tự nghĩ ra là thêm một lời hứa không ai kiểm được.
   *
   * Đây cũng đúng thứ đợt rà soát 18/09 gặp lặp đi lặp lại: token màu khai xong không dùng,
   * luật CSS nằm chờ cả tháng, `.skip-link` có đủ kiểu dáng mà không ai đặt lên trang. Mỗi
   * cái đều làm người đọc sau tưởng việc đã xong.
   *
   * Ngày nào chốt được chấm ấy BÁO ĐIỀU GÌ thì lấy lại trong lịch sử git — nó ở commit ngay
   * trước commit này, kèm cả luật CSS.
   */
}

/**
 * Thanh tab dùng chung (AD-15) — màn Danh mục (2.1), trang chi tiết thiết bị (2.5),
 * hồ sơ phần mềm (Epic 3) đều dùng bản này. Dùng lại CSS `.tabs/.tab` sẵn có.
 *
 * Bàn phím theo chuẩn tablist: ←/→ chuyển tab, Home/End nhảy đầu/cuối. Không có cái này
 * thì tab chỉ bấm được bằng chuột — màn Danh mục là màn nhập liệu, người dùng đi bằng Tab.
 */
export function Tabs({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const move = (delta: number) => {
    const index = items.findIndex((item) => item.key === value);
    const next = items[(index + delta + items.length) % items.length];
    onChange(next.key);
    refs.current[next.key]?.focus();
  };

  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.key}
          ref={(el) => {
            refs.current[item.key] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${item.key}`}
          aria-selected={item.key === value}
          /*
           * `aria-controls` CHỈ trên tab đang chọn (19/09/2026).
           *
           * Bản trước đặt nó lên MỌI tab, trỏ tới `tabpanel-<khoá>` của từng tab. Nhưng cả bốn
           * trang chi tiết (và `catalog`, `expiry`, `approvals`) đều render đúng MỘT `TabPanel`
           * — cái của tab đang chọn. Nên với mọi tab còn lại, `aria-controls` trỏ vào một id
           * không tồn tại: axe báo `aria-valid-attr-value`, và người dùng JAWS đứng ở tab "Cổng"
           * chưa bấm rồi ra lệnh "nhảy tới khu được điều khiển" thì không có gì để nhảy tới.
           *
           * Hai đường sửa: render đủ mọi panel rồi ẩn bằng `hidden` (đúng cách đợt này vừa làm
           * cho `#rmap-cut-sum`), hoặc chỉ khai quan hệ khi nó CÓ THẬT. Chọn cách sau vì render
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
            SỐ 0 THÌ KHÔNG VẼ SỐ (18/09/2026).
            `!== undefined` để số 0 lọt, nên tab hiện ra "Giấy tờ 0" — đo trên trình duyệt
            thật thì tab Giấy tờ và Két sắt của một hồ sơ trống đều mang đuôi "0". Con số đó
            không nói thêm gì so với việc mở tab ra và thấy khu rỗng, mà lại làm tab trông như
            đang hỏng. `_SPEC.md:61` xếp đây là lỗi số 7 của đợt.
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
      ))}
    </div>
  );
}

/** Vùng nội dung của một tab — gắn aria đúng cặp với `Tabs`. */
export function TabPanel({ tabKey, children }: { tabKey: string; children: ReactNode }) {
  return (
    <div
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
