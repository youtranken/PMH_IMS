import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Bản đồ quan hệ của một thiết bị: hạch ở giữa, mỗi sợi dây đi ra một thứ máy đang giữ.
 *
 * VÌ SAO MÀN NÀY CẦN NÓ. Câu hỏi thật của trang chi tiết thiết bị — chính chú thích trong
 * `devices.service.ts` viết ra — là "trước khi thanh lý, máy còn giữ gì". Với thanh tab, câu
 * trả lời nằm rải ở bốn chỗ và phải bấm bốn lần. Tab tối ưu cho việc LÀM MỘT VIỆC; màn này
 * việc chính lại là NHÌN TOÀN CẢNH.
 *
 * Bản đồ KHÔNG thay dữ liệu, nó là tầng điều hướng: nút nào có tab riêng thì bấm là chuyển
 * tab, nút nào là một thẻ ngay dưới thì bấm là nhảy tới thẻ đó. Mọi khu vẫn nằm nguyên.
 *
 * CHỈ VẼ QUAN HỆ — thứ là một bản ghi khác (IP, rule NAT, cổng, đường truyền, ghế license,
 * secret, giấy tờ). Thuộc tính của chính máy (trạng thái, vị trí, người dùng, bảo hành) nằm ở
 * thẻ định danh bên phải; vẽ lại ở đây là in hai lần một giá trị.
 *
 * KHÔNG dùng thư viện vẽ: mấy thư viện đồ thị chạy mô phỏng vật lý, mở hai lần ra hai hình
 * khác nhau, nút còn rung. Đây là hồ sơ tài sản, không phải đồ chơi — lưới CSS cố định.
 */

/** Một thứ máy đang giữ. `count` là số dòng thật, không phải ước lượng. */
export interface RelationNode {
  key: string;
  title: string;
  count: number;
  icon: IconKey;
  /** Một hai dòng xem trước lấy từ chính dữ liệu — để nhìn là biết, khỏi bấm vào. */
  lines: { text: string; tone?: 'warn' | 'danger'; mono?: boolean }[];
  /**
   * Sợi này BỊ GỠ khi thanh lý chọn "Gỡ hết rồi thanh lý" — dây nối vẽ nét đứt đỏ.
   * Lấy theo các file `*-device-retirement.ts` bên API, không phải đoán.
   */
  cut: boolean;
  onOpen: () => void;
}

export type IconKey = 'port' | 'arrow' | 'ip' | 'globe' | 'lic' | 'lock' | 'doc';

const ICON: Record<IconKey, ReactNode> = {
  port: (
    <>
      <rect x="3" y="8" width="18" height="8" rx="2" />
      <path d="M7 8V6M12 8V6M17 8V6" />
    </>
  ),
  arrow: <path d="M4 7h13l-3-3M20 17H7l3 3" />,
  ip: (
    <>
      <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" />
    </>
  ),
  lic: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M4.9 4.9l2.9 2.9M16.2 16.2l2.9 2.9M2 12h4M18 12h4" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
};

function Glyph({ name }: { name: IconKey }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {ICON[name]}
    </svg>
  );
}

/* --- Bố cục: LƯỚI BA CỘT CỐ ĐỊNH ---------------------------------------------
 * Nút chia đều hai cột trái/phải, hạch ở cột giữa. Toạ độ phần trăm trên một hình bầu dục
 * (bản trước) đè nút lên hạch và lên nhau khi cột chính hẹp lại, vì khung co còn chữ thì
 * không. Lưới thì không chồng được: mỗi nút có ô riêng, cách hạch bằng đúng một khe cột, và
 * nút cao theo nội dung nên số đếm không bao giờ bị cắt ở mép.
 *
 * Dây nối là đường kẻ CSS (xem `.rmap-col` trong css/relation-map.css), không phải SVG tính
 * toạ độ — nên hình vẫn y hệt giữa hai lần mở, và không có phép tính nào để lệch.
 * -------------------------------------------------------------------------- */

/** Mã dài thì thu cỡ chữ của hạch: mã KHÔNG được ngắt giữa chừng (DEV-043). */
function hubSize(code: string): string {
  if (code.length > 18) return ' xs';
  if (code.length > 13) return ' sm';
  return '';
}

