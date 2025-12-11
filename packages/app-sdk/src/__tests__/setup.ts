import "@testing-library/jest-dom/vitest";

// Mock window.history for navigation tests
const originalPushState = window.history.pushState;
const originalReplaceState = window.history.replaceState;

beforeEach(() => {
  window.history.pushState = vi.fn();
  window.history.replaceState = vi.fn();
});

afterEach(() => {
  window.history.pushState = originalPushState;
  window.history.replaceState = originalReplaceState;
  vi.clearAllMocks();
});
