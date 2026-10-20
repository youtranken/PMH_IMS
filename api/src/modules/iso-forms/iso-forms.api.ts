import { Injectable, type OnModuleInit } from '@nestjs/common';
import { FeatureHolderRegistry, type FeatureHolderSource } from '../../common/feature-holders.registry';
import type { FeatureHolding } from '../../common/features';
import { IsoAccessService } from './iso-access.service';
import { IsoIncidentService, type IncidentSummary } from './iso-incident.service';

export type { IncidentSummary } from './iso-incident.service';

/**
 * AD-2: public api DUY NHẤT của module `iso-forms`. Module khác đọc phiếu ISO qua đây, không query
 * bảng `iso_*`.
 */
@Injectable()
export class IsoFormsApiService implements OnModuleInit, FeatureHolderSource {
  readonly features = ['iso_0203', 'iso_0208'] as const;

  constructor(
    private readonly incidents: IsoIncidentService,
    private readonly access: IsoAccessService,
    private readonly holders: FeatureHolderRegistry,
  ) {}

  /** Q-31: báo người phụ trách phiếu để `auth` không bỏ tick / chuyển nhóm làm họ mất phiếu. */
  onModuleInit(): void {
    this.holders.register(this);
  }

  holdings(userIds: readonly string[]): Promise<FeatureHolding[]> {
    return this.access.holdings(userIds);
  }

  /** Phiếu 0206 có Detection Time trong `withinDays` ngày qua, mới nhất lên đầu (FR-027 ②). */
  recentIncidents(withinDays: number, now: Date): Promise<IncidentSummary[]> {
    return this.incidents.detectedSince(new Date(now.getTime() - withinDays * 86_400_000));
  }
}
