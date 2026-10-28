import { AppError } from './index';

export type Result<T, E = AppError> = Success<T, E> | Failure<T, E>;

export class Success<T, E> {
  public readonly isSuccess = true as const;
  public readonly isFailure = false as const;
  // Refer to type parameters to avoid unused compiler warnings
  public readonly _error?: E;
  constructor(public readonly value: T) {}
}

export class Failure<T, E> {
  public readonly isSuccess = false as const;
  public readonly isFailure = true as const;
  // Refer to type parameters to avoid unused compiler warnings
  public readonly _value?: T;
  constructor(public readonly error: E) {}
}

export function success<T, E = never>(value: T): Result<T, E> {
  return new Success(value);
}

export function failure<T = never, E = AppError>(error: E): Result<T, E> {
  return new Failure(error);
}
