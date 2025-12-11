import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import {
  defineApp,
  defineScreen,
  useTakos,
  useCore,
  useApp,
  useAuth,
  useNavigate,
  useParams,
  Link,
  Form,
} from "./index";
import type { TakosRuntime, ScreenDefinition } from "./types";

// =============================================================================
// Test Utilities
// =============================================================================

function createMockRuntime(overrides: Partial<TakosRuntime> = {}): TakosRuntime {
  return {
    navigate: vi.fn(),
    back: vi.fn(),
    currentPath: "/",
    params: {},
    query: {},
    auth: {
      isLoggedIn: true,
      user: { id: "user1", handle: "testuser", displayName: "Test User" },
      token: "test-token",
    },
    core: {
      posts: {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      users: {
        get: vi.fn().mockResolvedValue({}),
        follow: vi.fn().mockResolvedValue(undefined),
        unfollow: vi.fn().mockResolvedValue(undefined),
      },
      storage: {
        upload: vi.fn().mockResolvedValue({}),
        get: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      fetch: vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
      timeline: {
        home: vi.fn().mockResolvedValue({}),
      },
      notifications: {
        list: vi.fn().mockResolvedValue([]),
        markRead: vi.fn().mockResolvedValue(undefined),
      },
      activitypub: {
        send: vi.fn().mockResolvedValue(undefined),
        resolve: vi.fn().mockResolvedValue({}),
      },
      ai: {
        complete: vi.fn().mockResolvedValue(""),
        embed: vi.fn().mockResolvedValue([]),
      },
    },
    app: {
      fetch: vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
    },
    ui: {
      toast: vi.fn(),
      confirm: vi.fn().mockResolvedValue(true),
      modal: {
        open: vi.fn(),
        close: vi.fn(),
      },
    },
    appInfo: {
      id: "test-app",
      version: "1.0.0",
      permissions: [],
    },
    ...overrides,
  };
}

// =============================================================================
// defineScreen Tests
// =============================================================================

describe("defineScreen", () => {
  it("should create a screen definition with default auth", () => {
    const HomeScreen = () => <div>Home</div>;
    const screen = defineScreen({
      path: "/",
      component: HomeScreen,
      title: "Home",
    });

    expect(screen.path).toBe("/");
    expect(screen.component).toBe(HomeScreen);
    expect(screen.title).toBe("Home");
    expect(screen.auth).toBe("required");
    expect(screen.__takosScreen).toBe(true);
  });

  it("should allow optional auth", () => {
    const PublicScreen = () => <div>Public</div>;
    const screen = defineScreen({
      path: "/public",
      component: PublicScreen,
      auth: "optional",
    });

    expect(screen.auth).toBe("optional");
  });

  it("should set displayName on component if not set", () => {
    const Screen = () => <div>Screen</div>;
    const screenDef = defineScreen({
      path: "/test",
      component: Screen,
      title: "Test Screen",
    });

    expect((screenDef.component as any).displayName).toBe("Test Screen");
  });

  it("should fallback to path for displayName when title is not provided", () => {
    const Screen = () => <div>Screen</div>;
    const screenDef = defineScreen({
      path: "/fallback-path",
      component: Screen,
    });

    expect((screenDef.component as any).displayName).toBe("/fallback-path");
  });

  it("should not override existing displayName", () => {
    const Screen = () => <div>Screen</div>;
    Screen.displayName = "ExistingName";
    const screenDef = defineScreen({
      path: "/test",
      component: Screen,
      title: "New Title",
    });

    expect((screenDef.component as any).displayName).toBe("ExistingName");
  });
});

// =============================================================================
// defineApp Tests
// =============================================================================

describe("defineApp", () => {
  it("should create an app definition with screens", () => {
    const HomeScreen = () => <div>Home</div>;
    const AboutScreen = () => <div>About</div>;

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [
        defineScreen({ path: "/", component: HomeScreen }),
        defineScreen({ path: "/about", component: AboutScreen }),
      ],
    });

    expect(App).toBeTypeOf("function");
    expect((App as any).__takosApp).toBeDefined();
    expect((App as any).__takosApp.name).toBe("test-app");
    expect((App as any).__takosApp.version).toBe("1.0.0");
    expect((App as any).__takosApp.screens).toHaveLength(2);
  });

  it("should render the matching screen based on currentPath", () => {
    const HomeScreen = () => <div data-testid="home">Home Page</div>;
    const AboutScreen = () => <div data-testid="about">About Page</div>;

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [
        defineScreen({ path: "/", component: HomeScreen }),
        defineScreen({ path: "/about", component: AboutScreen }),
      ],
    });

    const runtime = createMockRuntime({ currentPath: "/" });
    render(<App runtime={runtime} />);

    expect(screen.getByTestId("home")).toBeInTheDocument();
    expect(screen.queryByTestId("about")).not.toBeInTheDocument();
  });

  it("should render about screen when path is /about", () => {
    const HomeScreen = () => <div data-testid="home">Home</div>;
    const AboutScreen = () => <div data-testid="about">About</div>;

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [
        defineScreen({ path: "/", component: HomeScreen }),
        defineScreen({ path: "/about", component: AboutScreen }),
      ],
    });

    const runtime = createMockRuntime({ currentPath: "/about" });
    render(<App runtime={runtime} />);

    expect(screen.getByTestId("about")).toBeInTheDocument();
    expect(screen.queryByTestId("home")).not.toBeInTheDocument();
  });

  it("should show missing screen message for unknown paths", () => {
    const HomeScreen = () => <div>Home</div>;

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: HomeScreen })],
    });

    const runtime = createMockRuntime({ currentPath: "/unknown" });
    render(<App runtime={runtime} />);

    expect(screen.getByText(/Screen not found/i)).toBeInTheDocument();
  });

  it("should handle parameterized routes", () => {
    const PostScreen = () => {
      const { params } = useNavigate();
      return <div data-testid="post">Post ID: {params.id}</div>;
    };

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/posts/:id", component: PostScreen })],
    });

    const runtime = createMockRuntime({ currentPath: "/posts/123" });
    render(<App runtime={runtime} />);

    expect(screen.getByTestId("post")).toHaveTextContent("Post ID: 123");
  });

  it("should normalize handlers and permissions", () => {
    const HomeScreen = () => <div>Home</div>;

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: HomeScreen })],
      handlers: [{ type: "handler" }],
      permissions: ["read", "write"],
    });

    const meta = (App as any).__takosApp;
    expect(meta.handlers).toEqual([{ type: "handler" }]);
    expect(meta.permissions).toEqual(["read", "write"]);
  });
});

