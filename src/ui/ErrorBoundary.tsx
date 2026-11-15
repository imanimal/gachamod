// Keeps one broken screen or overlay from blanking the whole window. Shows what failed and a way back.
import { Component, type ReactNode } from "react";
import { Icon } from "./Icon";
import { reportError } from "../lib/telemetry";
import { openFeedback } from "../lib/feedback";

type Props = { children: ReactNode; where: string; quiet?: boolean };

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`${this.props.where} failed:`, error);
    // kept as a crash report (sent when crash reports are on)
    const e = new Error(error.message);
    e.stack = `${error.stack ?? ""}
${info.componentStack ?? ""}`;
    reportError(e, this.props.where);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <div className="nogame crashed" role="alert">
        <h1>{this.props.where} hit an error</h1>
        <p>The rest of the app still works. Your files weren't touched.</p>
        <pre className="crash-msg">{error.message}</pre>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            <Icon name="refresh" /><span className="btn-t">Try again</span>
          </button>
          <button type="button" className="btn btn-secondary" data-t="crash-feedback" title="Opens the feedback form with this error filled in"
            onClick={() => openFeedback({ kind: "problem", text: `${this.props.where} hit an error: ${error.message}

What I was doing: ` })}>
            <Icon name="help" /><span className="btn-t">Tell the developer</span>
          </button>
        </div>
      </div>
    );
  }
}
