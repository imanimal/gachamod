// The search at the top of Settings and Tools: one index of both menus' pages, panels and single settings
// (settingsSearch.ts and tools/toolsSearch.ts), matched the way the global search matches (lib/search.ts), so a
// setting someone looks for in Tools still turns up there. Each screen registers its panels here, and a panel that
// matches draws in whichever menu the search ran in (SearchResults.tsx). Owner: SETTINGS/AI area.
import type { ComponentType } from "react";
import type { PageInfo } from "./Paged";
import { PAGES, SECTIONS, SETTINGS, type SectionInfo } from "./settingsSearch";
import { TOOL_PAGES, TOOL_SECTIONS } from "../tools/toolsSearch";
import { aiShown } from "../../lib/ai";
import { t } from "../../lib/i18n";
import { scoreCommand } from "../../lib/search";

export type Menu = "settings" | "tools";

export const menuName = (menu: Menu): string => (menu === "tools" ? t("Tools") : t("Settings"));

// ── the panels, by route id ──

const panels: Record<Menu, Record<string, ComponentType>> = { settings: {}, tools: {} };
/** A screen's panels by their route id. Two ids can share one component when it draws both panels. */
export function registerPanels(menu: Menu, map: Record<string, ComponentType>) { panels[menu] = map; }
export const panelOf = (menu: Menu, id: string): ComponentType | undefined => panels[menu][id];

// ── matching ──

/** A page with the panels on it that matched, in page order, and the single settings in them to highlight. */
export interface Found { menu: Menu; page: PageInfo; panels: string[]; rows: string[]; score: number }

const MENUS: Array<{ menu: Menu; pages: PageInfo[]; sections: SectionInfo[] }> = [
  { menu: "settings", pages: PAGES, sections: SECTIONS },
  { menu: "tools", pages: TOOL_PAGES, sections: TOOL_SECTIONS },
];
const AI_ROWS = new Set(["set-ai-chatbot", "set-ai-adult", "set-ai-jobs"]);
/** At most this many panels draw at once, so a one-letter search doesn't build both menus. */
const MAX_PANELS = 12;

/** Pages with matching panels, best first; the menu the search runs in wins a tie. Tools is left out with no game. */
export function searchMenus(query: string, here: Menu, withTools: boolean): Found[] {
  if (!query.trim()) return [];
  const hits: Array<{ menu: Menu; page: PageInfo; panel: string; rows: string[]; score: number }> = [];
  for (const m of MENUS) {
    if (m.menu === "tools" && !withTools) continue;
    const name = menuName(m.menu);
    for (const page of m.pages) {
      const pageScore = scoreCommand(query, { title: page.label, keywords: page.keywords, where: name });
      for (const s of m.sections) {
        if (s.page !== page.id) continue;
        const own = Math.max(pageScore, scoreCommand(query, { title: s.label, keywords: s.keywords, where: `${name} ${page.label}` }));
        let score = own;
        const rows: string[] = [];
        if (m.menu === "settings") {
          for (const [id, panel, title, keywords] of SETTINGS) {
            if (panel !== s.id || (AI_ROWS.has(id) && !aiShown("useful"))) continue;
            const r = scoreCommand(query, { title, keywords, where: s.label });
            if (!r) continue;
            // a row lights up when it matches at least as well as its panel or page does
            if (r >= own && !rows.includes(id)) rows.push(id);
            score = Math.max(score, r);
          }
        }
        if (score > 0) hits.push({ menu: m.menu, page, panel: s.id, rows, score });
      }
    }
  }
  if (!hits.length) return [];
  const best = Math.max(...hits.map((h) => h.score));
  const kept = hits.filter((h) => h.score >= best * 0.5).sort((a, b) => b.score - a.score).slice(0, MAX_PANELS);
  const out: Found[] = [];
  const order = (menu: Menu, id: string) => MENUS.findIndex((m) => m.menu === menu) * 1000 + MENUS.find((m) => m.menu === menu)!.sections.findIndex((s) => s.id === id);
  for (const h of kept) {
    let f = out.find((x) => x.menu === h.menu && x.page.id === h.page.id);
    if (!f) out.push(f = { menu: h.menu, page: h.page, panels: [], rows: [], score: h.score });
    f.panels.push(h.panel);
    f.rows.push(...h.rows);
  }
  for (const f of out) f.panels.sort((a, b) => order(f.menu, a) - order(f.menu, b));
  const here1 = (f: Found) => (f.menu === here ? 0 : 1);
  out.sort((a, b) => b.score - a.score || here1(a) - here1(b) || order(a.menu, a.panels[0]!) - order(b.menu, b.panels[0]!));
  return out;
}
