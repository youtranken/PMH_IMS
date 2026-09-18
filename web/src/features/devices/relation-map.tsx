import { useState, type ReactNode } from 'react';
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
 * KHÔNG dùng thư viện vẽ: SVG thuần + thẻ định vị theo phần trăm, khoảng 90 dòng tính toán.
 * Lý do không phải tiết kiệm — mà vì mấy thư viện đồ thị chạy mô phỏng vật lý: mở hai lần ra
 * hai hình khác nhau, nút còn rung. Đây là hồ sơ tài sản, không phải đồ chơi. Toạ độ tính từ
 * chỉ số nên hình luôn y hệt, và bài kiểm chụp lại được.
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
   * Sợi này BỊ CẮT khi thanh lý có tick "Dọn hết thứ liên quan".
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

/* --- Bố cục do MÃ TÍNH, không đóng đinh toạ độ ------------------------------
 * Nút xếp đều trên một hình bầu dục quanh hạch, bắt đầu từ bên trái đi theo chiều kim đồng hồ.
 * Máy có tám thứ thì tám nút, có ba thì ba nút và vòng tự co lại — KHÔNG bao giờ có ô trống,
 * vì không có ô nào được đóng đinh sẵn. Đây là câu trả lời cho "máy chỉ có 3 thứ thì sao".
 * -------------------------------------------------------------------------- */
const W = 1200;
const HUB_W = 240;
const HUB_H = 100;
const ND_W = 214;
const ND_H = 96;

function heightFor(n: number): number {
  if (n === 0) return 300;
  if (n <= 2) return 420;
  if (n <= 4) return 520;
  if (n <= 6) return 640;
  return 780;
}

/** Điểm cắt của tia (dx,dy) với mép hình chữ nhật — để sợi dây chạm đúng mép, không đâm vào giữa. */
function edgePoint(cx: number, cy: number, w: number, h: number, dx: number, dy: number) {
  const tx = dx === 0 ? Infinity : w / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : h / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return [cx + dx * t, cy + dy * t] as const;
}

