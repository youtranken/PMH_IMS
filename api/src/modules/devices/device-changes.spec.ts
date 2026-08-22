import { diffDevice, hasChanges } from './device-changes';

describe('diffDevice — chỉ ghi vào lịch sử thứ THẬT SỰ đổi (story 2.2, AD-13)', () => {
  it('trường không có trong bản sửa = không đụng tới, không vào lịch sử', () => {
    const changes = diffDevice(
      { name: 'Switch tầng 3', serial: 'FOC1234', note: 'ghi chú cũ' },
      { name: 'Switch tầng 3 mới' },
    );
    expect(Object.keys(changes)).toEqual(['name']);
    expect(changes.name).toEqual({ before: 'Switch tầng 3', after: 'Switch tầng 3 mới' });
  });

  it('có mặt nhưng để null = XÓA giá trị, có vào lịch sử', () => {
    const changes = diffDevice({ serial: 'FOC1234' }, { serial: null });
    expect(changes.serial).toEqual({ before: 'FOC1234', after: null });
  });

  it.each([
    ['null vs chuỗi rỗng', null, ''],
    ['chuỗi rỗng vs khoảng trắng', '', '   '],
    ['undefined vs null', undefined, null],
    ['giá trị y hệt', 'FOC1234', 'FOC1234'],
    ['chỉ khác khoảng trắng thừa', 'FOC1234', ' FOC1234 '],
  ])('%s → KHÔNG tính là thay đổi', (_label, before, after) => {
    expect(hasChanges(diffDevice({ serial: before }, { serial: after }))).toBe(false);
  });

  it('ngày so theo NGÀY LỊCH, Date và chuỗi YYYY-MM-DD là một', () => {
    const changes = diffDevice(
      { warrantyEnd: new Date('2027-08-30T00:00:00Z') },
      { warrantyEnd: '2027-08-30' },
    );
    expect(hasChanges(changes)).toBe(false);
  });

  it('đổi hạn bảo hành thì ghi rõ hạn cũ → hạn mới', () => {
    const changes = diffDevice({ warrantyEnd: '2026-08-30' }, { warrantyEnd: '2027-08-30' });
    expect(changes.warrantyEnd).toEqual({ before: '2026-08-30', after: '2027-08-30' });
  });

  it('bỏ qua trường ngoài danh sách theo dõi (id, thời điểm hệ thống)', () => {
    const changes = diffDevice(
      { id: 'a', updatedAt: new Date('2026-01-01') },
      { id: 'b', updatedAt: new Date('2026-08-22'), name: 'Tên mới' },
    );
    expect(Object.keys(changes)).toEqual(['name']);
  });

  it('đổi nhiều trường một lần thì ghi hết trong một bản ghi lịch sử', () => {
    const changes = diffDevice(
      { status: 'in_use', cabinetId: 'r01', assignedTo: 'anh Nam' },
      { status: 'broken', cabinetId: null, assignedTo: 'anh Nam' },
    );
    expect(Object.keys(changes).sort()).toEqual(['cabinetId', 'status']);
  });
});
