import { useEffect, useState } from 'react';
import { watermarkText } from './drawio-protocol';

/** Số dòng watermark lặp trên khung: đủ phủ một màn lớn mà không phải đo kích thước. */
const WATERMARK_ROWS = 8;
/**
 * Trình vẽ: thưa hơn (V-06, chủ dự án chốt) — 8 hàng chữ đè lên nhãn cổng làm vẽ khó, mà
 * lúc vẽ thì thuỷ vân không thêm được gì; vẫn đủ để ảnh chụp màn hình mang tên người chụp.
 */
const WATERMARK_ROWS_EDIT = 3;

/**
 * Watermark "tên · email · giờ:phút" phủ lên trình vẽ và trình xem sơ đồ (AD-17). Không có prop
 * tắt: ảnh chụp màn hình một bản vẽ luôn mang tên người chụp. Lớp `pointer-events: none` nên
 * không chặn thao tác bên dưới.
 *
 * `density="edit"` (trình vẽ) chỉ đổi MẬT ĐỘ: 3 hàng, màu nhạt hơn, nằm dưới dải menu + công cụ
 * của draw.io. Tab Xem và file xuất giữ nguyên (V-06).
 */
export function DiagramWatermark({ viewer, density }: { viewer: { fullName: string; email: string }; density?: 'edit' }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const mark = watermarkText(viewer, now);
  const layer = (
    <div className="drawio-watermark" aria-hidden="true" data-density={density}>
      {Array.from({ length: density === 'edit' ? WATERMARK_ROWS_EDIT : WATERMARK_ROWS }, (_, i) => (
        <span key={i}>{mark}</span>
      ))}
    </div>
  );
  // Lớp xoay đặt trong một vùng cắt bắt đầu dưới dải công cụ: xoay chéo thì hàng chữ không lấn lên đó.
  return density === 'edit' ? <div className="drawio-watermark-zone">{layer}</div> : layer;
}