export function RelationMap({
  hubCode,
  nodes,
  missing,
  isUnknown = false,
  isLoading = false,
}: {
  hubCode: string;
  nodes: RelationNode[];
  /** Tên những khu máy này KHÔNG có — gom về một dòng, không vẽ ô rỗng. */
  missing: string[];
  /**
   * CHƯA ĐỌC ĐƯỢC nguồn nuôi bản đồ (lượt gọi đang bay, hoặc vừa hỏng).
   *
   * Không có cờ này thì mọi nguồn lỗi đều đi qua `?? []` và hoá thành danh sách rỗng — bản
   * đồ in ra "Máy này chưa giữ gì của ai… Thanh lý nó không kéo theo gì cả" cho một cái máy
   * đang giữ IP, rule NAT và ghế license.
   */
  isUnknown?: boolean;
  /**
   * CHƯA BIẾT VÌ ĐANG TẢI — khác hẳn chưa biết vì HỎNG.
   *
   * Cả hai đều phải chặn câu "máy này chưa giữ gì" và dòng "Chưa gắn:", nhưng câu nói ra
   * không được giống nhau: `relationMap.unknown` là lời cảnh báo kèm chỉ dẫn, đúng cho lúc
   * hỏng và sai cho một nhịp chờ vài trăm mili giây. Bật cờ này thì khu nói "Đang đọc…".
   */
  isLoading?: boolean;
}) {
  const { t } = useTranslation();

  const n = nodes.length;
  // Bên trái nhận nửa lớn hơn: đọc từ trái sang, nút đầu tiên luôn ở góc trên bên trái.
  const left = nodes.slice(0, Math.ceil(n / 2));
  const right = nodes.slice(Math.ceil(n / 2));

  const renderNode = (node: RelationNode) => (
    <button
      key={node.key}
      type="button"
      className={`rmap-node ${node.cut ? 'cut' : 'keep'}`}
      onClick={node.onOpen}
      // Dòng xem trước có thể bị rút gọn; `title` cho đọc trọn khi rê chuột.
      title={node.lines.map((line) => line.text).join('\n') || undefined}
    >
      <span className="rn-h">
        <Glyph name={node.icon} />
        <span className="rn-t">{node.title}</span>
        <b className="rn-n">{node.count}</b>
      </span>
      {node.lines.map((line, i) => (
        <span
          key={i}
          className={`rn-i${line.tone ? ` ${line.tone}` : ''}${line.mono ? ' mono' : ''}`}
        >
          {line.text}
        </span>
      ))}
    </button>
  );

  return (
    <section className="rmap-card">
      <div className="rmap-head">
        <h2>{t('relationMap.title')}</h2>
        <div className="rmap-legend">
          <span>
            <i className="rmap-dot" /> {t('relationMap.legendOk')}
          </span>
          <span>
            <i className="rmap-dot warn" /> {t('relationMap.legendWarn')}
          </span>
          <span>
            <i className="rmap-dot cut" /> {t('relationMap.legendCut')}
          </span>
        </div>
      </div>

      {/* Máy chưa giữ gì: KHÔNG vẽ hạch đứng một mình với câu đè lên nó — chỉ còn câu. Chưa
          biết thì không vẽ gì cả, dòng trạng thái bên dưới nói thay. */}
      {n > 0 ? (
        <div className="rmap">
          <div className="rmap-col left" data-testid="rmap-left">
            {left.map(renderNode)}
          </div>
          <div className="rmap-hub-col">
            <div className={`rmap-hub${hubSize(hubCode)}`} data-testid="rmap-hub">
              {hubCode}
            </div>
          </div>
          <div className="rmap-col right" data-testid="rmap-right">
            {right.map(renderNode)}
          </div>
        </div>
      ) : !isUnknown ? (
        <p className="rmap-alone">{t('relationMap.alone')}</p>
      ) : null}

      {/* Màn hẹp: cùng danh sách ấy ở dạng dòng, bấm ra cùng chỗ. Đây cũng là bản mà trình
          đọc màn hình đi qua khi bản đồ bị ẩn. */}
      <div className="rmap-list">
        {n === 0 ? (
          <button type="button" disabled>
            {/* Bản NGẮN: câu đầy đủ kèm chỉ dẫn chỉ được nói một chỗ (`.rmap-blank` bên dưới),
                và nút `disabled` bị mờ 50% nên không được là chỗ mang lời cảnh báo. */}
            <span>
              {isLoading
                ? t('relationMap.loadingShort')
                : isUnknown
                  ? t('relationMap.unknownShort')
                  : t('relationMap.aloneShort')}
            </span>
          </button>
        ) : (
          nodes.map((node) => (
            <button key={node.key} type="button" onClick={node.onOpen}>
              <span>{node.title}</span>
              <span className="rl-i">{node.lines[0]?.text ?? ''}</span>
              <span className="badge">{node.count}</span>
            </button>
          ))
        )}
      </div>

      {/*
        MỘT `<p>` THƯỜNG TRỰC, CHỈ ĐỔI CHỮ BÊN TRONG: vùng sống phải có mặt từ lượt render đầu
        thì chữ đổi sau đó mới được đọc lên. Dòng "Chưa gắn:" là một KHẲNG ĐỊNH về thứ máy
        không có, nên chưa đọc được nguồn thì nó nhường chỗ cho câu nói thật về việc chưa biết.
      */}
      <p className="rmap-blank" role="status" hidden={!isLoading && !isUnknown && missing.length === 0}>
        {isLoading
          ? t('relationMap.loading')
          : isUnknown
            ? t('relationMap.unknown')
            : missing.length > 0
              ? t('relationMap.missing', { list: missing.join(', ') })
              : null}
      </p>
    </section>
  );
}
