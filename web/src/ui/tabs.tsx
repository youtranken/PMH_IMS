import { useEffect, useRef, type ReactNode } from 'react';

export interface TabItem {
  key: string;
  label: ReactNode;
  /** Số nhỏ bên phải nhãn (vd số dòng trong tab). */
  count?: number;
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
          aria-controls={`tabpanel-${item.key}`}
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
          {item.count !== undefined ? <span className="tab-count">{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Vùng nội dung của một tab — gắn aria đúng cặp với `Tabs`. */
export function TabPanel({ tabKey, children }: { tabKey: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`tabpanel-${tabKey}`} aria-labelledby={`tab-${tabKey}`}>
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
