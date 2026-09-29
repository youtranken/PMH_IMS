import type { AssignmentRow } from './license-assignment.service';
import { assignmentExportSheet } from './license-assignments-export';

const seat = (over: Partial<AssignmentRow>): AssignmentRow => ({
  id: 'a1',
  softwareId: 's1',
  deviceId: 'd1',
  deviceCode: 'PC-E2E-01',
  deviceName: 'Máy kế toán',
  deviceAssignedTo: 'Nguyễn Văn An',
  assignedBy: 'sa@pmh.com.vn',
  assignedAt: new Date('2026-09-09T23:00:00Z'),
  releasedBy: null,
  releasedAt: null,
  overSeatReason: null,
  note: null,
  cost: null,
  contract: null,
  startDate: null,
  endDate: null,
  ...over,
});

describe('Xuất danh sách máy đang dùng một license (SW-057)', () => {
  const sheet = (rows: AssignmentRow[]) => assignmentExportSheet(rows, 'Asia/Ho_Chi_Minh');
  const cells = (rows: AssignmentRow[]) => {
    const { columns, rows: out } = sheet(rows);
    return out.map((row) => columns.map((column) => column.value(row)));
  };

  it('mỗi ghế một dòng: mã máy, tên, người dùng, chi phí, kỳ hạn, giờ gán theo giờ VN', () => {
    const [first] = cells([seat({ cost: 2_400_000, contract: 'HĐ-01', endDate: '2027-01-01' })]);
    const header = sheet([]).columns.map((column) => column.header);
    const byHeader = Object.fromEntries(header.map((name, i) => [name, first[i]]));
    expect(byHeader).toMatchObject({
      'Mã máy': 'PC-E2E-01',
      'Tên máy': 'Máy kế toán',
      'Người dùng máy': 'Nguyễn Văn An',
      'Chi phí (₫)': 2_400_000,
      'Số hợp đồng': 'HĐ-01',
      'Hết hạn ghế': '2027-01-01',
      'Gán bởi': 'sa@pmh.com.vn',
    });
    expect(String(byHeader['Gán lúc'])).toContain('10/09/2026');
  });

  it('dòng cuối là tổng số máy + tổng chi phí, ghế không khai chi phí không làm hỏng phép cộng', () => {
    const out = cells([seat({ cost: 1_000_000 }), seat({ id: 'a2', cost: null }), seat({ id: 'a3', cost: 500 })]);
    const last = out[out.length - 1];
    expect(out).toHaveLength(4);
    expect(last[0]).toBe('Tổng: 3 máy');
    expect(last).toContain(1_000_500);
  });

  it('không có ghế nào thì không có dòng tổng', () => {
    expect(cells([])).toEqual([]);
  });
});