// =============================================================================
// Hooks Tests
// =============================================================================

describe("useTakos", () => {
  it("should throw error when used outside of app context", () => {
    const TestComponent = () => {
      useTakos();
      return <div>Test</div>;
    };

    expect(() => render(<TestComponent />)).toThrow(
      "useTakos must be used inside a takos app"
    );
  });

  it("should return runtime when used inside app", () => {
    let capturedRuntime: TakosRuntime | null = null;
    const TestScreen = () => {
      capturedRuntime = useTakos();
      return <div>Test</div>;
    };

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    const mockRuntime = createMockRuntime();
    render(<App runtime={mockRuntime} />);

    expect(capturedRuntime).not.toBeNull();
    expect(capturedRuntime?.auth).toBeDefined();
  });
});

describe("useCore", () => {
  it("should return core API", () => {
    let coreApi: any = null;
    const TestScreen = () => {
      coreApi = useCore();
      return <div>Test</div>;
    };

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={createMockRuntime()} />);

    expect(coreApi.posts).toBeDefined();
    expect(coreApi.users).toBeDefined();
    expect(coreApi.storage).toBeDefined();
  });
});

describe("useApp", () => {
  it("should return app API", () => {
    let appApi: any = null;
    const TestScreen = () => {
      appApi = useApp();
      return <div>Test</div>;
    };

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={createMockRuntime()} />);

    expect(appApi.fetch).toBeDefined();
  });
});

describe("useAuth", () => {
  it("should return auth state", () => {
    let authState: any = null;
    const TestScreen = () => {
      authState = useAuth();
      return <div>Test</div>;
    };

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={createMockRuntime()} />);

    expect(authState.isLoggedIn).toBe(true);
    expect(authState.user).toBeDefined();
    expect(authState.user.id).toBe("user1");
  });
});

