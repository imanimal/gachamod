// The first time the window is closed: keep gachamod running in the background, or quit (src-tauri background.rs).
// Asked once. The answer goes in "app.background", which the Background panel in Settings, General changes later.
// Esc keeps the window open and asks again next time. Owner: SYSTEM area.
import { useEffect, useState } from "react";
import { app as appApi, errorText } from "../lib/api";
import { backgroundPref } from "../lib/prefs";
import { held } from "../lib/tauri";
import { t } from "../lib/i18n";
import { Button, Dialog } from "../ui/kit";
import { toast } from "../ui/toast";

export function CloseAsk() {
  const [open, setOpen] = useState(false);
  // say it's asking at once, or gachamod quits as a close did before
  useEffect(() => held(appApi.onCloseAsk(() => { appApi.closeAsked().catch(() => {}); setOpen(true); })), []);
  if (!open) return null;
  const choose = async (keep: boolean) => {
    setOpen(false);
    try {
      await backgroundPref.set(keep);
      await appApi.close(false);
    } catch (e) { toast(errorText(e), true); }
  };
  return (
    <Dialog icon="power" title={t("Keep gachamod running in the background?")} size="sm" onClose={() => setOpen(false)} footer={<>
      <Button variant="ghost" onClick={() => void choose(false)} title={t("Close gachamod completely when you close the window")}>{t("Quit")}</Button>
      <Button variant="primary" autoFocus onClick={() => void choose(true)} title={t("Close the window and leave gachamod in the tray")}>{t("Keep running")}</Button>
    </>}>
      <p>{t("With the window closed, gachamod waits in the tray and uses almost no memory. Quickstart starts your game from there without opening gachamod, and updates install while it waits.")}</p>
      <p>{t("You won't be asked again, and you can change it later.")}</p>
    </Dialog>
  );
}
