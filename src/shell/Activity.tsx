// The title bar's "working on" button: shown while anything takes longer than a moment, it names what gachamod is
// waiting on and for how long. Clicking it (or "Show what's running" in the palette) lists every wait with what
// could be holding it. Owner: SHELL area.
import { useEffect, useRef, useState } from "react";
import { Popover } from "../ui/Popover";
import { Spinner } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { SLOW_MS, STUCK_MS, seconds, useActivity, type Task } from "../lib/activity";

let opener: (() => void) | null = null;
/** Open the list of what's running (the palette's "Show what's running"). */
export function openActivity() { opener?.(); }

export function Activity() {
  const all = useActivity();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { opener = () => setOpen(true); return () => { opener = null; }; }, []);
  const now = Date.now();
  const slow = all.filter((t) => now - t.started >= SLOW_MS);
  if (!slow.length && !open) return null;

  const first = slow[0];
  const stuck = slow.some((t) => now - t.started >= STUCK_MS);
  const label = first
    ? `${first.what}, ${seconds(Math.floor((now - first.started) / 1000))}${slow.length > 1 ? ` (and ${slow.length - 1} more)` : ""}`
    : "Nothing running";
  return (
    <>
      <button ref={ref} type="button" className={`tb-act${stuck ? " is-long" : ""}`} aria-expanded={open}
        title={first ? `${label}. Click to see what could be holding it` : "Everything finished"}
        onClick={() => setOpen((o) => !o)}>
        {first ? <Spinner /> : <Icon name="check" />}
        <span className="tb-act-t">{first ? first.what : "Done"}</span>
        {first && <span className="tb-act-s">{seconds(Math.floor((now - first.started) / 1000))}</span>}
        {slow.length > 1 && <span className="tb-act-n">+{slow.length - 1}</span>}
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} label="What gachamod is waiting on" width="26em">
          <div className="act-list">
            {slow.length ? slow.map((t) => <Row key={t.id} t={t} now={now} />)
              : <p className="act-none">Nothing is running now.</p>}
          </div>
        </Popover>
      )}
    </>
  );
}

function Row({ t, now }: { t: Task; now: number }) {
  const s = Math.floor((now - t.started) / 1000);
  const long = now - t.started >= STUCK_MS;
  return (
    <div className={`act-row${long ? " is-long" : ""}`}>
      <div className="act-head"><Spinner /><b>{t.what}</b><span className="act-s">{seconds(s)}</span></div>
      <p className="act-hold">{long ? "Taking longer than usual. " : ""}{t.hold}</p>
    </div>
  );
}
