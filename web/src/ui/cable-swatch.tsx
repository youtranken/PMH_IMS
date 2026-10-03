/**
 * Vạch màu của một loại dây (AD-18): màu là ô màu token `--diagram-cable-<n>` (`cable_type.color_slot`),
 * không phải mã màu — nên Danh mục, chú giải bản vẽ, sơ đồ cổng và nét trên trình xem luôn một màu
 * và đổi theo theme. `paint` cho ô màu đặc biệt (`warn` = chưa khai, `danger` = kết nối đã gỡ).
 */
export function CableSwatch({ slot, paint }: { slot?: number | null; paint?: 'warn' | 'danger' }) {
  return <span className="cable-swatch" data-ims-paint={paint ?? `cable-${slot ?? 0}`} aria-hidden="true" />;
}
