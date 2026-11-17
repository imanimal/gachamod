// The tip jar. Help menu, Settings > About, and the palette all open this one page.
import { errorText, shell } from "./api";
import { toast } from "../ui/toast";

export const KOFI_URL = "https://ko-fi.com/aanimal";

export const openKofi = () => void shell.openUrl(KOFI_URL).catch((e) => toast(errorText(e), true));