describe("useNavigate", () => {
  it("should return navigation functions and state", () => {
    let navApi: any = null;
    const TestScreen = () => {
      navApi = useNavigate();
      return <div>Test</div>;
    };

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={createMockRuntime()} />);

    expect(navApi.navigate).toBeTypeOf("function");
    expect(navApi.back).toBeTypeOf("function");
    expect(navApi.params).toBeDefined();
    expect(navApi.query).toBeDefined();
  });
});

describe("useParams", () => {
  it("should return route params", () => {
    let params: Record<string, string> = {};
    const TestScreen = () => {
      params = useParams();
      return <div>Test</div>;
    };

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/posts/:id", component: TestScreen })],
    });

    render(<App runtime={createMockRuntime({ currentPath: "/posts/456" })} />);

    expect(params.id).toBe("456");
  });
});

// =============================================================================
// Link Component Tests
// =============================================================================

describe("Link", () => {
  it("should render an anchor element with href", () => {
    const TestScreen = () => <Link to="/about">Go to About</Link>;

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={createMockRuntime()} />);

    const link = screen.getByRole("link", { name: "Go to About" });
    expect(link).toHaveAttribute("href", "/about");
  });

  it("should call navigate on click", () => {
    const mockRuntime = createMockRuntime();
    const TestScreen = () => <Link to="/about">Go to About</Link>;

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={mockRuntime} />);

    const link = screen.getByRole("link", { name: "Go to About" });
    fireEvent.click(link);

    expect(mockRuntime.navigate).toHaveBeenCalledWith("/about");
  });

  it("should not prevent default for external links (target=_blank)", () => {
    const mockRuntime = createMockRuntime();
    const TestScreen = () => (
      <Link to="/external" target="_blank">
        External
      </Link>
    );

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={mockRuntime} />);

    const link = screen.getByRole("link", { name: "External" });
    fireEvent.click(link);

    expect(mockRuntime.navigate).not.toHaveBeenCalled();
  });

  it("should not navigate when modifier keys are pressed", () => {
    const mockRuntime = createMockRuntime();
    const TestScreen = () => <Link to="/about">About</Link>;

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={mockRuntime} />);

    const link = screen.getByRole("link", { name: "About" });

    // Test with meta key
    fireEvent.click(link, { metaKey: true });
    expect(mockRuntime.navigate).not.toHaveBeenCalled();

    // Test with ctrl key
    fireEvent.click(link, { ctrlKey: true });
    expect(mockRuntime.navigate).not.toHaveBeenCalled();

    // Test with shift key
    fireEvent.click(link, { shiftKey: true });
    expect(mockRuntime.navigate).not.toHaveBeenCalled();

    // Test with alt key
    fireEvent.click(link, { altKey: true });
    expect(mockRuntime.navigate).not.toHaveBeenCalled();
  });

  it("should call custom onClick handler", () => {
    const onClickMock = vi.fn();
    const TestScreen = () => (
      <Link to="/about" onClick={onClickMock}>
        About
      </Link>
    );

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={createMockRuntime()} />);

    fireEvent.click(screen.getByRole("link"));
    expect(onClickMock).toHaveBeenCalled();
  });

  it("should not navigate when default is prevented in onClick", () => {
    const mockRuntime = createMockRuntime();
    const TestScreen = () => (
      <Link to="/about" onClick={(e) => e.preventDefault()}>
        About
      </Link>
    );

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={mockRuntime} />);

    fireEvent.click(screen.getByRole("link"));
    expect(mockRuntime.navigate).not.toHaveBeenCalled();
  });

  it("should forward ref to anchor element", () => {
    const ref = React.createRef<HTMLAnchorElement>();
    const TestScreen = () => (
      <Link to="/about" ref={ref}>
        About
      </Link>
    );

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={createMockRuntime()} />);

    expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
  });
});

// =============================================================================
// Form Component Tests
// =============================================================================

