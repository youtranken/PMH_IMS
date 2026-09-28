import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen, userEvent } from '@/test/test-utils';
import { ImportPreview, type ImportPreviewRow } from '@/ui/import-preview';

const ROWS: ImportPreviewRow[] = [
  { group: 'Site', rowNumber: 2, action: 'create', label: 'PMH-HO' },
  { group: 'Site', rowNumber: 3, action: 'unchanged', label: 'PMH-NM' },
  { group: 'Site', rowNumber: 4, action: 'skip', label: 'Dòng ví dụ' },
  {
    group: 'Tủ mạng',
    rowNumber: 5,
    action: 'error',
    label: 'KHONG-CO · R01',
    message: 'Không có site nào mã "KHONG-CO".',
  },
];

const SUMMARY = { create: 1, update: 0, unchanged: 1, skip: 1, error: 1 };

describe('ImportPreview — bảng đối chiếu trước khi ghi', () => {
  it('mặc định chỉ hiện dòng cần chú ý, giấu dòng không đổi / bỏ qua', () => {
    renderWithI18n(<ImportPreview rows={ROWS} summary={SUMMARY} />);
    expect(screen.getByText('PMH-HO')).toBeInTheDocument();
    expect(screen.getByText('KHONG-CO · R01')).toBeInTheDocument();
    // File 300 dòng mà đổ hết ra thì đúng dòng lỗi lại bị lọt giữa đám không đổi.
    expect(screen.queryByText('PMH-NM')).not.toBeInTheDocument();
    expect(screen.queryByText('Dòng ví dụ')).not.toBeInTheDocument();
  });

  it('bấm nút thì hiện đủ mọi dòng, bấm lần nữa thì thu lại', async () => {
    const user = userEvent.setup();
    renderWithI18n(<ImportPreview rows={ROWS} summary={SUMMARY} />);

    await user.click(screen.getByRole('button', { name: /Hiện cả 2 dòng/ }));
    expect(screen.getByText('PMH-NM')).toBeInTheDocument();
    expect(screen.getByText('Dòng ví dụ')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Ẩn 2 dòng/ }));
    expect(screen.queryByText('PMH-NM')).not.toBeInTheDocument();
  });

  it('lý do lỗi hiện nguyên văn để người dùng biết sửa dòng nào trong file', () => {
    renderWithI18n(<ImportPreview rows={ROWS} summary={SUMMARY} />);
    expect(screen.getByText('Không có site nào mã "KHONG-CO".')).toBeInTheDocument();
    // Số dòng THẬT trong file Excel, không phải số thứ tự trong bảng.
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('không có dòng nào cần chú ý → mở sẵn toàn bộ, không bắt bấm thêm', () => {
    renderWithI18n(
      <ImportPreview
        rows={[{ group: 'Site', rowNumber: 2, action: 'create', label: 'PMH-HO' }]}
        summary={{ create: 1, update: 0, unchanged: 0, skip: 0, error: 0 }}
      />,
    );
    expect(screen.queryByRole('button', { name: /Hiện cả/ })).not.toBeInTheDocument();
  });

  it('file không có gì để ghi → nói rõ thay vì bảng trống trơ', () => {
    renderWithI18n(
      <ImportPreview rows={[]} summary={{ create: 0, update: 0, unchanged: 0, skip: 0, error: 0 }} />,
    );
    expect(
      screen.getByText('File khớp với dữ liệu hiện có — không có gì để ghi.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('toàn dòng không đổi → MỘT khối báo, không bảng rỗng; bấm xem thì hiện các dòng', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <ImportPreview
        rows={[{ group: 'Site', rowNumber: 2, action: 'unchanged', label: 'PMH-HO' }]}
        summary={{ create: 0, update: 0, unchanged: 1, skip: 0, error: 0 }}
      />,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Không có dòng nào cần ghi.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Hiện cả 1 dòng/ }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  /* Dòng "Cập nhật" phải cho thấy sẽ GHI ĐÈ gì — đó đúng là thứ cần soát trước khi ghi. */
  it('dòng Cập nhật liệt kê từng trường đổi: nhãn · trước → sau', () => {
    renderWithI18n(
      <ImportPreview
        rows={[
          {
            group: 'Site',
            rowNumber: 2,
            action: 'update',
            label: 'PMH-HO',
            changes: [
              { field: 'Địa chỉ', from: '12 Nguyễn Văn Bảo', to: '14 Nguyễn Văn Bảo' },
              { field: 'Có port map?', from: true, to: false },
              { field: 'Mô tả', from: null, to: 'Tủ tầng 2' },
            ],
          },
        ]}
        summary={{ create: 0, update: 1, unchanged: 0, skip: 0, error: 0 }}
      />,
    );
    expect(screen.getByText('Địa chỉ: 12 Nguyễn Văn Bảo → 14 Nguyễn Văn Bảo')).toBeInTheDocument();
    expect(screen.getByText('Có port map?: Có → Không')).toBeInTheDocument();
    expect(screen.getByText('Mô tả: — → Tủ tầng 2')).toBeInTheDocument();
  });

  it('bấm chip kết quả thì chỉ còn dòng loại đó; bấm lại thì bỏ lọc', async () => {
    const user = userEvent.setup();
    renderWithI18n(<ImportPreview rows={ROWS} summary={SUMMARY} />);
    const errorChip = screen.getByRole('button', { name: 'Lỗi: 1' });
    await user.click(errorChip);
    expect(errorChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('KHONG-CO · R01')).toBeInTheDocument();
    expect(screen.queryByText('PMH-HO')).not.toBeInTheDocument();
    await user.click(errorChip);
    expect(screen.getByText('PMH-HO')).toBeInTheDocument();
  });

  it('chip số 0 không bấm được — lọc ra bảng rỗng là hứa hão', () => {
    renderWithI18n(<ImportPreview rows={ROWS} summary={SUMMARY} />);
    expect(screen.getByRole('button', { name: 'Cập nhật: 0' })).toBeDisabled();
  });
});
