import { Injectable } from '@nestjs/common';
import { IsoIncidentService, type IncidentSummary } from './iso-incident.service';

export type { IncidentSummary } from './iso-incident.service';

/**
 * AD-2: public api DUY NHẤT của module `iso-forms`. Module khác đọc phiếu ISO qua đây, không query
 * bảng `iso_*`.
 */
@Injectable()
export class IsoFormsApiService {
  constructor(private readonly incidents: IsoIncidentService) {}

  /** Phiếu 0206 có Detection Time trong `withinDays` ngày qua, mới nhất lên đầu (FR-027 ②). */
  recentIncidents(withinDays: number, now: Date): Promise<IncidentSummary[]> {
    return this.incidents.detectedSince(new Date(now.getTime() - withinDays * 86_400_000));
  }
}
