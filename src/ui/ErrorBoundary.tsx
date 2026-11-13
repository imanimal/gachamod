// Keeps one broken screen or overlay from blanking the whole window. Shows what failed and a way back.
import { Component, type ReactNode } from "react";
import { Icon } from "./Icon";

type Props = { children: ReactNode; where: string; quiet?: boolean };

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error) { console.error(`${this.props.where} failed:`, error); }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.quiet) return null;
    return (
      <div className="nogame crashed" role="alert">
        <h1>{this.props.where} hit an error</h1>
        <p>The rest of the app still works. Your files weren't touched.</p>
        <pre className="crash-msg">{error.message}</pre>
        <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
          <Icon name="refresh" /><span className="btn-t">Try again</span>
        </button>
      </div>
    );
  }
}
