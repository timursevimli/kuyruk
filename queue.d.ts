interface AddOptions {
  factor?: number;
  priority?: number;
}

interface QueueResult {
  res: unknown | unknown[];
  from?: number;
}

type ProcessFunction = (
  arguments: unknown | unknown[],
) => unknown | Promise<unknown>;
type TimeoutCallback = (err: Error) => void;
type DoneCallback = (err?: Error, res?: QueueResult) => void;
type SuccessCallback = (res: QueueResult) => void;
type FailureCallback = (err: Error) => void;
type DrainCallback = () => void;

export class Queue {
  concurrency: number;
  size: number;
  count: number;
  waiting: unknown[];
  destination: Queue;
  paused: boolean;
  factor: number;
  waitTimeout: number;
  processTimeout: number;
  debounceTimeout: number;
  debounceCount: number;
  fifoMode: boolean;
  asyncProcess: boolean;
  roundRobinMode: boolean;
  priorityMode: boolean;
  debounceMode: boolean;
  onProcess: ProcessFunction;
  onDone: DoneCallback;
  onSuccess: SuccessCallback;
  onTimeout: TimeoutCallback;
  onFailure: FailureCallback;
  onDrain: DrainCallback;
  static channel(concurrency: number, size?: number): Queue;
  constructor(concurrency: number, size?: number);
  add(item: unknown, options?: AddOptions): void;
  pipe(destination: Queue): { pipe: (dest: Queue) => void };
  timeout(msec: number, onTimeout: TimeoutCallback): Queue;
  wait(msec: number): Queue;
  debounce(count: number, interval: number): Queue;
  process(job: ProcessFunction): Queue;
  done(listener: DoneCallback): Queue;
  success(listener: SuccessCallback): Queue;
  failure(listener: FailureCallback): Queue;
  drain(listener: DrainCallback): Queue;
  priority(flag: boolean): Queue;
  setFactor(factor: number): Queue;
  roundRobin(flag: boolean): Queue;
  fifo(): Queue;
  lifo(): Queue;
  resume(): Queue;
  pause(): Queue;
  clear(): Queue;
  async(): Queue;
}
