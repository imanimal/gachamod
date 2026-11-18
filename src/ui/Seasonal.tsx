// Seasonal touches (Settings, Fun extras; off by default). This only sets html[data-season]; styles/fun.css draws
// the season in two quiet places, in the theme's style: along the line under the title bar and as a small mark on
// the logo. Both sit behind the title bar's controls and ignore the pointer. "By the date" checks the calendar again
// whenever the window comes back, so a window left open overnight changes on its own. Owner: SETTINGS/AI area.
import { useEffect, useState } from "react";
import { seasonNow, seasonPref, useSeasonPreview } from "../lib/fun";

export function Seasonal() {
  const pick = seasonPref.use();
  const preview = useSeasonPreview();
  const [, setDay] = useState(() => new Date().toDateString());

  useEffect(() => {
    if (pick !== "date") return;
    const check = () => { if (document.visibilityState === "visible") setDay(new Date().toDateString()); };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [pick]);

  const kind = preview === "off" ? null : preview ?? seasonNow(pick);
  useEffect(() => {
    const r = document.documentElement;
    if (kind) r.dataset.season = kind; else delete r.dataset.season;
    return () => { delete r.dataset.season; };
  }, [kind]);
  return null;
}
