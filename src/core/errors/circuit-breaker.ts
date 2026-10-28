import { ServiceUnavailableError } from './index';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // percentage of failures (e.g., 50)
  cooldownWindow?: number; // time in ms before checking if service is back (e.g., 10000)
  requestVolumeThreshold?: number; // min requests in window before evaluating failure rate (e.g., 5)
  timeout?: number; // timeout for the execution in ms (e.g., 3000)
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker<TArgs extends unknown[], TResult> {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private totalCount = 0;
  private lastStateChange: number = Date.now();
  private readonly action: (...args: TArgs) => Promise<TResult>;
  private readonly options: Required<CircuitBreakerOptions>;

  constructor(action: (...args: TArgs) => Promise<TResult>, options: CircuitBreakerOptions = {}) {
    this.action = action;
    this.options = {
      failureThreshold: options.failureThreshold ?? 50,
      cooldownWindow: options.cooldownWindow ?? 10000,
      requestVolumeThreshold: options.requestVolumeThreshold ?? 5,
      timeout: options.timeout ?? 3000,
    };
  }

  public getState(): CircuitState {
    this.updateState();
    return this.state;
  }

  public async execute(...args: TArgs): Promise<TResult> {
    this.updateState();

    if (this.state === 'OPEN') {
      throw new ServiceUnavailableError(
        'Circuit breaker is open. Service temporarily unavailable.'
      );
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Request timed out'));
      }, this.options.timeout);

      // Allow Node process to exit if only this timer is left active
      if (timer.unref) {
        timer.unref();
      }
    });

    try {
      const result = await Promise.race([this.action(...args), timeoutPromise]);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.totalCount++;
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= 3) {
        this.reset();
      }
    }
  }

  private onFailure(): void {
    this.totalCount++;
    this.failureCount++;

    if (this.state === 'CLOSED') {
      const failureRate = (this.failureCount / this.totalCount) * 100;
      if (
        this.totalCount >= this.options.requestVolumeThreshold &&
        failureRate >= this.options.failureThreshold
      ) {
        this.trip();
      }
    } else if (this.state === 'HALF_OPEN') {
      this.trip();
    }
  }

  private trip(): void {
    this.state = 'OPEN';
    this.lastStateChange = Date.now();
    this.failureCount = 0;
    this.successCount = 0;
    this.totalCount = 0;
  }

  private reset(): void {
    this.state = 'CLOSED';
    this.lastStateChange = Date.now();
    this.failureCount = 0;
    this.successCount = 0;
    this.totalCount = 0;
  }

  private updateState(): void {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastStateChange >= this.options.cooldownWindow) {
        this.state = 'HALF_OPEN';
        this.lastStateChange = now;
        this.successCount = 0;
        this.failureCount = 0;
        this.totalCount = 0;
      }
    }
  }
}
