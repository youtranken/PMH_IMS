import { incidentExportColumns, matchesIncidentSearch } from './iso-incident-export';
import type { IncidentRecord } from './iso-incident.service';

function record(over: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: 'i1',
    code: '0206-2026-007',
    year: 2026,
    month: 10,
    reportedOn: '2026-10-05',
    kind: 'backup',
    detectedAt: '2026-10-04T19:30:00.000Z',
    resolvedAt: null,
    severity: 'high',
    status: 'in_progress',
    description: 'Job sao lưu SQL lỗi',
    correctiveAction: 'Chạy lại job',
    backupDetails: [],
    createdBy: 'u1',
    createdByName: 'Nguyễn Văn Á',
    createdAt: new Date('2026-10-05T01:00:00Z'),
    contentUpdatedAt: new Date('2026-10-05T01:00:00Z'),
    cells: [{ form: '0203', lineId: 'l1', day: '2026-10-04', issueId: null, label: 'SQL-PROD › Ổ D' }],
    governing: ['0203'],
    locked: false,
    inReview: false,
    signedCurrent: false,
    signed: [],
    ...over,
  };
}

describe('Xuất Excel danh sách 0206 (UX-E31)', () => {
  // Cùng các trường ô tìm của màn tìm tại chỗ: không dấu, không hoa.
  it.each([
    ['', true],
    ['0206-2026-007', true],
    ['sao luu sql', true],
    ['nguyen van a', true],
    ['o d', true],
    ['khong co', false],
  ])('tìm %j → %s', (q, hit) => {
    expect(matchesIncidentSearch(record(), q)).toBe(hit);
  });

  it('cột theo mẫu danh sách; giờ in theo múi giờ ứng dụng; trống thì để trống', () => {
    const columns = incidentExportColumns('Asia/Ho_Chi_Minh');
    const row = record();
    const out = Object.fromEntries(columns.map((c) => [c.header, c.value(row)]));
    expect(out).toEqual({
      'Số phiếu': '0206-2026-007',
      'Kỳ': '10/2026',
      'Nguồn': '0203 · SQL-PROD › Ổ D',
      'Loại': 'Backup',
      'Mức độ': 'High',
      'Phát hiện': '05/10/2026 02:30',
      'Xử lý xong': '',
      'Trạng thái': 'In Progress',
      'Mô tả': 'Job sao lưu SQL lỗi',
      'Khắc phục': 'Chạy lại job',
      'Người lập': 'Nguyễn Văn Á',
      'Bản ký': 'Chưa có',
    });
  });

  it('phiếu lập thẳng ghi nguồn "Lập trực tiếp"; có bản ký hiện hành ghi "Đã có"', () => {
    const columns = incidentExportColumns('Asia/Ho_Chi_Minh');
    const row = record({ cells: [], signedCurrent: true });
    const value = (header: string) => columns.find((c) => c.header === header)!.value(row);
    expect(value('Nguồn')).toBe('Lập trực tiếp');
    expect(value('Bản ký')).toBe('Đã có');
  });
});
