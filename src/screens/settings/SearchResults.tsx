// What the search at the top of Settings and Tools found (menuSearch.ts): the matching panels themselves, live and
// straight in the page body like any page's panels, so they keep the page look. Each page's panels sit under a line
// saying where they normally live, with a button that goes there, and single settings that matched are lit. With
// nothing found it offers the global search, which looks through mods too. Owner: SETTINGS/AI area.
import { Fragment, useLayoutEffect, useMemo, useRef, type ComponentType } from "react";
import { Button, Empty } from "../../ui/kit";
import { openPalette } from "../../shell/state";
import { go, useGame } from "../../lib/store";
import { t } from "../../lib/i18n";
import { menuName, panelOf, searchMenus, type Found, type Menu } from "./menuSearch";

/** Where a page's button goes: its one lit setting, its one panel, or the page. */
const target = (f: Found) => (f.rows.length === 1 ? f.rows[0]! : f.panels.length === 1 ? f.panels[0]! : f.page.id);

export function SearchResults({ query, here }: { query: string; here: Menu }) {
  const hasGame = !!useGame();
  const found = useMemo(() => searchMenus(query, here, hasGame), [query, here, hasGame]);
  const box = useRef<HTMLDivElement>(null);

  // light the matching rows, again when a list inside a panel finishes loading or redraws them
  useLayoutEffect(() => {
    const el = box.current;
    const ids = found.flatMap((f) => f.rows);
    if (!el || !ids.length) return;
    const sel = ids.map((id) => `[id="${CSS.escape(id)}"]`).join(",");
    const mark = () => el.querySelectorAll(sel).forEach((r) => { if (!r.classList.contains("pg-hit")) r.classList.add("pg-hit"); });
    mark();
    const mo = new MutationObserver(mark);
    mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => { mo.disconnect(); el.querySelectorAll(".pg-hit").forEach((r) => r.classList.remove("pg-hit")); };
  }, [found]);

  const text = query.trim();
  if (!found.length) {
    return (
      <div className="pg-body">
        <Empty icon="search" title={t("Nothing in Settings or Tools matches “{text}”", { text })}
          actions={<Button icon="search" onClick={() => openPalette(text)} title={t("Opens the search for “{text}” (Ctrl+K)", { text })}>{t("Search everything")}</Button>}>
          {t("Search everything looks through your mods, characters and profiles too.")}
        </Empty>
      </div>
    );
  }
  return (
    <div className="pg-body" ref={box}>
      {found.map((f) => {
        // a component that draws two panels (Launch options and Mod maker switches) draws once
        const parts: Array<[string, ComponentType]> = [];
        for (const id of f.panels) {
          const C = panelOf(f.menu, id);
          if (C && !parts.some((p) => p[1] === C)) parts.push([id, C]);
        }
        const where = menuName(f.menu);
        return (
          <Fragment key={`${f.menu}:${f.page.id}`}>
            <div className="pg-from">
              <span>{t("In {menu}, {page}", { menu: where, page: f.page.label })}</span>
              <Button size="sm" variant="ghost" icon="right" onClick={() => go({ view: f.menu, section: target(f) })}
                title={t("Leaves the search and opens {menu}, {page}", { menu: where, page: f.page.label })}>
                {t("Open {page}", { page: f.page.label })}</Button>
            </div>
            {parts.map(([id, C]) => <C key={id} />)}
          </Fragment>
        );
      })}
    </div>
  );
}
