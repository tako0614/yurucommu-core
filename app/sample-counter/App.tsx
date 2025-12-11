/**
 * Sample Counter App - Client Entry Point
 *
 * Demonstrates the App SDK's defineApp/defineScreen pattern.
 * This file shows how to build a complete app using:
 * - defineApp() for app configuration
 * - defineScreen() for screen definitions
 * - useTakos/useApp/useCore hooks for runtime access
 * - Link and Form components for navigation and API calls
 */

import * as React from "react";
import {
  defineApp,
  defineScreen,
  useTakos,
  useApp,
  useNavigate,
  useParams,
  Link,
  Form,
} from "@takos/app-sdk";

// ============================================================================
// Screens
// ============================================================================

/**
 * Home Screen - Counter display and controls
 */
function HomeScreen() {
  const { auth, ui } = useTakos();
  const app = useApp();
  const [counter, setCounter] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchCounter = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await app.fetch("/sample-counter/counter");
      if (!res.ok) {
        throw new Error(`Failed to fetch counter: ${res.status}`);
      }
      const data = await res.json();
      setCounter(data.value);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [app]);

  React.useEffect(() => {
    if (auth.isLoggedIn) {
      fetchCounter();
    }
  }, [auth.isLoggedIn, fetchCounter]);

  const handleIncrement = async () => {
    try {
      const res = await app.fetch("/sample-counter/counter/increment", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to increment");
      const data = await res.json();
      setCounter(data.value);
      ui.toast("Incremented!", "success");
    } catch (err) {
      ui.toast((err as Error).message, "error");
    }
  };

  const handleDecrement = async () => {
    try {
      const res = await app.fetch("/sample-counter/counter/decrement", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to decrement");
      const data = await res.json();
      setCounter(data.value);
      ui.toast("Decremented!", "success");
    } catch (err) {
      ui.toast((err as Error).message, "error");
    }
  };

  const handleReset = async () => {
    const confirmed = await ui.confirm("Reset counter to 0?");
    if (!confirmed) return;

    try {
      const res = await app.fetch("/sample-counter/counter/reset", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to reset");
      const data = await res.json();
      setCounter(data.value);
      ui.toast("Counter reset!", "info");
    } catch (err) {
      ui.toast((err as Error).message, "error");
    }
  };

  if (!auth.isLoggedIn) {
    return (
      <div style={styles.container}>
        <h1 style={styles.title}>Sample Counter App</h1>
        <p style={styles.text}>Please log in to use the counter.</p>
        <Link to="/login" style={styles.link}>
          Go to Login
        </Link>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Sample Counter App</h1>
      <p style={styles.text}>Welcome, {auth.user?.displayName ?? auth.user?.handle}!</p>

      {loading && <p style={styles.text}>Loading...</p>}
      {error && <p style={styles.error}>{error}</p>}

      {counter !== null && (
        <div style={styles.counterBox}>
          <span style={styles.counterValue}>{counter}</span>
        </div>
      )}

      <div style={styles.buttonRow}>
        <button onClick={handleDecrement} style={styles.button}>
          -
        </button>
        <button onClick={handleIncrement} style={styles.button}>
          +
        </button>
      </div>

      <div style={styles.buttonRow}>
        <button onClick={handleReset} style={styles.secondaryButton}>
          Reset
        </button>
      </div>

      <nav style={styles.nav}>
        <Link to="/sample-counter/about" style={styles.link}>
          About
        </Link>
        <Link to="/sample-counter/set" style={styles.link}>
          Set Value
        </Link>
      </nav>
    </div>
  );
}

/**
 * About Screen - App information
 */
function AboutScreen() {
  const app = useApp();
  const [info, setInfo] = React.useState<{ name: string; version: string; description: string } | null>(null);

  React.useEffect(() => {
    app.fetch("/sample-counter/info").then(async (res) => {
      if (res.ok) {
        setInfo(await res.json());
      }
    });
  }, [app]);

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>About</h1>
      {info ? (
        <>
          <p style={styles.text}>
            <strong>Name:</strong> {info.name}
          </p>
          <p style={styles.text}>
            <strong>Version:</strong> {info.version}
          </p>
          <p style={styles.text}>
            <strong>Description:</strong> {info.description}
          </p>
        </>
      ) : (
        <p style={styles.text}>Loading...</p>
      )}
      <Link to="/sample-counter" style={styles.link}>
        Back to Counter
      </Link>
    </div>
  );
}

/**
 * Set Value Screen - Form demo using the Form component
 */
function SetValueScreen() {
  const { navigate } = useNavigate();
  const { ui } = useTakos();

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Set Counter Value</h1>
      <Form
        action="/sample-counter/counter/set"
        method="POST"
        onSuccess={(data) => {
          ui.toast(`Counter set to ${(data as { value: number }).value}`, "success");
          navigate("/sample-counter");
        }}
        onError={(err) => {
          ui.toast(`Error: ${(err as Error).message}`, "error");
        }}
        style={styles.form}
      >
        <label style={styles.label}>
          New Value:
          <input
            type="number"
            name="value"
            defaultValue={0}
            style={styles.input}
          />
        </label>
        <button type="submit" style={styles.button}>
          Set
        </button>
      </Form>
      <Link to="/sample-counter" style={styles.link}>
        Cancel
      </Link>
    </div>
  );
}

// ============================================================================
// Screen Definitions
// ============================================================================

const HomeScreenDef = defineScreen({
  path: "/sample-counter",
  component: HomeScreen,
  title: "Counter",
  auth: "required",
});

const AboutScreenDef = defineScreen({
  path: "/sample-counter/about",
  component: AboutScreen,
  title: "About",
  auth: "optional",
});

const SetValueScreenDef = defineScreen({
  path: "/sample-counter/set",
  component: SetValueScreen,
  title: "Set Value",
  auth: "required",
});

// ============================================================================
// App Definition
// ============================================================================

export const SampleCounterApp = defineApp({
  name: "sample-counter",
  version: "0.1.0",
  screens: [HomeScreenDef, AboutScreenDef, SetValueScreenDef],
  permissions: ["storage:read", "storage:write"],
});

export default SampleCounterApp;

// ============================================================================
// Styles
// ============================================================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 480,
    margin: "0 auto",
    padding: 24,
    fontFamily: "system-ui, sans-serif",
  },
  title: {
    fontSize: 24,
    fontWeight: 600,
    marginBottom: 16,
  },
  text: {
    fontSize: 16,
    marginBottom: 8,
  },
  error: {
    fontSize: 14,
    color: "#dc2626",
    marginBottom: 8,
  },
  counterBox: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    marginBottom: 24,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
  },
  counterValue: {
    fontSize: 64,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  buttonRow: {
    display: "flex",
    gap: 16,
    justifyContent: "center",
    marginBottom: 16,
  },
  button: {
    fontSize: 20,
    fontWeight: 600,
    padding: "12px 24px",
    backgroundColor: "#3b82f6",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
  secondaryButton: {
    fontSize: 14,
    padding: "8px 16px",
    backgroundColor: "#6b7280",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
  },
  nav: {
    display: "flex",
    gap: 16,
    marginTop: 24,
    paddingTop: 16,
    borderTop: "1px solid #e5e7eb",
  },
  link: {
    color: "#3b82f6",
    textDecoration: "none",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    marginBottom: 16,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 14,
    fontWeight: 500,
  },
  input: {
    padding: "8px 12px",
    fontSize: 16,
    border: "1px solid #d1d5db",
    borderRadius: 6,
  },
};
