import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * TEMPORARY diagnostic boundary for the POC page. Surfaces render errors that
 * would otherwise leave the route blank. Remove once the POC is verified.
 */
interface State {
  error: Error | null;
}
export class PocErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[PocErrorBoundary]", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <pre style={{ whiteSpace: "pre-wrap", padding: 16, color: "#c83e2d" }}>
          {this.state.error.name}: {this.state.error.message}
          {"\n\n"}
          {this.state.error.stack}
        </pre>
      );
    }
    return this.props.children;
  }
}
