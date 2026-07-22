import { Kuyruk } from './kuyruk';

interface MonitorOptions {
  port?: number;
  host?: string;
  name?: string;
  history?: number;
}

interface MonitorHandle {
  url: string;
  port: number;
  host: string;
  stop: () => void;
}

export function monitor(queue: Kuyruk, options?: MonitorOptions): MonitorHandle;
