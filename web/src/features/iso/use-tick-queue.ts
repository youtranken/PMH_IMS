import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { ISO_TODO_KEY } from '@/shell/use-iso-todo';
import { ISO_KEY } from './iso-api';
import type { TickResult } from './iso-types';

/**
 * Ghi ô 0203 theo kiểu "đổi ngay, gửi sau": ô đổi ngay lúc bấm (`pending`), request chạy nền.
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
  month: string,
  { onSaved, onError }: { onSaved: (lineId: string, day: string, result: TickResult | null) => void; onError: (err: unknown) => void },
) {
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
      queryClient.invalidateQueries({ queryKey: [...ISO_KEY, 'backup', month] }),
      queryClient.invalidateQueries({ queryKey: ISO_TODO_KEY }),
    ]);

  const run = (lineId: string, day: string, value: TickResult | null): void => {
    const key = `${lineId}|${day}`;
    const next = () => {
      const queued = inflight.current.get(key);
      if (queued === undefined) return false;
      inflight.current.set(key, undefined);
      run(lineId, day, queued);
      return true;
    };
    apiFetch('/api/v1/iso/backup/ticks', { method: 'PUT', csrfToken, body: JSON.stringify({ lineId, day, result: value }) }).then(
      async () => {
        if (next()) return;
        inflight.current.delete(key);
        // Lượt lưu đã xong: lỗi khi làm mới hay báo kết quả không được biến thành "lưu hỏng".
        await refresh().catch(() => undefined);
        drop(key, value);
        onSaved(lineId, day, value);
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

  const set = (lineId: string, day: string, value: TickResult | null) => {
    const key = `${lineId}|${day}`;
    setPending((m) => new Map(m).set(key, value));
    if (inflight.current.has(key)) {
      inflight.current.set(key, value);
      return;
    }
    inflight.current.set(key, undefined);
    run(lineId, day, value);
  };

  return { pending, set };
}
