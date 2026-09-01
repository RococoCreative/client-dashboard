// Last-resort catch for render crashes so users see a calm recovery screen instead of a
// white page. Class component because React error boundaries still require one.
import { Component, type ErrorInfo, type ReactNode } from "react";
import Button from "./ui/Button.tsx";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg p-6">
        <div className="max-w-md rounded-lg border border-line bg-surface p-8 text-center shadow-md">
          <p className="eyebrow">Something went wrong</p>
          <h1 className="mt-3 font-display text-2xl text-heading">This page hit an unexpected error</h1>
          <p className="mt-2 text-ink-2">Your work saves as you go, so nothing should be lost. Reload to pick up where you left off.</p>
          <Button className="mt-6" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }
}
