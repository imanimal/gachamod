// Running as administrator: the button on the reload key note, and the one place that restarts gachamod as administrator.
// Owner: SYSTEM area.
import { admin, errorText } from "./api";
import { toast, toastHelper } from "../ui/toast";
import { t } from "./i18n";

/** devtools::f10_note's line for a game that runs as administrator. */
const isAdminNote = (text: string) => /^Press \S+ in the game to load changes/.test(text) && text.includes("administrator");

/** Close gachamod and open it again as administrator (Windows asks first). */
export function restartAsAdmin() {
  admin.restart().catch((e) => toast(errorText(e), true));
}

toastHelper(isAdminNote, { label: t("Restart as administrator"), run: restartAsAdmin });

/** Show the F10 note on its own toast, where it gets its button, and return the other notes (for a toast that already
 *  has Undo). */
export function sayF10(notes: string[]): string[] {
  for (const n of notes.filter(isAdminNote)) toast(n);
  return notes.filter((n) => !isAdminNote(n));
}

/** The F10 note, if it's this one, on its own toast. True when it was. */
export function sayF10Note(note: string | null | undefined): boolean {
  if (!note || !isAdminNote(note)) return false;
  toast(note);
  return true;
}
