interface AddOptions {
  factor?: number;
  priority?: number;
}

interface Details {
  factor: number | undefined;
}

type ProcessFunction = (
  args: unknown | unknown[],
) => unknown | Promise<unknown>;
type TimeoutCallback = (err: Error) => void;
type DoneCallback = (err: Error | null, res: unknown) => void;
type SuccessCallback = (res: unknown) => void;
type FailureCallback = (err: Error) => void;
type DrainCallback = () => void;

export class Kuyruk {
  constructor(options?: { concurrency?: number; size?: number });
  static channels(options?: { concurrency?: number; size?: number }): Kuyruk;
  concurrency: number;
  size: number;
  count: number;
  waiting: unknown[];
  destination: Kuyruk;
  paused: boolean;
  factor: number;
  waitTimeout: number;
  processTimeout: number;
  debounceTimeout: number;
  debounceCount: number;
  fifoMode: boolean;
  promiseMode: boolean;
  roundRobinMode: boolean;
  priorityMode: boolean;
  debounceMode: boolean;
  onProcess: ProcessFunction;
  onDone: DoneCallback;
  onSuccess: SuccessCallback;
  onTimeout: TimeoutCallback;
  onFailure: FailureCallback;
  onDrain: DrainCallback;
  add(item: unknown, options?: AddOptions): void;
  pipe(destination: Kuyruk): Kuyruk;
  timeout(msec: number, onTimeout: TimeoutCallback): Kuyruk;
  wait(msec: number): Kuyruk;
  debounce(count: number, interval: number): Kuyruk;
  process(job: ProcessFunction): Kuyruk;
  done(listener: DoneCallback, details?: Details): Kuyruk;
  success(listener: SuccessCallback, details?: Details): Kuyruk;
  failure(listener: FailureCallback, details?: Details): Kuyruk;
  drain(listener: DrainCallback): Kuyruk;
  priority(flag: boolean): Kuyruk;
  setFactor(factor: number): Kuyruk;
  roundRobin(flag: boolean): Kuyruk;
  fifo(): Kuyruk;
  lifo(): Kuyruk;
  resume(): Kuyruk;
  pause(): Kuyruk;
  clear(): Kuyruk;
}
