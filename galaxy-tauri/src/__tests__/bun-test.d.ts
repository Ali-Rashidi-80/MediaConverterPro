declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    readonly window: typeof globalThis & Window;
  }
}

declare module 'bun:test' {
  import type { Assertion, Mock } from 'vitest';
  import type { TestingLibraryMatchers } from '@testing-library/jest-dom/types/matchers';

  type ExtendedAssertion<T> = Assertion<T> &
    TestingLibraryMatchers<unknown, void> & {
      not: Assertion<T> & TestingLibraryMatchers<unknown, void>;
    };

  export const describe: (name: string, fn: () => void) => void;
  export const it: (name: string, fn: () => void | Promise<void>) => void;
  export const test: (name: string, fn: () => void | Promise<void>) => void;
  export const beforeEach: (fn: () => void | Promise<void>) => void;
  export const afterEach: (fn: () => void | Promise<void>) => void;
  export const beforeAll: (fn: () => void | Promise<void>) => void;
  export const afterAll: (fn: () => void | Promise<void>) => void;

  export interface ExpectFn {
    <T>(actual: T): ExtendedAssertion<T>;
    extend(matchers: Record<string, unknown>): void;
  }

  export const expect: ExpectFn;

  export const mock: {
    module(specifier: string, factory: () => Record<string, unknown>): void;
    restore(): void;
  };

  export const vi: {
    fn<TArgs extends unknown[] = unknown[], TReturn = unknown>(
      impl?: (...args: TArgs) => TReturn
    ): Mock<(...args: TArgs) => TReturn>;
    mock(specifier: string, factory: () => Record<string, unknown>): void;
    clearAllMocks(): void;
  };
}