export function RelationMap({
  hubCode,
  nodes,
  missing,
  cutSummary,
  chuaBiet = false,
}: {
  hubCode: string;
  nodes: RelationNode[];
  /** Tên những khu máy này KHÔNG có — gom về một dòng, không vẽ ô rỗng. */
  missing: string[];
  /** Câu nói rõ lượt thanh lý cắt gì, giữ gì. Không có thì không hiện nút chế độ. */
  cutSummary?: ReactNode;
  /**
   * CHƯA ĐỌC ĐƯỢC nguồn nuôi bản đồ (lượt gọi đang bay, hoặc vừa hỏng).
   *
   * Không có cờ này thì mọi nguồn lỗi đều đi qua `?? []` và hoá thành danh sách rỗng — bản
   * đồ in ra "Máy này chưa giữ gì của ai… Thanh lý nó không kéo theo gì cả" cho một cái máy
   * đang giữ IP, rule NAT và ghế license. Đo ngày 18/09/2026 bằng cách ép `/panels` trả 500:
   * đúng câu đó hiện lên, kèm "Chưa gắn:" liệt kê trọn sáu khu.
   *
   * Trang vẫn có khối `LoadError` ở dưới, nhưng nó nằm SAU bản đồ và nói ngược lại — người
   * đọc tin câu khẳng định ở trên, đó là câu họ vào đây để tìm.
   */
  chuaBiet?: boolean;
}) {
  const { t } = useTranslation();
  const [showCut, setShowCut] = useState(false);

  const n = nodes.length;
  const H = heightFor(n);
  const cx = W / 2;
  const cy = H / 2;
  const rx = n <= 3 ? 330 : n <= 5 ? 390 : 430;
  const ry = Math.max(80, H / 2 - 120);
  const pct = (value: number, total: number) => `${((value / total) * 100).toFixed(2)}%`;

  const placed = nodes.map((node, i) => {
    const angle = ((180 - i * (360 / n)) * Math.PI) / 180;
    const nx = cx + rx * Math.cos(angle);
    const ny = cy - ry * Math.sin(angle);
    const dx = nx - cx;
    const dy = ny - cy;
    const p1 = edgePoint(cx, cy, HUB_W, HUB_H, dx, dy);
    const p2 = edgePoint(nx, ny, ND_W, ND_H, -dx, -dy);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
    // Đẩy điểm điều khiển vuông góc một chút cho sợi dây cong nhẹ, đỡ khô như nan hoa.
    const ox = (-(p2[1] - p1[1]) / len) * len * 0.07;
    const oy = ((p2[0] - p1[0]) / len) * len * 0.07;
    const d = `M${p1[0].toFixed(1)},${p1[1].toFixed(1)} Q${((p1[0] + p2[0]) / 2 + ox).toFixed(1)},${(
      (p1[1] + p2[1]) / 2 +
      oy
    ).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    return { node, nx, ny, d };
  });

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
        {cutSummary ? (
          /*
            CÔNG TẮC HAI TRẠNG THÁI, PHẢI KHAI RA (18/09/2026).

            Nhãn đổi giữa "Xem lượt thanh lý cắt gì" / "Về bản đồ thường" nên mắt thấy được
            trạng thái, nhưng trình đọc màn hình thì không: không `aria-pressed` thì nó đọc ra
            hai cái nút khác nhau chứ không phải một công tắc đang bật.

            `aria-controls` trỏ tới khu tóm tắt vì khu ấy nằm ở CUỐI `<section>`, cách nút cả
            danh sách nút và dòng "Chưa gắn" — không có dây nối thì người dùng bấm xong không
            biết có gì vừa hiện ra, và ở đâu.
          */
          <button
            type="button"
            className="btn sm"
            aria-pressed={showCut}
            aria-controls="rmap-cut-sum"
            onClick={() => setShowCut((on) => !on)}
          >
            {showCut ? t('relationMap.cutOff') : t('relationMap.cutOn')}
          </button>
        ) : null}
      </div>

      <div className={`rmap${showCut ? ' show-cut' : ''}`} style={{ aspectRatio: `${W} / ${H}` }}>
        {/* `preserveAspectRatio="none"` an toàn ở đây vì hộp giữ đúng tỉ lệ của viewBox, nên
            tỉ lệ co giãn hai chiều bằng nhau — không méo. */}
        <svg className="rmap-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          {/* Chỉ đặt class khi sợi dây THẬT SỰ có luật riêng. `e-keep` trước đây được gán cho
              mọi sợi "giữ" nhưng `relation-map.css` chưa từng khai luật nào cho nó — markup
              gọi tên một lớp không tồn tại, đúng họ lỗi mà `table.css` đã gọi tên. Sợi "giữ"
              dùng luật chung `.rmap-svg path`, thế là đủ. */}
          {placed.map(({ node, d }) => (
            <path key={node.key} className={node.cut ? 'e-cut' : undefined} d={d} />
          ))}
        </svg>

        {/* Đặt theo TÂM rồi dịch về một nửa, và KHÔNG khoá chiều cao — xem chú thích ở
            `.rmap-node` trong css/relation-map.css. */}
        <div className="rmap-hub" style={{ left: pct(cx, W), top: pct(cy, H), width: pct(HUB_W, W) }}>
          {hubCode}
        </div>

        {placed.map(({ node, nx, ny }) => (
          <button
            key={node.key}
            type="button"
            className={`rmap-node ${node.cut ? 'cut' : 'keep'}`}
            onClick={node.onOpen}
            /*
             * CHỈ khoá bề ngang, KHÔNG khoá chiều cao (17/09/2026).
             *
             * Trước đây chiều cao cũng tính theo phần trăm của khung, mà khung thì co theo bề
             * ngang cột — còn CHỮ thì không co. Khung hẹp lại là nút thấp xuống trong khi chữ
             * vẫn nguyên cỡ, nên dòng cuối bị cắt ngang. Đúng cái chủ dự án chụp được ở nút
             * "License đang cài".
             *
             * Giờ nút cao theo nội dung và neo theo TÂM (`translate(-50%, -50%)` trong CSS),
             * nên tâm vẫn nằm đúng chỗ vòng tròn tính ra.
             */
            style={{ left: pct(nx, W), top: pct(ny, H), width: pct(ND_W, W) }}
          >
            <span className="rn-h">
              <Glyph name={node.icon} />
              {node.title}
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
        ))}

        {/* Chưa biết thì KHÔNG được nói "chưa giữ gì" — hai câu đó khác hẳn nhau. */}
        {n === 0 && !chuaBiet ? (
          <p className="rmap-alone">{t('relationMap.alone')}</p>
        ) : null}
      </div>

      {/* Màn hẹp: cùng danh sách ấy ở dạng dòng, bấm ra cùng chỗ. Đây cũng là bản mà trình
          đọc màn hình đi qua khi bản đồ bị ẩn. */}
      <div className="rmap-list">
        {n === 0 ? (
          <button type="button" disabled>
            <span>{chuaBiet ? t('relationMap.unknown') : t('relationMap.aloneShort')}</span>
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

      {/* Dòng "Chưa gắn:" là một KHẲNG ĐỊNH về thứ máy không có. Chưa đọc được nguồn thì nó
          sai ở đúng chiều nguy hiểm, nên nhường chỗ cho câu nói thật về việc chưa biết. */}
      {chuaBiet ? (
        <p className="rmap-blank" role="status">
          {t('relationMap.unknown')}
        </p>
      ) : missing.length > 0 ? (
        <p className="rmap-blank">{t('relationMap.missing', { list: missing.join(', ') })}</p>
      ) : null}

      {/* `role="status"` để nội dung vừa bật ra được đọc lên, không chỉ hiện ra. */}
      {showCut && cutSummary ? (
        <div className="rmap-cut-sum" id="rmap-cut-sum" role="status">
          {cutSummary}
        </div>
      ) : null}
    </section>
  );
}
