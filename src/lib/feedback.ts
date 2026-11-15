// Whether the feedback form is open and what it starts with (screens/settings/Feedback.tsx draws it), and whether
// Check this game is (GameCheck.tsx). Here so the kit's error screen and the Help menu can open them. Owner: SETTINGS/AI
// area.
import { useSyncExternalStore } from "react";
import type { FeedbackKind } from "./api/report";

export interface FeedbackStart { kind: FeedbackKind; text: string }
let start: FeedbackStart | null = null;
const subs = new Set<() => void>();
const set = (s: FeedbackStart | null) => { start = s; subs.forEach((f) => f()); };

/** Open the feedback form, filled in when there's something to start from (a screen's error). */
export function openFeedback(prefill: Partial<FeedbackStart> = {}) { set({ kind: prefill.kind ?? "problem", text: prefill.text ?? "" }); }
export function closeFeedback() { set(null); }
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useFeedbackStart = () => useSyncExternalStore(sub, () => start);

// Check this game (screens/settings/GameCheck.tsx): open for the game picked in the sidebar.
let checking = false;
export function openGameCheck() { checking = true; subs.forEach((f) => f()); }
export function closeGameCheck() { checking = false; subs.forEach((f) => f()); }
export const useGameCheckOpen = () => useSyncExternalStore(sub, () => checking);
