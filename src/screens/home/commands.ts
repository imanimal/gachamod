// Home's commands in the global search: Surprise me (a random mod you might like) and Customise Home.
// Owner: HOME/PROFILES area.
import { errorText } from "../../lib/api";
import { surpriseMe } from "../../lib/recommend";
import { registerCommands, type Command } from "../../lib/search";
import { currentGame, go } from "../../lib/store";
import { toast } from "../../ui/toast";
import { setHomeEditing } from "./layout";

registerCommands("home", () => {
  const g = currentGame();
  const list: Command[] = [
    { id: "home:customise", title: "Customise Home", section: "Actions", icon: "layout",
      keywords: "home widgets layout edit arrange reorder hide show dashboard customize personalise personalize",
      run: () => { go("home"); setHomeEditing(true); } },
  ];
  if (g) {
    list.unshift({ id: "home:surprise", title: "Surprise me", section: "Actions", icon: "dice",
      keywords: "random mod lucky roll dice discover shuffle anything suggest recommend", hint: "Opens a random mod",
      run: () => { surpriseMe(g.id).catch((e) => toast(errorText(e), true)); } });
  }
  return list;
});
