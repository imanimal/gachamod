// Keeps one broken screen or overlay from blanking the whole window. Shows what failed and a way back.
// Kinds: a screen (the default) says what failed in place; `quiet` draws nothing and says it once in a toast with
// Try again; `slot` keeps a layout slot (the sidebar, the title bar) with a small note; `whole` is the last resort
// around the window itself. `resetKey` clears the error when it changes (App passes the route).
import { Component, type CSSProperties, type ReactNode } from "react";
import { Icon } from "./Icon";
import { toast } from "./toast";
import { reportError } from "../lib/telemetry";
import { openFeedback } from "../lib/feedback";
import { inTauri, windowAction } from "../lib/tauri";
import { english, t } from "../lib/i18n";

/** Minimise and close for a note that stands in for the title bar (the window has no frame of its own). */
function WinKeys({ style }: { style?: CSSProperties }) {
  return (
    <span className="winkeys" style={style}>
      <button type="button" className="wk" aria-label={t("Minimise")} title={t("Minimise")} onClick={() => void windowAction("minimize")}><Icon name="minus" /></button>
      <button type="button" className="wk wk-x" aria-label={t("Close")} title={t("Close")} onClick={() => { if (inTauri()) void windowAction("close"); }}><Icon name="x" /></button>
    </span>
  );
}

type Props = {
  children: ReactNode;
  /** What the part is called, as people read it (translated); logs and crash reports get its English. */
  where: string;
  quiet?: boolean;
  /** Class names of the slot the part fills, so the note keeps its place in the layout. */
  slot?: string;
  /** The slot is the title bar: the note keeps Minimise and Close. */
  windowKeys?: boolean;
  /** Around the whole window: a full-window page with Reload window. */
  whole?: boolean;
  /** Drawn beside the whole-window page (the feedback form and toasts, which went down with the window). */
  extra?: ReactNode;
  resetKey?: unknown;
};

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  // the error last reported and toasted. A part that fails every time it's drawn fails again after each page change
  // (resetKey): say it once, until someone presses Try again
  said: string | null = null;

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`${english(this.props.where)} failed:`, error);
    if (this.said === error.message) return;
    this.said = error.message;
    // kept as a crash report (sent when crash reports are on)
    const e = new Error(error.message);
    e.stack = `${error.stack ?? ""}
${info.componentStack ?? ""}`;
    reportError(e, english(this.props.where));
    // a quiet part just vanished: say so once, with a way to bring it back
    if (this.props.quiet) {
      toast(t("{where} hit an error and closed. Your files weren't touched", { where: this.props.where }), true,
        { label: t("Try again"), run: this.retry });
    }
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.reset();
  }

  reset = () => this.setState({ error: null });
  /** Pressed by the user: a failure after this is news again. */
  retry = () => { this.said = null; this.reset(); };

  feedback = (error: Error) => openFeedback({ kind: "problem", text: t("{where} hit an error: {message}\n\nWhat I was doing: ", { where: this.props.where, message: error.message }) });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { where, quiet, slot, windowKeys, whole, extra } = this.props;
    if (quiet) return null;
    if (slot) {
      return (
        <div className={slot} role="alert" data-tauri-drag-region
          style={windowKeys ? { display: "flex", alignItems: "center", gap: ".5rem", paddingLeft: ".7rem" } : undefined}>
          <span className="hint">{t("{where} hit an error", { where })}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={this.retry} title={t("Draws the {where} again", { where: where.toLowerCase() })}>
            <Icon name="refresh" /><span className="btn-t">{t("Try again")}</span>
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.location.reload()} title={t("Reloads the whole window. Your files and settings stay")}>
            <span className="btn-t">{t("Reload window")}</span>
          </button>
          {windowKeys && <WinKeys style={{ marginLeft: "auto" }} />}
        </div>
      );
    }
    if (whole) {
      return (
        <>
          <div className="nogame crashed" role="alert" data-tauri-drag-region style={{ minHeight: "100vh", marginTop: 0, justifyContent: "center" }}>
            <h1>{t("gachamod hit an error")}</h1>
            <p>{t("Reloading the window usually fixes it. Your files weren't touched.")}</p>
            <pre className="crash-msg">{error.message}</pre>
            <div className="row">
              <button type="button" className="btn btn-primary" autoFocus onClick={() => window.location.reload()} title={t("Reloads the whole window. Your files and settings stay")}>
                <Icon name="refresh" /><span className="btn-t">{t("Reload window")}</span>
              </button>
              <button type="button" className="btn btn-secondary" data-t="crash-feedback" title={t("Opens the feedback form with this error filled in")}
                onClick={() => this.feedback(error)}>
                <Icon name="help" /><span className="btn-t">{t("Tell the developer")}</span>
              </button>
            </div>
          </div>
          <WinKeys style={{ position: "fixed", top: 0, right: 0, height: 40 }} />
          {extra}
        </>
      );
    }
    return (
      <div className="nogame crashed" role="alert">
        <h1>{t("{where} hit an error", { where })}</h1>
        <p>{t("The rest of the app still works. Your files weren't touched.")}</p>
        <pre className="crash-msg">{error.message}</pre>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={this.retry}>
            <Icon name="refresh" /><span className="btn-t">{t("Try again")}</span>
          </button>
          <button type="button" className="btn btn-secondary" data-t="crash-feedback" title={t("Opens the feedback form with this error filled in")}
            onClick={() => this.feedback(error)}>
            <Icon name="help" /><span className="btn-t">{t("Tell the developer")}</span>
          </button>
        </div>
      </div>
    );
  }
}
