/**
 * Logo PMH (Q-19). Ảnh nằm ở `public/brand/` — file tĩnh, KHÔNG đi qua bundle, nên đổi logo
 * không làm đổi hash JS. WebP trước, PNG dự phòng cho trình duyệt cũ.
 *
 * `width`/`height` là kích thước thật của file: trình duyệt giữ chỗ đúng tỉ lệ trước khi ảnh về,
 * card không giật xuống khi logo tải xong. Cỡ hiển thị do CSS của nơi dùng quyết định.
 *
 * `alt` để trống khi đứng cạnh chữ đã nói tên (sidebar: "IMS"); trình đọc màn hình không cần
 * nghe tên hai lần.
 */
const LOGO = { base: '/brand/pmh-logo', width: 480, height: 354 };
const EMBLEM = { base: '/brand/pmh-emblem', width: 191, height: 192 };

function BrandPicture({
  asset,
  alt,
  className,
  lazy,
}: {
  asset: typeof LOGO;
  alt: string;
  className?: string;
  lazy?: boolean;
}) {
  return (
    <picture className={className}>
      <source srcSet={`${asset.base}.webp`} type="image/webp" />
      <img
        src={`${asset.base}.png`}
        width={asset.width}
        height={asset.height}
        alt={alt}
        decoding="async"
        // Ảnh nằm trong khối bị CSS ẩn ở một khổ màn: `lazy` để khổ đó không tải nó về.
        loading={lazy ? 'lazy' : undefined}
      />
    </picture>
  );
}

/** Logo đầy đủ: biểu tượng + chữ "Phu My Hung" màu xám sáng — chỉ đặt trên nền tối. */
export function BrandLogo(props: { alt: string; className?: string; lazy?: boolean }) {
  return <BrandPicture asset={LOGO} {...props} />;
}

/**
 * Chỉ biểu tượng vàng, không chữ: chỗ hẹp (sidebar, đầu card trên điện thoại). Hình thoi phải
 * đủ bốn góc: thiếu góc dưới thì nhìn như logo bị cắt.
 */
export function BrandEmblem(props: { alt: string; className?: string; lazy?: boolean }) {
  return <BrandPicture asset={EMBLEM} {...props} />;
}
