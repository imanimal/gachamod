// Menus drawn by one builder show the keys that work where that builder's thing usually lives (Space, F2 and Del
// in the mod grid). A screen that opens the same menu without handling those keys passes it through `withoutKeys`,
// so a key hint in a menu always works where the menu opened.
import type { MenuEntry } from "../ui/ContextMenu";

/** The same entries with their key hints dropped, except the keys in `keep` (submenus too). */
export function withoutKeys(items: MenuEntry[], keep: string[] = []): MenuEntry[] {
  return items.map((e) => {
    if (!e || e === "-" || "header" in e) return e;
    const out = { ...e };
    if (out.keys && !keep.includes(out.keys)) delete out.keys;
    if (out.items) out.items = withoutKeys(out.items, keep);
    return out;
  });
}
