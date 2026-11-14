// A text box with no Save button: what you type is kept when you press Enter, tab or click away, or close whatever it
// sits in (Esc too). `onCommit` runs once per edit and only when the text changed; it can return the text to show
// after (an empty name shows the old one again). Used by the player card.
// Owner: HOME/PROFILES area.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export function LiveField({ value, onCommit, onEnd, label, ariaLabel, placeholder, hint, multiline, rows = 2, maxLength, autoFocus, className }: {
  value: string;
  onCommit: (v: string) => string | void;
  /** In place of a line of text: Enter, Esc and leaving the box all end the edit (and Esc stops there). */
  onEnd?: (how: "key" | "blur") => void;
  label?: ReactNode; ariaLabel?: string; placeholder?: string; hint?: ReactNode;
  multiline?: boolean; rows?: number; maxLength?: number; autoFocus?: boolean; className?: string;
}) {
  const [v, setV] = useState(value);
  const sent = useRef<string | null>(null);
  const live = useRef({ v, value, onCommit });
  live.current = { v, value, onCommit };
  // a change from elsewhere (Undo, the saved value coming back) shows here
  useEffect(() => { setV(value); sent.current = null; }, [value]);

  const commit = () => {
    const c = live.current;
    if (c.v === c.value || c.v === sent.current) return;
    sent.current = c.v;
    const shown = c.onCommit(c.v);
    if (typeof shown === "string" && shown !== c.v) setV(shown);
  };
  // closing the popover or dialog around it keeps the text too
  useEffect(() => () => commit(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const ended = useRef(false);
  const end = (how: "key" | "blur") => {
    if (ended.current) return;
    ended.current = true;
    commit();
    onEnd?.(how);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (onEnd) {
      e.stopPropagation();
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); end("key"); }
    } else if (e.key === "Enter" && !multiline) { e.preventDefault(); commit(); }
  };
  const props = {
    value: v, placeholder, maxLength, autoFocus, spellCheck: false, "aria-label": ariaLabel,
    onChange: (e: { target: { value: string } }) => setV(e.target.value),
    onBlur: () => (onEnd ? end("blur") : commit()),
    onKeyDown,
  };

  if (onEnd) return <input {...props} className={className} onFocus={(e) => e.currentTarget.select()} />;
  return (
    <label className={`field${className ? ` ${className}` : ""}`}>
      {label && <span className="field-l">{label}</span>}
      {multiline ? <textarea {...props} rows={rows} /> : <input {...props} />}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
