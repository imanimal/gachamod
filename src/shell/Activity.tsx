// The title bar's "working on" button: shown while anything takes longer than a moment, it names what gachamod is
// waiting on and for how long. Clicking it (or "Show what's running" in the palette) lists every wait with what
// could be holding it. Owner: SHELL area.
import { useEffect, useRef, useState } from "react";
import { Popover } from "../ui/Popover";
import { Spinner } from "../ui/kit";
import { Icon } from "../ui/Icon";
import { SLOW_MS, STUCK_MS, seconds, useActivity, type Task } from "../lib/activity";
import { t, tn } from "../lib/i18n";

let opener: (() => void) | null = null;
/** Open the list of what's running (the palette's "Show what's running"). */
export function openActivity() { opener?.(); }

export function Activity() {
  const all = useActivity();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { opener = () => setOpen(true); return () => { opener = null; }; }, []);
  const now = Date.now();
  const slow = all.filter((task) => now - task.started >= SLOW_MS);
  if (!slow.length && !open) return null;

  const first = slow[0];
  const stuck = slow.some((task) => now - task.started >= STUCK_MS);
  const time = first ? seconds(Math.floor((now - first.started) / 1000)) : "";
  const label = !first ? t("Nothing running")
    : slow.length > 1 ? tn(slow.length - 1, "{what}, {time} (and {n} more)", "{what}, {time} (and {n} more)", { what: first.what, time })
    : t("{what}, {time}", { what: first.what, time });
  return (
    <>
      <button ref={ref} type="button" className={`tb-act${stuck ? " is-long" : ""}`} aria-expanded={open}
        title={first ? t("{what}. Click to see what could be holding it", { what: label }) : t("Everything finished")}
        onClick={() => setOpen((o) => !o)}>
        {first ? <Spinner /> : <Icon name="check" />}
        <span className="tb-act-t" title={first ? first.what : t("Done")}>{first ? first.what : t("Done")}</span>
        {first && <span className="tb-act-s">{seconds(Math.floor((now - first.started) / 1000))}</span>}
        {slow.length > 1 && <span className="tb-act-n">+{slow.length - 1}</span>}
      </button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} label={t("What gachamod is waiting on")} width="26em">
          <div className="act-list">
            {slow.length ? slow.map((task) => <Row key={task.id} task={task} now={now} />)
              : <p className="act-none">{t("Nothing is running now.")}</p>}
          </div>
        </Popover>
      )}
    </>
  );
}

function Row({ task, now }: { task: Task; now: number }) {
  const s = Math.floor((now - task.started) / 1000);
  const long = now - task.started >= STUCK_MS;
  return (
    <div className={`act-row${long ? " is-long" : ""}`}>
      <div className="act-head"><Spinner /><b>{task.what}</b><span className="act-s">{seconds(s)}</span></div>
      <p className="act-hold">{long ? t("Taking longer than usual. {hold}", { hold: task.hold }) : task.hold}</p>
    </div>
  );
}
