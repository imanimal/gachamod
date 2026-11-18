// The one question before removing mods: asked only when some of them can't come back, because the trash keeps no
// files and they have no GameBanana link to download again. It mounts itself on first use. Owner: LIBRARY area.
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type { ModEntry } from "../../lib/api";
import { go } from "../../lib/store";
import { Button, Confirm } from "../../ui/kit";
import { t, tn } from "../../lib/i18n";

interface Ask { lost: ModEntry[]; total: number; answer: (yes: boolean) => void }

let current: Ask | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let mounted = false;

/** Ask before deleting `lost` (of `total` mods being removed) for good. Resolves true to go ahead. */
export function confirmDelete(lost: ModEntry[], total: number): Promise<boolean> {
  if (!mounted) {
    mounted = true;
    const el = document.createElement("div");
    el.className = "lib-confirm-delete";
    document.body.appendChild(el);
    createRoot(el).render(<Host />);
  }
  current?.answer(false);
  return new Promise((resolve) => { current = { lost, total, answer: resolve }; emit(); });
}

const done = (yes: boolean) => { const a = current; current = null; emit(); a?.answer(yes); };

function Host() {
  const a = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => current);
  if (!a) return null;
  const one = a.lost.length === 1;
  const first = a.lost.slice(0, 5).map((m) => m.name).join(", ");
  const names = a.lost.length > 5 ? t("{names} and {n} more", { names: first, n: a.lost.length - 5 }) : first;
  const title = a.total === 1 ? t("Delete {mod}?", { mod: a.lost[0]!.name }) : tn(a.total, "Delete {n} mod?", "Delete {n} mods?");
  return (
    <Confirm danger yes={t("Delete")} title={title} onYes={() => done(true)} onClose={() => done(false)}>
      <div className="lib-say">
        <p>
          {a.total === 1 ? t("Removed mods' files are deleted right away, and this one has no GameBanana link to download it again, so Undo can't bring it back.")
            : one ? t("Removed mods' files are deleted right away, and {names} has no GameBanana link to download it again, so Undo can't bring it back.", { names })
            : t("Removed mods' files are deleted right away, and {names} have no GameBanana link to download them again, so Undo can't bring them back.", { names })}
        </p>
        <Button size="sm" variant="ghost" icon="settings" title={t("Settings, Trash and removed mods: keep removed files for a while so Undo and Put back work")}
          onClick={() => { done(false); go({ view: "settings", section: "set-trash-days" }); }}>
          {t("Trash settings")}
        </Button>
      </div>
    </Confirm>
  );
}
