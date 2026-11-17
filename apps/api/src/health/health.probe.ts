export interface HealthProbe {
  dbUp(): Promise<boolean>;
}

export const HEALTH_PROBE = Symbol('HEALTH_PROBE');
