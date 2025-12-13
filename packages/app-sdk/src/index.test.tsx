import "@testing-library/jest-dom";
import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import {
  TakosClientProvider,
  useAuth,
  useFetch,
  useAppInfo,
} from "./index";
import type { ClientAuthState, ClientAppInfo } from "./types";

// =============================================================================
// Test Utilities
// =============================================================================

function createMockAuthState(overrides: Partial<ClientAuthState> = {}): ClientAuthState {
  return {
    isLoggedIn: true,
    user: { id: "user1", handle: "testuser", displayName: "Test User" },
    ...overrides,
  };
}

function createMockAppInfo(overrides: Partial<ClientAppInfo> = {}): ClientAppInfo {
  return {
    appId: "test-app",
    version: "1.0.0",
    ...overrides,
  };
}

function createMockFetch(): typeof fetch {
  return vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
}

interface TestWrapperProps {
  children: React.ReactNode;
  auth?: ClientAuthState;
  fetch?: typeof fetch;
  appInfo?: ClientAppInfo;
}

function TestWrapper({
  children,
  auth = createMockAuthState(),
  fetch: mockFetch = createMockFetch(),
  appInfo = createMockAppInfo(),
}: TestWrapperProps): React.ReactElement {
  return (
    <TakosClientProvider auth={auth} fetch={mockFetch} appInfo={appInfo}>
      {children}
    </TakosClientProvider>
  );
}

// =============================================================================
// TakosClientProvider Tests
// =============================================================================

