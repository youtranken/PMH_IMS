import { useRef, type ReactNode } from 'react';

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
