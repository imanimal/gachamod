// The one question before removing mods: asked only when some of them can't come back, because the trash keeps no
// files and they have no GameBanana link to download again. It mounts itself on first use. Owner: LIBRARY area.
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import type { ModEntry } from "../../lib/api";
import { go } from "../../lib/store";
import { Button, Confirm } from "../../ui/kit";

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
  const names = a.lost.slice(0, 5).map((m) => m.name).join(", ") + (a.lost.length > 5 ? ` and ${a.lost.length - 5} more` : "");
  const title = a.total === 1 ? `Delete ${a.lost[0]!.name}?` : `Delete ${a.total} mods?`;
  return (
    <Confirm danger yes="Delete" title={title} onYes={() => done(true)} onClose={() => done(false)}>
      <p>
        Removed mods' files are deleted right away, and {a.total === 1 ? "this one has" : one ? `${names} has` : `${names} have`} no
        GameBanana link to download {one ? "it" : "them"} again, so Undo can't bring {one ? "it" : "them"} back.
      </p>
      <Button size="sm" variant="ghost" icon="settings" title="Settings, Trash and removed mods: keep removed files for a while so Undo and Put back work"
        onClick={() => { done(false); go({ view: "settings", section: "set-trash-days" }); }}>
        Trash settings
      </Button>
    </Confirm>
  );
}