describe("TakosClientProvider", () => {
  it("should render children", () => {
    render(
      <TestWrapper>
        <div data-testid="child">Hello</div>
      </TestWrapper>
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("should provide context to children", () => {
    let authResult: ClientAuthState | null = null;
    const TestChild = () => {
      authResult = useAuth();
      return null;
    };

    render(
      <TestWrapper>
        <TestChild />
      </TestWrapper>
    );

    expect(authResult).not.toBeNull();
    expect(authResult?.isLoggedIn).toBe(true);
  });
});

// =============================================================================
// useAuth Tests
// =============================================================================

describe("useAuth", () => {
  it("should throw error when used outside of provider", () => {
    const TestComponent = () => {
      useAuth();
      return <div>Test</div>;
    };

    expect(() => render(<TestComponent />)).toThrow(
      "useTakosClient must be used within a TakosClientProvider"
    );
  });

  it("should return auth state when logged in", () => {
    let authState: ClientAuthState | null = null;
    const TestChild = () => {
      authState = useAuth();
      return <div data-testid="auth">{authState.user?.displayName}</div>;
    };

    render(
      <TestWrapper auth={createMockAuthState()}>
        <TestChild />
      </TestWrapper>
    );

    expect(authState?.isLoggedIn).toBe(true);
    expect(authState?.user?.id).toBe("user1");
    expect(authState?.user?.handle).toBe("testuser");
    expect(authState?.user?.displayName).toBe("Test User");
    expect(screen.getByTestId("auth")).toHaveTextContent("Test User");
  });

  it("should return auth state when logged out", () => {
    let authState: ClientAuthState | null = null;
    const TestChild = () => {
      authState = useAuth();
      return <div data-testid="auth">{authState.isLoggedIn ? "yes" : "no"}</div>;
    };

    render(
      <TestWrapper auth={{ isLoggedIn: false, user: null }}>
        <TestChild />
      </TestWrapper>
    );

    expect(authState?.isLoggedIn).toBe(false);
    expect(authState?.user).toBeNull();
    expect(screen.getByTestId("auth")).toHaveTextContent("no");
  });

  it("should include avatar when provided", () => {
    let authState: ClientAuthState | null = null;
    const TestChild = () => {
      authState = useAuth();
      return null;
    };

    render(
      <TestWrapper
        auth={createMockAuthState({
          user: {
            id: "user1",
            handle: "testuser",
            displayName: "Test User",
            avatar: "https://example.com/avatar.png",
          },
        })}
      >
        <TestChild />
      </TestWrapper>
    );

    expect(authState?.user?.avatar).toBe("https://example.com/avatar.png");
  });
});

// =============================================================================
// useFetch Tests
// =============================================================================

describe("useFetch", () => {
  it("should throw error when used outside of provider", () => {
    const TestComponent = () => {
      useFetch();
      return <div>Test</div>;
    };

    expect(() => render(<TestComponent />)).toThrow(
      "useTakosClient must be used within a TakosClientProvider"
    );
  });

  it("should return the fetch function", () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    let fetchFn: typeof fetch | null = null;

    const TestChild = () => {
      fetchFn = useFetch();
      return null;
    };

    render(
      <TestWrapper fetch={mockFetch}>
        <TestChild />
      </TestWrapper>
    );

    expect(fetchFn).toBe(mockFetch);
  });

  it("should be callable and return response", async () => {
    const mockResponse = { data: "test" };
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    let result: unknown = null;
    const TestChild = () => {
      const fetch = useFetch();
      React.useEffect(() => {
        fetch("/-/api/test")
          .then((r) => r.json())
          .then((data) => {
            result = data;
          });
      }, [fetch]);
      return null;
    };

    render(
      <TestWrapper fetch={mockFetch}>
        <TestChild />
      </TestWrapper>
    );

    await waitFor(() => {
      expect(result).toEqual(mockResponse);
    });

    expect(mockFetch).toHaveBeenCalledWith("/-/api/test");
  });
});

// =============================================================================
// useAppInfo Tests
// =============================================================================

describe("useAppInfo", () => {
  it("should throw error when used outside of provider", () => {
    const TestComponent = () => {
      useAppInfo();
      return <div>Test</div>;
    };

    expect(() => render(<TestComponent />)).toThrow(
      "useTakosClient must be used within a TakosClientProvider"
    );
  });

  it("should return app info", () => {
    let appInfo: ClientAppInfo | null = null;
    const TestChild = () => {
      appInfo = useAppInfo();
      return <div data-testid="app">{appInfo.appId}</div>;
    };

    render(
      <TestWrapper appInfo={{ appId: "my-app", version: "2.0.0" }}>
        <TestChild />
      </TestWrapper>
    );

    expect(appInfo?.appId).toBe("my-app");
    expect(appInfo?.version).toBe("2.0.0");
    expect(screen.getByTestId("app")).toHaveTextContent("my-app");
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Client SDK Integration", () => {
  it("should work with all hooks together", () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    let auth: ClientAuthState | null = null;
    let fetchFn: typeof fetch | null = null;
    let appInfo: ClientAppInfo | null = null;

    const TestChild = () => {
      auth = useAuth();
      fetchFn = useFetch();
      appInfo = useAppInfo();

      return (
        <div>
          <span data-testid="user">{auth.user?.displayName}</span>
          <span data-testid="app">{appInfo.appId}</span>
        </div>
      );
    };

    render(
      <TestWrapper
        auth={createMockAuthState()}
        fetch={mockFetch}
        appInfo={createMockAppInfo()}
      >
        <TestChild />
      </TestWrapper>
    );

    expect(auth?.isLoggedIn).toBe(true);
    expect(fetchFn).toBe(mockFetch);
    expect(appInfo?.appId).toBe("test-app");
    expect(screen.getByTestId("user")).toHaveTextContent("Test User");
    expect(screen.getByTestId("app")).toHaveTextContent("test-app");
  });

  it("should handle typical app component pattern", async () => {
    const mockPosts = [{ id: "1", content: "Hello" }, { id: "2", content: "World" }];
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ posts: mockPosts }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const Timeline = () => {
      const fetch = useFetch();
      const { user, isLoggedIn } = useAuth();
      const { appId } = useAppInfo();
      const [posts, setPosts] = React.useState<Array<{ id: string; content: string }>>([]);

      React.useEffect(() => {
        fetch("/-/api/timeline/home")
          .then((r) => r.json())
          .then((data: { posts: Array<{ id: string; content: string }> }) => setPosts(data.posts));
      }, [fetch]);

      return (
        <div>
          {isLoggedIn && <p data-testid="welcome">Welcome, {user?.displayName}</p>}
          <p data-testid="app-info">App: {appId}</p>
          <ul data-testid="posts">
            {posts.map((post) => (
              <li key={post.id}>{post.content}</li>
            ))}
          </ul>
        </div>
      );
    };

    render(
      <TestWrapper fetch={mockFetch}>
        <Timeline />
      </TestWrapper>
    );

    expect(screen.getByTestId("welcome")).toHaveTextContent("Welcome, Test User");
    expect(screen.getByTestId("app-info")).toHaveTextContent("App: test-app");

    await waitFor(() => {
      const postsList = screen.getByTestId("posts");
      expect(postsList).toHaveTextContent("Hello");
      expect(postsList).toHaveTextContent("World");
    });

    expect(mockFetch).toHaveBeenCalledWith("/-/api/timeline/home");
  });
});
