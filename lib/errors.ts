export type PuzzleErrorCode =
  | "not-found"
  | "network"
  | "transparent"
  | "decode"
  | "bad-input";

export class PuzzleError extends Error {
  readonly code: PuzzleErrorCode;
  readonly cause?: unknown;

  constructor(code: PuzzleErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "PuzzleError";
    this.code = code;
    this.cause = cause;
  }
}

export function isPuzzleError(error: unknown): error is PuzzleError {
  return error instanceof PuzzleError;
}
