// Settings, Extensions: how many are installed with a way in, and the repo lists for tinkerers. Owner: EXTENSIONS
// area. Settings.tsx shows it after Custom themes.
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_EXT_SOURCE } from "../../lib/api/extensions";
import { extraSources, linkFolder, listedPackages, setExtraSources, sharePackage, updateFor, useExtensions, useRepos } from "../../lib/extensions";
import { go } from "../../lib/store";
import { shell } from "../../lib/api";
import { Button, IconButton, Panel, TextField } from "../../ui/kit";
import { toast } from "../../ui/toast";
import { SetRow } from "../settings/parts";
import { DOCS_URL } from "./Extensions";

export function ExtensionsSection() {
  const list = useExtensions();
  const { repos } = useRepos();
  const listed = useMemo(() => listedPackages(repos), [repos]);
  const n = list?.length ?? 0;
  const updates = (list ?? []).filter((e) => updateFor(e, listed)).length;
  const summary = n ? `${n} installed${updates ? `, ${updates} with an update` : ""}` : "Get themes and extensions other people made";
  return (
    <Panel title="Extensions" icon="puzzle" id="extensions">
      <div className="set-rows">
        <SetRow id="set-extensions" label="Extensions and themes" hint={summary}>
          <span className="set-btns">
            {n > 0 && <Button variant="ghost" onClick={() => go({ view: "extensions", tab: "installed" })}>Manage</Button>}
            <Button icon="puzzle" onClick={() => go({ view: "extensions" })} title="Themes and extensions you can install">Browse extensions</Button>
          </span>
        </SetRow>
        <Sources />
        <SetRow id="set-ext-make" label="Make your own" hint="A folder with extension.json and an HTML page. Link it to see your edits as you go, then share it to get it listed">
          <span className="set-btns">
            <Button variant="ghost" icon="help" onClick={() => void shell.openUrl(DOCS_URL)}>How to</Button>
            <Button variant="ghost" icon="link" onClick={() => void linkFolder()} title="Uses the folder where it is">Link a folder</Button>
            <Button variant="ghost" icon="upload" onClick={() => void sharePackage(repos)} title="Zips a package folder and opens the page where you send it in">Share</Button>
          </span>
        </SetRow>
      </div>
    </Panel>
  );
}

/** Other repos to list packages from (an index.json each). gachamod's own is always first. */
function Sources() {
  const [list, setList] = useState<string[] | null>(null);
  const [adding, setAdding] = useState("");
  useEffect(() => { void extraSources().then(setList); }, []);
  const save = async (next: string[]) => { setList(next); await setExtraSources(next); };
  const add = async () => {
    const url = adding.trim();
    if (!/^https:\/\/\S+$/.test(url)) { toast("Use the https link to the list's index.json", true); return; }
    setAdding("");
    await save([...(list ?? []), url]);
  };
  return (
    <div className="set-row set-row-col" id="set-ext-sources">
      <span><b>Extension lists</b><span className="hint">Where Extensions finds packages. Add another repo's index.json link to list its packages too</span></span>
      <div className="ext-sources">
        <p className="ext-src" title={DEFAULT_EXT_SOURCE}><span>gachamod's list</span></p>
        {(list ?? []).map((u) => (
          <p key={u} className="ext-src" title={u}>
            <span>{u}</span>
            <IconButton icon="x" size="sm" label={`Stop using ${u}`} onClick={() => void save((list ?? []).filter((x) => x !== u))} />
          </p>
        ))}
        <form className="ext-src-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <TextField value={adding} onChange={setAdding} placeholder="https://.../index.json" mono />
          <Button type="submit" icon="plus" disabled={!adding.trim()}>Add</Button>
        </form>
      </div>
    </div>
  );
}
