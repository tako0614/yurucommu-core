export function assert(
  condition: unknown,
  message?: string,
): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}

export function assertEquals(
  actual: unknown,
  expected: unknown,
  message?: string,
): void {
  if (actual !== expected) {
    throw new Error(message ?? `Expected ${actual} === ${expected}`);
  }
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  ErrorClass: new (...args: any[]) => Error = Error,
  msgIncludes?: string,
): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    if (
      err instanceof ErrorClass &&
      (!msgIncludes || err.message.includes(msgIncludes))
    ) {
      return err;
    }
    throw new Error(
      `Expected rejection with ${ErrorClass.name}${
        msgIncludes ? ` containing ${msgIncludes}` : ""
      }, got ${err}`,
    );
  }
  throw new Error("Expected function to reject");
}
