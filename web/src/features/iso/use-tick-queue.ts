import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { ISO_TODO_KEY } from '@/shell/use-iso-todo';
import { ISO_KEY } from './iso-api';
import type { TickResult } from './iso-types';

const TARGET = {
  '0203': { url: '/api/v1/iso/backup/ticks', idField: 'lineId', grid: 'backup' },
  '0208': { url: '/api/v1/iso/antivirus/marks', idField: 'issueId', grid: 'antivirus' },
} as const;

/**
 * Ghi ô lưới 0203 (dòng job) / 0208 (dòng máy) theo kiểu "đổi ngay, gửi sau": ô đổi ngay lúc bấm (`pending`), request chạy nền.
 *
 * Mỗi ô chỉ một request bay cùng lúc. Bấm tiếp trong lúc đó thì chỉ nhớ giá trị CUỐI và gửi khi
 * request trước xong — kể cả khi request trước hỏng: lần bấm sau là ý định mới nhất của người dùng,
 * không được mất theo lỗi của lần trước. Ô chỉ về theo server (kèm báo lỗi) khi chính giá trị cuối
 * gửi không được.
 *
 * Mỗi lượt lưu chỉ làm mới lưới của tháng đó và số việc trên menu — không cả nhánh `['iso']`: đánh
 * 30 ô liền thì 30 lượt làm mới danh sách sự cố, kỳ phiếu… là tải thừa.
 */
export function useTickQueue(
  csrfToken: string,
  form: keyof typeof TARGET,
  month: string,
  { onSaved, onError }: { onSaved: (rowId: string, day: string, result: TickResult | null) => void; onError: (err: unknown) => void },
) {
  const target = TARGET[form];
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ReadonlyMap<string, TickResult | null>>(() => new Map());
  /** Ô đang có request bay → giá trị chờ gửi tiếp (`undefined` = không có). */
  const inflight = useRef(new Map<string, TickResult | null | undefined>());

  const drop = (key: string, value?: TickResult | null) =>
    setPending((m) => {
      if (!m.has(key) || (value !== undefined && m.get(key) !== value)) return m;
      const next = new Map(m);
      next.delete(key);
      return next;
    });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [...ISO_KEY, target.grid, month] }),
      queryClient.invalidateQueries({ queryKey: ISO_TODO_KEY }),
    ]);

  const run = (rowId: string, day: string, value: TickResult | null): void => {
    const key = `${rowId}|${day}`;
    const next = () => {
      const queued = inflight.current.get(key);
      if (queued === undefined) return false;
      inflight.current.set(key, undefined);
      run(rowId, day, queued);
      return true;
    };
    apiFetch(target.url, { method: 'PUT', csrfToken, body: JSON.stringify({ [target.idField]: rowId, day, result: value }) }).then(
      async () => {
        if (next()) return;
        inflight.current.delete(key);
        // Lượt lưu đã xong: lỗi khi làm mới hay báo kết quả không được biến thành "lưu hỏng".
        await refresh().catch(() => undefined);
        drop(key, value);
        onSaved(rowId, day, value);
      },
      (err: unknown) => {
        if (next()) return;
        inflight.current.delete(key);
        drop(key);
        void refresh();
        onError(err);
      },
    );
  };

  const set = (rowId: string, day: string, value: TickResult | null) => {
    const key = `${rowId}|${day}`;
    setPending((m) => new Map(m).set(key, value));
    if (inflight.current.has(key)) {
      inflight.current.set(key, value);
      return;
    }
    inflight.current.set(key, undefined);
    run(rowId, day, value);
  };

  return { pending, set };
}
