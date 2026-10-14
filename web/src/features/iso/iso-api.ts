import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import type {
  AntivirusGrid,
  BackupGrid,
  Division,
  FormOwners,
  Incident,
  IsoFormType,
  Job,
  PeriodDetail,
  UnlinkedCell,
  YearOverview,
} from './iso-types';

/**
 * Mọi khoá truy vấn của phiếu ISO nằm dưới `['iso']` — kể cả số trên menu (`shell/use-iso-todo`):
 * một lượt ghi làm mới cả nhánh, lưới / danh sách 0206 / Kỳ phiếu / badge không lệch nhau.
 */
export const ISO_KEY = ['iso'] as const;

export function useBackupGrid(month: string, enabled = true) {
  return useQuery({
    queryKey: [...ISO_KEY, 'backup', month],
    queryFn: () => apiFetch<BackupGrid>(`/api/v1/iso/backup/${month}`),
    enabled,
  });
}

export function useAntivirusGrid(month: string, enabled = true) {
  return useQuery({
    queryKey: [...ISO_KEY, 'antivirus', month],
    queryFn: () => apiFetch<AntivirusGrid>(`/api/v1/iso/antivirus/${month}`),
    enabled,
  });
}

export function useOwners() {
  return useQuery({
    queryKey: [...ISO_KEY, 'owners'],
    queryFn: () => apiFetch<FormOwners[]>('/api/v1/iso/catalog/owners'),
  });
}

export function useJobs(status: 'live' | 'stopped' | 'all' = 'all') {
  return useQuery({
    queryKey: [...ISO_KEY, 'jobs', status],
    queryFn: () => apiFetch<Job[]>(`/api/v1/iso/catalog/jobs?status=${status}`),
  });
}

export function useDivisions() {
  return useQuery({
    queryKey: [...ISO_KEY, 'divisions'],
    queryFn: () => apiFetch<Division[]>('/api/v1/iso/catalog/divisions'),
  });
}

export function useIncident(id: string | null) {
  return useQuery({
    queryKey: [...ISO_KEY, 'incident', id],
    queryFn: () => apiFetch<Incident>(`/api/v1/iso/incidents/${id}`),
    enabled: Boolean(id),
  });
}

export function useIncidentList(query: string) {
  return useQuery({
    queryKey: [...ISO_KEY, 'incidents', query],
    queryFn: () => apiFetch<{ items: Incident[]; unlinked: UnlinkedCell[] }>(`/api/v1/iso/incidents?${query}`),
  });
}

export function useLinkable() {
  return useQuery({
    queryKey: [...ISO_KEY, 'linkable'],
    queryFn: () => apiFetch<UnlinkedCell[]>('/api/v1/iso/incidents/linkable'),
  });
}

export function usePeriodDetail(form: IsoFormType, month: string, enabled = true) {
  return useQuery({
    queryKey: [...ISO_KEY, 'period', form, month],
    queryFn: () => apiFetch<PeriodDetail>(`/api/v1/iso/periods/${form}/${month}`),
    enabled,
  });
}

export function useYearOverview(year: number) {
  return useQuery({
    queryKey: [...ISO_KEY, 'periods', year],
    queryFn: () => apiFetch<YearOverview>(`/api/v1/iso/periods?year=${year}`),
  });
}

/**
 * Lượt ghi của phiếu: gửi JSON kèm CSRF, xong thì làm mới cả nhánh `['iso']`. Trả kết quả cho nơi
 * gọi tự báo toast — câu báo thành công khác nhau theo việc.
 */
export function useIsoWrite<TInput, TResult = unknown>(
  csrfToken: string,
  request: (input: TInput) => { url: string; method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown },
) {
  const queryClient = useQueryClient();
  return useMutation<TResult, unknown, TInput>({
    mutationFn: (input) => {
      const { url, method, body } = request(input);
      return apiFetch<TResult>(url, { method, csrfToken, body: body === undefined ? undefined : JSON.stringify(body) });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ISO_KEY }),
  });
}
