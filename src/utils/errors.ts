/**
 * User-facing CLI error. Thrown by command handlers; caught at the top level
 * in cli.ts to print a clean message and exit with the given code.
 *
 * Use this instead of `process.exit(1)` scattered throughout commands so that:
 *  - unit tests can import & invoke commands without killing the test runner;
 *  - the top-level handler can format errors uniformly (chalk red, no stack).
 */
export class CliError extends Error {
  readonly exitCode: number

  constructor(message: string, exitCode = 1) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}