describe("Form", () => {
  it("should render a form element", () => {
    const TestScreen = () => (
      <Form action="/api/submit" data-testid="test-form">
        <input name="name" type="text" />
        <button type="submit">Submit</button>
      </Form>
    );

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={createMockRuntime()} />);

    const form = screen.getByTestId("test-form");
    expect(form).toBeInTheDocument();
    expect(form).toHaveAttribute("action", "/api/submit");
  });

  it("should submit form data via app.fetch", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    const mockRuntime = createMockRuntime();
    mockRuntime.app.fetch = mockFetch;

    const onSuccess = vi.fn();
    const TestScreen = () => (
      <Form action="/api/submit" onSuccess={onSuccess}>
        <input name="name" defaultValue="Test Name" />
        <button type="submit">Submit</button>
      </Form>
    );

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={mockRuntime} />);

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/submit", {
        method: "POST",
        body: JSON.stringify({ name: "Test Name" }),
        headers: { "Content-Type": "application/json" },
      });
    });

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(
        { success: true },
        expect.any(Response)
      );
    });
  });

  it("should call onError when request fails", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Bad request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );
    const mockRuntime = createMockRuntime();
    mockRuntime.app.fetch = mockFetch;

    const onError = vi.fn();
    const TestScreen = () => (
      <Form action="/api/submit" onError={onError}>
        <button type="submit">Submit</button>
      </Form>
    );

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={mockRuntime} />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("400"),
        })
      );
    });
  });

  it("should use GET method and append query params", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200 })
    );
    const mockRuntime = createMockRuntime();
    mockRuntime.app.fetch = mockFetch;

    const TestScreen = () => (
      <Form action="/api/search" method="GET">
        <input name="q" defaultValue="test query" />
        <button type="submit">Search</button>
      </Form>
    );

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={mockRuntime} />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/search?q=test+query",
        { method: "GET" }
      );
    });
  });

  it("should call custom onSubmit handler", async () => {
    const onSubmit = vi.fn();
    const TestScreen = () => (
      <Form action="/api/submit" onSubmit={onSubmit}>
        <button type="submit">Submit</button>
      </Form>
    );

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={createMockRuntime()} />);

    fireEvent.click(screen.getByRole("button"));

    expect(onSubmit).toHaveBeenCalled();
  });

  it("should not submit when onSubmit prevents default", async () => {
    const mockFetch = vi.fn();
    const mockRuntime = createMockRuntime();
    mockRuntime.app.fetch = mockFetch;

    const TestScreen = () => (
      <Form action="/api/submit" onSubmit={(e) => e.preventDefault()}>
        <button type="submit">Submit</button>
      </Form>
    );

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={mockRuntime} />);

    fireEvent.click(screen.getByRole("button"));

    // Wait a tick and verify fetch was not called
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should set aria-busy during submission", async () => {
    let resolvePromise: () => void;
    const pendingPromise = new Promise<Response>((resolve) => {
      resolvePromise = () =>
        resolve(new Response("{}", { status: 200 }));
    });

    const mockFetch = vi.fn().mockReturnValue(pendingPromise);
    const mockRuntime = createMockRuntime();
    mockRuntime.app.fetch = mockFetch;

    const TestScreen = () => (
      <Form action="/api/submit" data-testid="form">
        <button type="submit">Submit</button>
      </Form>
    );

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={mockRuntime} />);

    const form = screen.getByTestId("form");
    expect(form).toHaveAttribute("aria-busy", "false");

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(form).toHaveAttribute("aria-busy", "true");
    });

    await act(async () => {
      resolvePromise!();
      await pendingPromise;
    });

    await waitFor(() => {
      expect(form).toHaveAttribute("aria-busy", "false");
    });
  });

  it("should forward ref to form element", () => {
    const ref = React.createRef<HTMLFormElement>();
    const TestScreen = () => (
      <Form action="/api/submit" ref={ref}>
        <button type="submit">Submit</button>
      </Form>
    );

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={createMockRuntime()} />);

    expect(ref.current).toBeInstanceOf(HTMLFormElement);
  });

  it("should support different HTTP methods", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200 })
    );
    const mockRuntime = createMockRuntime();
    mockRuntime.app.fetch = mockFetch;

    const TestScreen = () => (
      <Form action="/api/resource" method="DELETE">
        <button type="submit">Delete</button>
      </Form>
    );

    const App = defineApp({
      name: "test-app",
      version: "1.0.0",
      screens: [defineScreen({ path: "/", component: TestScreen })],
    });

    render(<App runtime={mockRuntime} />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/resource", {
        method: "DELETE",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      });
    });
  });
});
