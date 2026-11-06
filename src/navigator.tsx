import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from "solid-js";
import type { NavigatorContext } from "./definition";
import { createNavigatorData } from "./data";
import {
  groupSessions,
  pathKey,
  type Entry,
  type ProjectGroup,
  type Snapshot,
} from "./model";

export function Navigator(props: {
  ctx: NavigatorContext;
  cache: Map<string, Snapshot>;
  close(): void;
}) {
  const ctx = props.ctx;
  const ui = ctx.ui;
  const prefs = ctx.stores.navigation;
  const data = createNavigatorData(ctx, props.cache);
  const [query, setQuery] = createSignal("");
  const [scope, setScope] = createSignal(prefs.value.scope);
  const [focused, setFocused] = createSignal("");
  const [opening, setOpening] = createSignal<string>();
  const [navigating, setNavigating] = createSignal<Entry>();
  const [error, setError] = createSignal<{ key: string; message: string }>();
  const [now, setNow] = createSignal(Date.now());
  const controller = new AbortController();
  const timer = setInterval(() => setNow(Date.now()), 60_000);
  let routeTimer: ReturnType<typeof setTimeout> | undefined;
  let list!: HTMLDivElement;
  let restored = false;
  let locatePending = false;

  onCleanup(() => {
    controller.abort();
    clearInterval(timer);
    clearTimeout(routeTimer);
  });

  const allGroups = createMemo(() => groupSessions(data.snapshots()));
  const currentKey = () => {
    const session = ctx.sessions.current();
    if (!session) return;
    const id = session.server.data.session.root(session.id) || session.id;
    return `${session.server.id}\0${id}`;
  };
  const currentProject = createMemo(() => {
    const key = currentKey();
    const group = allGroups().find((item) =>
      item.entries.some((entry) => entry.key === key),
    );
    if (group) return group.key;
    const current = ctx.sessions.current();
    if (current)
      return `${current.server.id}\0${pathKey(current.listedProject?.worktree ?? current.directory)}`;
  });
  const effectiveScope = () => (currentProject() ? scope() : "all");
  const scrollKey = () =>
    effectiveScope() === "all" ? "all" : currentProject()!;
  const terms = createMemo(() =>
    query()
      .trim()
      .toLocaleLowerCase(ctx.locale.locale())
      .split(/\s+/)
      .filter(Boolean),
  );
  const searching = () => terms().length > 0;

  // Freeze each row's position for this dialog visit, including when live updates change its timestamp.
  const projectOrder = new Map<string, number>();
  const sessionOrder = new Map<string, number>();
  const ordered = createMemo(() => {
    const groups = allGroups()
      .map((group) => ({
        ...group,
        entries: [...group.entries].sort(
          (a, b) => b.session.time.updated - a.session.time.updated,
        ),
      }))
      .sort(
        (a, b) =>
          b.entries[0].session.time.updated - a.entries[0].session.time.updated,
      );
    for (const group of groups) {
      if (!projectOrder.has(group.key))
        projectOrder.set(group.key, projectOrder.size);
      for (const entry of group.entries) {
        if (!sessionOrder.has(entry.key))
          sessionOrder.set(entry.key, sessionOrder.size);
      }
      group.entries.sort(
        (a, b) => sessionOrder.get(a.key)! - sessionOrder.get(b.key)!,
      );
    }
    return groups.sort(
      (a, b) =>
        Number(b.key === currentProject()) -
          Number(a.key === currentProject()) ||
        projectOrder.get(a.key)! - projectOrder.get(b.key)!,
    );
  });
  const groups = createMemo(() =>
    ordered().flatMap((group) => {
      if (effectiveScope() === "current" && group.key !== currentProject())
        return [];
      if (!searching()) return [group];
      const projectText = `${group.name} ${group.directory}`.toLocaleLowerCase(
        ctx.locale.locale(),
      );
      const entries = group.entries.filter((entry) => {
        const text =
          `${projectText} ${entry.session.title ?? ""} ${entry.session.location.directory}`.toLocaleLowerCase(
            ctx.locale.locale(),
          );
        return terms().every((term) => text.includes(term));
      });
      return entries.length ? [{ ...group, entries }] : [];
    }),
  );
  const byKey = createMemo(
    () => new Map(groups().map((group) => [group.key, group])),
  );
  const expanded = (key: string) =>
    searching() || (prefs.value.expanded[key] ?? key === currentProject());
  const visible = (group: ProjectGroup) => {
    if (searching()) return group.entries;
    const entries = group.entries.slice(0, prefs.value.limits[group.key] ?? 8);
    const current = group.entries.find((entry) => entry.key === currentKey());
    return current && !entries.includes(current)
      ? [...entries, current]
      : entries;
  };
  const toggle = (key: string, value = !expanded(key)) => {
    if (searching()) return;
    prefs.update((draft) => {
      draft.expanded[key] = value;
    });
  };
  const rememberScroll = () => {
    if (searching() || !restored) return;
    prefs.update((draft) => {
      draft.scroll[scrollKey()] = list.scrollTop;
    });
  };

  createEffect(() => {
    groups().forEach((group) => {
      expanded(group.key);
      visible(group);
    });
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      const buttons = [
        ...list.querySelectorAll<HTMLButtonElement>(
          "[data-nav]:not(:disabled)",
        ),
      ];
      if (!buttons.some((button) => button.dataset.nav === focused())) {
        setFocused(buttons[0]?.dataset.nav ?? "");
      }
    });
  });

  createEffect(() => {
    if (restored || data.loading()) return;
    groups();
    queueMicrotask(() => {
      if (controller.signal.aborted || restored) return;
      list.scrollTop = prefs.value.scroll[scrollKey()] ?? 0;
      restored = true;
    });
  });

  const changeQuery = (value: string) => {
    rememberScroll();
    setQuery(value);
    queueMicrotask(() => {
      if (!controller.signal.aborted)
        list.scrollTop = searching()
          ? 0
          : (prefs.value.scroll[scrollKey()] ?? 0);
    });
  };
  const changeScope = (value: "all" | "current") => {
    rememberScroll();
    setScope(value);
    prefs.update((draft) => {
      draft.scope = value;
    });
    list.scrollTop = 0;
  };
  const focusCurrent = () => {
    const target = [
      ...list.querySelectorAll<HTMLButtonElement>("[data-session-key]"),
    ].find((item) => item.dataset.sessionKey === currentKey());
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest" });
  };
  const locate = () => {
    rememberScroll();
    setQuery("");
    setScope("all");
    prefs.update((draft) => {
      draft.scope = "all";
      const key = currentProject();
      if (key) draft.expanded[key] = true;
    });
    locatePending = true;
    queueMicrotask(focusCurrent);
  };
  createEffect(() => {
    if (!locatePending || data.loading()) return;
    groups();
    queueMicrotask(() => {
      if (!controller.signal.aborted) focusCurrent();
      locatePending = false;
    });
  });

  createEffect(() => {
    const target = navigating();
    const current = ctx.sessions.current();
    if (
      !target ||
      !current ||
      current.server.id !== target.server ||
      current.id !== target.session.id
    )
      return;
    clearTimeout(routeTimer);
    props.close();
  });

  const open = async (entry: Entry) => {
    if (opening()) return;
    setOpening(entry.key);
    setError(undefined);
    try {
      const server = ctx.servers.get(entry.server);
      if (!server?.connected || !server.compatible)
        throw new Error("Server unavailable");
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(15_000),
      ]);
      const session = await server.client.session.get(
        { sessionID: entry.session.id },
        { signal },
      );
      if (controller.signal.aborted) return;
      data.update(entry.server, session);
      if (session.time.archived !== undefined) {
        setError({ key: entry.key, message: ctx.t("archived") });
        setOpening(undefined);
        return;
      }
      server.data.session.remember(session);
      ctx.tabs.open({ server: entry.server, id: session.id }, { focus: true });
      setNavigating({ ...entry, session });
      routeTimer = setTimeout(() => {
        if (controller.signal.aborted) return;
        setNavigating(undefined);
        setOpening(undefined);
        setError({ key: entry.key, message: ctx.t("openFailed") });
      }, 10_000);
    } catch {
      if (controller.signal.aborted) return;
      setOpening(undefined);
      setError({ key: entry.key, message: ctx.t("openFailed") });
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    const target = event.target as HTMLElement;
    const buttons = [
      ...list.querySelectorAll<HTMLButtonElement>("[data-nav]:not(:disabled)"),
    ];
    if (target.tagName === "INPUT") {
      if (event.key === "ArrowDown" && buttons.length) {
        event.preventDefault();
        buttons[0].focus();
      }
      return;
    }
    const button = target.closest<HTMLButtonElement>("[data-nav]");
    if (!button) return;
    const index = buttons.indexOf(button);
    let next: HTMLButtonElement | undefined;
    if (event.key === "ArrowDown")
      next = buttons[Math.min(index + 1, buttons.length - 1)];
    else if (event.key === "ArrowUp") next = buttons[Math.max(index - 1, 0)];
    else if (event.key === "Home") next = buttons[0];
    else if (event.key === "End") next = buttons.at(-1);
    else if (event.key === "ArrowRight" && button.dataset.kind === "project")
      toggle(button.dataset.group!, true);
    else if (event.key === "ArrowLeft") {
      if (button.dataset.kind === "project")
        toggle(button.dataset.group!, false);
      else
        next = buttons.find(
          (item) =>
            item.dataset.kind === "project" &&
            item.dataset.group === button.dataset.group,
        );
    } else return;
    event.preventDefault();
    next?.focus({ preventScroll: true });
    next?.scrollIntoView({ block: "nearest" });
  };

  const age = (timestamp: number) => {
    const minutes = Math.floor(Math.max(0, now() - timestamp) / 60_000);
    if (!minutes) return ctx.t("now");
    const relative = new Intl.RelativeTimeFormat(ctx.locale.locale(), {
      numeric: "auto",
      style: "short",
    });
    if (minutes < 60) return relative.format(-minutes, "minute");
    if (minutes < 1440)
      return relative.format(-Math.floor(minutes / 60), "hour");
    return relative.format(-Math.floor(minutes / 1440), "day");
  };
  const status = (entry: Entry) => {
    const server = ctx.servers.get(entry.server);
    if (!server?.connected) return;
    const sessions = server.data.session;
    const ids = [entry.session.id, ...sessions.family(entry.session.id)];
    if (ids.some((id) => (sessions.permission.list(id)?.length ?? 0) > 0))
      return "approval";
    if (ids.some((id) => (sessions.form.list(id)?.length ?? 0) > 0))
      return "input";
    if (
      ids.some((id) => sessions.status(id) === "running") ||
      (entry.session.time.busy ?? 0) > (entry.session.time.idle ?? 0)
    )
      return "working";
  };
  const metadata = (entry: Entry, group: ProjectGroup) => {
    const branch = ctx.servers
      .get(entry.server)
      ?.data.location.vcs.info(entry.session.location)?.branch.current;
    if (branch) return branch;
    return pathKey(entry.session.location.directory) ===
      pathKey(group.directory)
      ? undefined
      : entry.session.location.directory;
  };
  const hints = [
    { keys: ["↑", "↓"], label: "selectHint" },
    { keys: ["←", "→"], label: "expandHint" },
    { keys: ["Enter"], label: "openHint" },
    { keys: ["Esc"], label: "closeHint" },
  ];

  return (
    <ui.Dialog
      title={ctx.t("title")}
      size="large"
      footer={
        <div class="ps-hints">
          <For each={hints}>
            {(hint) => (
              <span>
                <ui.Keybind keys={hint.keys} />
                {ctx.t(hint.label)}
              </span>
            )}
          </For>
        </div>
      }
    >
      <div
        class="ps-navigator"
        onKeyDown={onKeyDown}
        onFocusIn={(event) => {
          const button = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-nav]",
          );
          if (button) setFocused(button.dataset.nav!);
        }}
      >
        <div class="ps-controls">
          <ui.TextInput
            class="ps-search"
            type="search"
            size="large"
            autofocus
            label={ctx.t("search")}
            placeholder={ctx.t("search")}
            value={query()}
            onInput={changeQuery}
          />
          <div class="ps-toolbar">
            <div class="ps-scopes" role="group" aria-label={ctx.t("all")}>
              <button
                type="button"
                class="ps-scope"
                aria-pressed={effectiveScope() === "all"}
                onClick={() => changeScope("all")}
              >
                {ctx.t("all")}
              </button>
              <button
                type="button"
                class="ps-scope"
                aria-pressed={effectiveScope() === "current"}
                disabled={!currentProject()}
                onClick={() => changeScope("current")}
              >
                {ctx.t("currentProject")}
              </button>
            </div>
            <ui.Button
              variant="ghost-muted"
              disabled={!currentKey()}
              onClick={locate}
            >
              {ctx.t("locate")}
            </ui.Button>
          </div>
          <Show when={data.failed()}>
            <div class="ps-warning" role="status">
              <ui.Icon name="circle-exclamation" />
              <span>
                {ctx.t(allGroups().length ? "unavailable" : "failed")}
              </span>
              <ui.Button variant="ghost-muted" onClick={data.refresh}>
                {ctx.t("retry")}
              </ui.Button>
            </div>
          </Show>
          <Show
            when={
              error() &&
              !groups().some(
                (group) =>
                  expanded(group.key) &&
                  visible(group).some((entry) => entry.key === error()!.key),
              )
            }
          >
            <div class="ps-error" role="alert">
              {error()?.message}
            </div>
          </Show>
        </div>
        <div
          ref={list}
          class="ps-list"
          data-scrollable
          aria-busy={data.loading()}
          onScroll={rememberScroll}
        >
          <Show
            when={allGroups().length || !data.loading()}
            fallback={
              <div
                class="ps-skeleton"
                role="status"
                aria-label={ctx.t("loading")}
              >
                <For each={[0, 1, 2, 3]}>
                  {() => (
                    <div>
                      <span />
                      <span />
                    </div>
                  )}
                </For>
              </div>
            }
          >
            <For each={groups().map((group) => group.key)}>
              {(key) => {
                const group = () => byKey().get(key)!;
                return (
                  <section class="ps-group" aria-label={group().name}>
                    <button
                      type="button"
                      class="ps-row ps-project"
                      disabled={searching()}
                      data-nav={`project:${key}`}
                      data-kind="project"
                      data-group={key}
                      tabIndex={
                        focused() === `project:${key}` ||
                        (!focused() && key === groups()[0]?.key)
                          ? 0
                          : -1
                      }
                      aria-expanded={expanded(key)}
                      onClick={() => toggle(key)}
                    >
                      <ui.Icon
                        name={
                          expanded(key) ? "chevron-down" : "chevron-right"
                        }
                      />
                      <ui.Icon name="folder" />
                      <span class="ps-copy">
                        <span class="ps-title">{group().name}</span>
                        <span class="ps-description" dir="auto">
                          {group().directory}
                        </span>
                      </span>
                      <Show when={ctx.servers.list().length > 1}>
                        <span class="ps-server">
                          {ctx.servers.get(group().server)?.name ??
                            group().server}
                        </span>
                      </Show>
                      <span class="ps-count">{group().entries.length}</span>
                    </button>
                    <Show when={expanded(key)}>
                      <div class="ps-sessions">
                        <For each={visible(group()).map((entry) => entry.key)}>
                          {(entryKey) => {
                            const entry = () =>
                              group().entries.find(
                                (item) => item.key === entryKey,
                              )!;
                            return (
                              <div class="ps-entry">
                                <button
                                  type="button"
                                  class="ps-row ps-session"
                                  data-current={
                                    entryKey === currentKey() || undefined
                                  }
                                  data-nav={entryKey}
                                  data-kind="session"
                                  data-group={key}
                                  data-session-key={entryKey}
                                  tabIndex={focused() === entryKey ? 0 : -1}
                                  aria-current={
                                    entryKey === currentKey()
                                      ? "page"
                                      : undefined
                                  }
                                  aria-busy={opening() === entryKey}
                                  onClick={() => void open(entry())}
                                >
                                  <span class="ps-copy">
                                    <span class="ps-title" dir="auto">
                                      {entry().session.title ||
                                        ctx.t("untitled")}
                                    </span>
                                    <Show when={metadata(entry(), group())}>
                                      {(value) => (
                                        <span class="ps-description" dir="auto">
                                          {value()}
                                        </span>
                                      )}
                                    </Show>
                                  </span>
                                  <span class="ps-meta">
                                    <Show when={opening() === entryKey}>
                                      <ui.Loader size="small" />
                                    </Show>
                                    <span class="ps-labels">
                                      <Show when={entryKey === currentKey()}>
                                        <span class="ps-current">
                                          {ctx.t("current")}
                                        </span>
                                      </Show>
                                      <Show when={status(entry())}>
                                        {(value) => (
                                          <span
                                            class="ps-status"
                                            data-status={value()}
                                          >
                                            <span class="ps-dot" />
                                            {ctx.t(value())}
                                          </span>
                                        )}
                                      </Show>
                                    </span>
                                    <time
                                      dateTime={new Date(
                                        entry().session.time.updated,
                                      ).toISOString()}
                                    >
                                      {age(entry().session.time.updated)}
                                    </time>
                                  </span>
                                </button>
                                <Show when={error()?.key === entryKey}>
                                  <div
                                    class="ps-error ps-row-error"
                                    role="alert"
                                  >
                                    {error()?.message}
                                  </div>
                                </Show>
                              </div>
                            );
                          }}
                        </For>
                        <Show
                          when={
                            visible(group()).length < group().entries.length
                          }
                        >
                          <button
                            type="button"
                            class="ps-row ps-more"
                            data-nav={`more:${key}`}
                            data-kind="more"
                            data-group={key}
                            tabIndex={focused() === `more:${key}` ? 0 : -1}
                            onClick={() =>
                              prefs.update((draft) => {
                                draft.limits[key] =
                                  (draft.limits[key] ?? 8) + 8;
                              })
                            }
                          >
                            {ctx.t("more", {
                              count:
                                group().entries.length -
                                visible(group()).length,
                            })}
                          </button>
                        </Show>
                      </div>
                    </Show>
                  </section>
                );
              }}
            </For>
            <Show when={!groups().length && !data.loading()}>
              <div class="ps-empty" role="status">
                <ui.Icon
                  name={searching() ? "magnifying-glass" : "folder"}
                  size="large"
                />
                <span>{ctx.t(searching() ? "noResults" : "empty")}</span>
                <Show when={!searching()}>
                  <span class="ps-description">
                    {ctx.t("emptyDescription")}
                  </span>
                </Show>
                <Show when={searching()}>
                  <ui.Button
                    variant="ghost-muted"
                    onClick={() => changeQuery("")}
                  >
                    {ctx.t("clear")}
                  </ui.Button>
                </Show>
              </div>
            </Show>
            <Show when={data.loading()}>
              <div class="ps-loading" role="status">
                <ui.Loader size="small" />
                {ctx.t("loading")}
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </ui.Dialog>
  );
}
