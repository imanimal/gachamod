// A GameBanana mod's comments in the Browse drawer: loaded only once the section scrolls into view, 15 at a time,
// replies on request, popular or newest first (remembered for every mod). Reading only; replying happens on GameBanana. Owner: BROWSE area.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Avatar, Badge, Button, Segmented, Waiting, timeAgo } from "../../ui/kit";
import { Icon } from "../../ui/Icon";
import { CreatorLink } from "../../ui/Links";
import { toast } from "../../ui/toast";
import { errorText, shell } from "../../lib/api";
import { commentReplies, isAbort, modComments, sanitizeHtml, type GbComment, type GbCommentPage, type GbModel } from "../../lib/gamebanana";
import { t, tn } from "../../lib/i18n";

type OnLink = (e: MouseEvent | KeyboardEvent) => void;

type CommentSort = "popular" | "newest";
/** The comment order, kept for every mod. */
const SORT_KEY = "gm.browse.commentSort";
function readSort(): CommentSort {
  try { return localStorage.getItem(SORT_KEY) === "newest" ? "newest" : "popular"; } catch { return "popular"; }
}

interface Pages { items: GbComment[]; total: number; page: number; complete: boolean }

/** Paged loading shared by the comment list and each reply list. */
function usePages(load: (page: number, signal: AbortSignal) => Promise<GbCommentPage>, start: boolean, order = "") {
  const [data, setData] = useState<Pages | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  const fetchPage = (page: number) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setBusy(true); setError(null);
    load(page, c.signal)
      .then((r) => {
        if (c.signal.aborted) return;
        setData((d) => {
          const seen = new Set(d?.items.map((x) => x.id));
          const items = [...(page > 1 && d ? d.items : []), ...r.items.filter((x) => !seen.has(x.id))];
          return { items, total: r.total, page, complete: r.complete || r.items.length === 0 };
        });
      })
      .catch((e) => { if (!c.signal.aborted && !isAbort(e)) setError(errorText(e)); })
      .finally(() => { if (!c.signal.aborted) setBusy(false); });
  };
  useEffect(() => { if (start && !data && !busy && !error) fetchPage(1); }, [start]); // the first page, once it is wanted
  // another order starts over from the first page
  const lastOrder = useRef(order);
  useEffect(() => {
    if (lastOrder.current === order) return;
    lastOrder.current = order;
    if (start) { setData(null); fetchPage(1); }
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => ctl.current?.abort(), []);
  const more = () => fetchPage((data?.page ?? 0) + 1);
  const retry = () => fetchPage(data ? data.page + 1 : 1);
  return { data, error, busy, more, retry };
}

export function Comments({ modId, model = "Mod", url, onLink }: { modId: number; model?: GbModel; url: string; onLink: OnLink }) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const [sort, setSort] = useState<CommentSort>(readSort);
  const pickSort = (v: CommentSort) => { setSort(v); try { localStorage.setItem(SORT_KEY, v); } catch { /* storage off */ } };
  const { data, error, busy, more, retry } = usePages((p, s) => modComments(modId, p, sort, s, model), seen, sort);
  const openSite = () => void shell.openUrl(url).catch((e) => toast(errorText(e), true));

  return (
    <section ref={ref} className="gb-comments" aria-label={t("Comments")}>
      <div className="gb-comments-h">
        <h3 className="sub-h">{t("Comments")}</h3>
        {data && data.total > 0 && <span className="muted">{data.total}</span>}
        <span className="grow" />
        <Segmented<CommentSort> label={t("Sort comments")} size="sm" value={sort} onChange={pickSort} options={[
          { value: "popular", label: t("Popular"), title: t("Most liked comments first") },
          { value: "newest", label: t("Newest"), title: t("Newest comments first, such as reports after a game update") },
        ]} />
        <Button size="sm" variant="ghost" icon="external" onClick={openSite} title={t("Comments are written on GameBanana")}>{t("Reply on GameBanana")}</Button>
      </div>
      {!data && !error && (seen || busy) && (
        <Waiting className="gb-comments-skel" what={t("Loading comments")} hold={t("GameBanana is slow to answer. Reply on GameBanana opens the comments there")} />
      )}
      {data && data.items.length === 0 && !error && <p className="muted">{t("No comments yet.")}</p>}
      {data && data.items.length > 0 && (
        <ol className="gb-comment-list">{data.items.map((c) => <Comment key={c.id} c={c} onLink={onLink} />)}</ol>
      )}
      {error && (
        <div className="gb-comments-err">
          <span className="hint">{data ? t("Couldn't load more comments. {error}", { error }) : t("Couldn't load the comments. {error}", { error })}</span>
          <Button size="sm" icon="refresh" onClick={retry}>{t("Try again")}</Button>
        </div>
      )}
      {data && !data.complete && !error && (
        <Button className="gb-comments-more" busy={busy} onClick={more}>{t("Load more")}</Button>
      )}
    </section>
  );
}

function Comment({ c, onLink, reply }: { c: GbComment; onLink: OnLink; reply?: boolean }) {
  const [open, setOpen] = useState(false);
  const html = useMemo(() => sanitizeHtml(c.html), [c.html]);
  const name = c.author?.name ?? t("Someone");
  return (
    <li className={`gb-comment${reply ? " is-reply" : ""}`}>
      <Avatar src={c.author?.avatar ?? null} name={name} size={reply ? 24 : 32} />
      <div className="gb-comment-main">
        <div className="gb-comment-h">
          {c.author
            ? <CreatorLink id={c.author.id} name={name} className="gb-comment-who" />
            : <strong>{name}</strong>}
          {c.labels.includes("Submitter") && <Badge tone="accent">{t("Author")}</Badge>}
          {c.pinned && !reply && <Badge icon="pin">{t("Pinned")}</Badge>}
          <span className="muted" title={new Date(c.added * 1000).toLocaleString()}>{timeAgo(c.added)}</span>
        </div>
        <div className="gb-desc gb-comment-text selectable" onClick={onLink} onKeyDown={onLink} dangerouslySetInnerHTML={{ __html: html }} />
        {c.replies > 0 && !reply && (
          <button type="button" className="gb-older gb-comment-replies" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? "down" : "chevron"} /><span>{tn(c.replies, "{n} reply", "{n} replies")}</span>
          </button>
        )}
        {open && <Replies postId={c.id} onLink={onLink} />}
      </div>
    </li>
  );
}

function Replies({ postId, onLink }: { postId: number; onLink: OnLink }) {
  const { data, error, busy, more, retry } = usePages((p, s) => commentReplies(postId, p, s), true);
  if (!data && !error) return <Waiting what={t("Loading replies")} hold={t("GameBanana is slow to answer. Reply on GameBanana opens the comments there")} />;
  return (
    <>
      {data && data.items.length > 0 && <ol className="gb-comment-list">{data.items.map((r) => <Comment key={r.id} c={r} onLink={onLink} reply />)}</ol>}
      {data && data.items.length === 0 && !error && <p className="muted">{t("The replies were removed.")}</p>}
      {error && <div className="gb-comments-err"><span className="hint">{error}</span><Button size="sm" icon="refresh" onClick={retry}>{t("Try again")}</Button></div>}
      {data && !data.complete && !error && <Button size="sm" variant="ghost" busy={busy} onClick={more}>{t("More replies")}</Button>}
    </>
  );
}
