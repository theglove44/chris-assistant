export interface NoticeCandidate {
  key: string;
  priority: number;
  summary: string;
  evidence?: string;
  suppressUntil?: number;
}

export interface NoticeScanner {
  name: string;
  scan(now: Date): Promise<NoticeCandidate[]> | NoticeCandidate[];
}

export interface NoticeDelivery {
  send(text: string): Promise<void>;
}

export interface NoticeLoopOptions {
  enabled: boolean;
  intervalMs: number;
  quietStartHour: number;
  quietEndHour: number;
  minGapMs: number;
  dailyLimit: number;
}

export interface NoticeDeliveryRecord {
  key: string;
  sentAt: number;
}

export interface NoticeState {
  deliveries: NoticeDeliveryRecord[];
  suppressedUntil: Record<string, number>;
}
