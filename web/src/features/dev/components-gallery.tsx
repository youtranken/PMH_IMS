import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DatePicker } from '@/ui/date-picker';
import { EmptyState } from '@/ui/load-state';
import { ExpiryBadge } from '@/ui/expiry-badge';
import { FilterBar } from '@/ui/filter-bar';
import { HistoryPanel } from '@/ui/history-panel';
import { PageHeader, FormSection, Field } from '@/ui/page-header';
import { Pagination } from '@/ui/pagination';
import { SchedulePicker, describeSchedule, type ScheduleValue } from '@/ui/schedule-picker';
import { useConfirm } from '@/ui/confirm-provider';
import { useToast } from '@/ui/toast';

const TOKENS = [
  '--primary',
  '--warm',
  '--ok',
  '--warn',
  '--danger',
  '--surface',
  '--surface-2',
  '--canvas',
  '--border',
];

/**
 * `/dev/components` — bộ dùng chung sống (Story 1.5, AD-15).
 * TRƯỚC khi viết component mới, mở trang này xem đã có sẵn chưa.
 * Trang này cũng là chỗ kiểm nhanh light/dark và 390px.
 */
export function ComponentsGallery() {
  const { t } = useTranslation();
  const toast = useToast();
  const askConfirm = useConfirm();
  const [page, setPage] = useState(2);
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('2026-09-30');
  const [schedule, setSchedule] = useState<ScheduleValue>({ frequency: 'weekly', hour: 8, weekday: 1 });

  return (
    <>
      <PageHeader
        title={t('nav.components')}
        subtitle="Mọi thứ dùng chung sống ở đây. Cần gì mở xem trước, đừng viết bản riêng (AD-15)."
      />

      <section className="kit-section">
        <h2>Màu nền tảng — nguồn duy nhất là tokens.css</h2>
        <div className="kit-row">
          {TOKENS.map((token) => (
            <div key={token} className="kit-swatch" style={{ background: `var(${token})` }}>
              {token}
            </div>
          ))}
        </div>
      </section>

      <section className="kit-section">
        <h2>Nút</h2>
        <div className="kit-row">
          <button type="button" className="btn primary">
            Nút chính
          </button>
          <button type="button" className="btn">
            Nút phụ
          </button>
          <button type="button" className="btn warm">
            Nút nhấn mạnh
          </button>
          <button type="button" className="btn danger">
            Nút nguy hiểm
          </button>
          <button type="button" className="btn ghost">
            Nút mờ
          </button>
          <button type="button" className="btn sm">
            Nút nhỏ
          </button>
        </div>
      </section>

      <section className="kit-section">
        <h2>Nhãn trạng thái hạn — ExpiryBadge (một luật duy nhất)</h2>
        <div className="kit-row">
          <ExpiryBadge end="2026-08-01" />
          <ExpiryBadge end="2026-08-25" />
          <ExpiryBadge end="2026-09-10" />
          <ExpiryBadge end="2027-01-01" />
          <ExpiryBadge end={null} />
        </div>
      </section>

      <section className="kit-section">
        <h2>Thông báo &amp; xác nhận — useToast / useConfirm</h2>
        <div className="kit-row">
          <button type="button" className="btn" onClick={() => toast({ message: 'Đã lưu thay đổi.' })}>
            Toast thành công
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => toast({ message: 'Không kết nối được máy chủ.', tone: 'error' })}
          >
            Toast lỗi
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              void (async () => {
                const ok = await askConfirm({
                  message: 'Thu hồi IP 172.16.10.25 khỏi thiết bị SW-CORE-01?',
                  danger: true,
                });
                toast({ message: ok ? 'Đã thu hồi.' : 'Đã hủy.', tone: ok ? 'ok' : 'warn' });
              })();
            }}
          >
            Hộp thoại xác nhận
          </button>
        </div>
      </section>

      <section className="kit-section">
        <h2>Thanh lọc &amp; phân trang</h2>
        <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Tìm thiết bị…" />
        <Pagination page={page} limit={20} total={137} onPageChange={setPage} />
      </section>

      <section className="kit-section">
        <h2>Form</h2>
        <FormSection title="Thông tin chung">
          <Field label="Tên thiết bị" required htmlFor="demo-name">
            <input id="demo-name" className="inp" placeholder="Switch tầng 3" />
          </Field>
          <Field label="Hạn bảo hành" htmlFor="demo-date" hint="Tự tính từ ngày mua nếu để trống">
            <DatePicker value={date} onChange={setDate} id="demo-date" />
          </Field>
          <Field label="Ghi chú" span={3} htmlFor="demo-note" error="Ví dụ thông báo lỗi">
            <input id="demo-note" className="inp" aria-invalid="true" />
          </Field>
        </FormSection>
      </section>

      <section className="kit-section">
        <h2>Lịch định kỳ — SchedulePicker</h2>
        <SchedulePicker value={schedule} onChange={setSchedule} />
        <p className="muted">{describeSchedule(schedule)}</p>
      </section>

      <section className="kit-section">
        <h2>Lịch sử nghiệp vụ — HistoryPanel (AD-13)</h2>
        <HistoryPanel
          entries={[
            {
              id: '1',
              at: '2026-08-20T02:15:00Z',
              actor: 'caothuan@pmh.com.vn',
              action: 'Gia hạn license Office 365',
              detail: 'Hạn cũ 30/08/2026 → hạn mới 30/08/2027',
            },
            {
              id: '2',
              at: '2026-08-12T09:03:00Z',
              actor: 'sa@pmh.com.vn',
              action: 'Cấp IP 172.16.10.25 cho SW-CORE-01',
            },
          ]}
        />
      </section>

      <section className="kit-section">
        <h2>Trạng thái rỗng</h2>
        <EmptyState title="Chưa có thiết bị nào trong tủ này." hint="Thêm thiết bị hoặc đổi bộ lọc để xem dữ liệu." />
      </section>
    </>
  );
}
