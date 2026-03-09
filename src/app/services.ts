export interface AppService {
  name: string;
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
}

export class ServiceRegistry {
  constructor(private readonly services: AppService[]) {}

  async startAll(): Promise<void> {
    for (const service of this.services) {
      try {
        await service.start();
      } catch (err: any) {
        console.error("[app] Failed to start service %s: %s", service.name, err.message);
        throw err;
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const service of [...this.services].reverse()) {
      try {
        await service.stop();
      } catch (err: any) {
        console.error("[app] Failed to stop service %s: %s", service.name, err.message);
      }
    }
  }
}

export function createService(
  name: string,
  start: () => Promise<void> | void,
  stop: () => Promise<void> | void,
): AppService {
  return { name, start, stop };
}
