import { useEffect, useState } from 'react';
import { watermarkText } from './drawio-protocol';

/** Số dòng watermark lặp trên khung: đủ phủ một màn lớn mà không phải đo kích thước. */
const WATERMARK_ROWS = 8;

/**
 * Watermark "tên · email · giờ:phút" phủ lên trình vẽ và trình xem sơ đồ (AD-17). Không có prop
 * tắt: ảnh chụp màn hình một bản vẽ luôn mang tên người chụp. Lớp `pointer-events: none` nên
 * không chặn thao tác bên dưới.
 */
export function DiagramWatermark({ viewer }: { viewer: { fullName: string; email: string } }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const mark = watermarkText(viewer, now);
  return (
    <div className="drawio-watermark" aria-hidden="true">
      {Array.from({ length: WATERMARK_ROWS }, (_, i) => (
        <span key={i}>{mark}</span>
      ))}
    </div>
  );
}
