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
  watch: (queue: Kuyruk, name?: string) => MonitorHandle;
  stop: () => void;
}

export function monitor(queue: Kuyruk, options?: MonitorOptions): MonitorHandle;
export function monitor(options?: MonitorOptions): MonitorHandle;
