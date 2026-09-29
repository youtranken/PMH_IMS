import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { titleKeyOf } from '@/lib/routes';

/**
 * Đặt tên tab trình duyệt theo màn đang mở.
 *
 * ===== GỌI MỘT LẦN, Ở `AppRoutes` =====
 *
 * Không phải mỗi màn tự gọi. Mười lăm nơi gọi là mười lăm cơ hội quên, và cái quên đó KHÔNG
 * làm gì đỏ — trang vẫn dựng ra bình thường, chỉ có tab đội tên của màn trước. Đặt ở chỗ đã
 * biết `pathname` thì thêm màn mới chỉ phải khai một dòng trong `ROUTE_TITLE_KEY`, và
 * `routes.test.ts` đỏ nếu quên cả dòng đó.
 *
 * ===== VÌ SAO TÊN MÀN ĐỨNG TRƯỚC =====
 *
 * Tab bị bóp còn ~15 ký tự khi mở nhiều tab, và trình duyệt cắt ĐUÔI. "IMS · Thiết bị" thì
 * bốn tab IMS đọc y hệt nhau — đúng cảnh đang phải sửa. Tên màn trước thì phần sống sót là
 * phần phân biệt được.
 *
 * Đường lạ (404, màn đăng nhập) chỉ đội tên sản phẩm: `titleKeyOf` trả `null` và ta KHÔNG
 * đoán bừa, vì một cái tab mang tên màn có thật nói rằng trang ấy tồn tại.
 */
export function usePageTitle(): void {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  useEffect(() => {
    const key = titleKeyOf(pathname);
    const brand = t('app.brand');
    document.title = key ? `${t(key)} · ${brand}` : brand;
  }, [pathname, t]);
}
