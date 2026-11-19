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
  sessionActivityTime,
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
  const [searchExpanded, setSearchExpanded] = createSignal<Record<string, boolean>>({});
  const [scope, setScope] = createSignal<"all" | "current" | "removed">(
    prefs.value.scope,
  );
  const [focused, setFocused] = createSignal("");
  const [orderFrozen, setOrderFrozen] = createSignal(false);
  const [opening, setOpening] = createSignal<string>();
  const [changing, setChanging] = createSignal<{
    key: string;
    action: "archive" | "delete" | "remove";
  }>();
  const [navigating, setNavigating] = createSignal<Entry>();
  const [error, setError] = createSignal<{ key: string; message: string }>();
  const [now, setNow] = createSignal(Date.now());
  const controller = new AbortController();
  const timer = setInterval(() => setNow(Date.now()), 60_000);
  let routeTimer: ReturnType<typeof setTimeout> | undefined;
  let list!: HTMLDivElement;
  let restored = false;
  let browsing = false;

  onCleanup(() => {
    controller.abort();
    clearInterval(timer);
    clearTimeout(routeTimer);
  });

  const allGroups = createMemo(() => groupSessions(data.snapshots()));
  const removedKeys = createMemo(() =>
    Object.keys(ctx.stores.removedProjects.value).filter(
      (key) => ctx.stores.removedProjects.value[key],
    ),
  );
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
  const effectiveScope = () =>
    scope() === "current" && !currentProject() ? "all" : scope();
  const scrollKey = () =>
    effectiveScope() === "current" ? currentProject()! : "all";
  const terms = createMemo(() =>
    query()
      .trim()
      .toLocaleLowerCase(ctx.locale.locale())
      .split(/\s+/)
      .filter(Boolean),
  );
  const searching = () => terms().length > 0;

  const projectOrder = new Map<string, number>();
  const sessionOrder = new Map<string, number>();
  const ordered = createMemo(() => {
    const available = new Map(allGroups().map((group) => [group.key, group]));
    // Removed records must remain recoverable without a server or session cache.
    for (const key of removedKeys()) {
      if (available.has(key)) continue;
      const separator = key.indexOf("\0");
      const server = key.slice(0, separator);
      const directory = key.slice(separator + 1);
      const project = data.snapshots()[server]?.projects.find(
        (item) => pathKey(item.canonical) === directory,
      );
      available.set(key, {
        key,
        server,
        directory,
        name: project?.name || directory.split("/").at(-1) || directory,
        entries: [],
      });
    }
    const groups = [...available.values()]
      .map((group) => ({
        ...group,
        entries: [...group.entries].sort(
          (a, b) => sessionActivityTime(b.session) - sessionActivityTime(a.session),
        ),
      }))
      .sort(
        (a, b) =>
          (b.entries[0] ? sessionActivityTime(b.entries[0].session) : 0) -
          (a.entries[0] ? sessionActivityTime(a.entries[0].session) : 0),
      );
    if (!orderFrozen()) {
      projectOrder.clear();
      sessionOrder.clear();
    }
    for (const group of groups) {
      if (!projectOrder.has(group.key))
        projectOrder.set(group.key, projectOrder.size);
      for (const entry of group.entries) {
        if (!sessionOrder.has(entry.key))
          sessionOrder.set(entry.key, sessionOrder.size);
      }
      group.entries.sort(
        (a, b) =>
          Number(b.key === currentKey()) - Number(a.key === currentKey()) ||
          sessionOrder.get(a.key)! - sessionOrder.get(b.key)!,
      );
    }
    return groups.sort(
      (a, b) =>
        Number(b.key === currentProject()) -
          Number(a.key === currentProject()) ||
        projectOrder.get(a.key)! - projectOrder.get(b.key)!,
    );
  });
  const beginBrowsing = () => {
    ordered();
    browsing = true;
    setOrderFrozen(true);
  };
  createEffect(() => {
    if (orderFrozen() || data.loading()) return;
    // Capture the final initial order before freezing it for live updates.
    ordered();
    setOrderFrozen(true);
  });
  const groups = createMemo(() =>
    ordered().flatMap((group) => {
      if (
        !!ctx.stores.removedProjects.value[group.key] !==
        (effectiveScope() === "removed")
      )
        return [];
      if (effectiveScope() === "current" && group.key !== currentProject())
        return [];
      if (!searching()) return [group];
      const projectText = `${group.name} ${group.directory}`.toLocaleLowerCase(
        ctx.locale.locale(),
      );
      if (!group.entries.length)
        return terms().every((term) => projectText.includes(term)) ? [group] : [];
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
    searching()
      ? (searchExpanded()[key] ?? true)
      : (prefs.value.expanded[key] ?? key === currentProject());
  const visible = (group: ProjectGroup) => {
    if (searching()) return group.entries;
    return group.entries.slice(0, prefs.value.limits[group.key] ?? 8);
  };
  const toggle = (key: string, value = !expanded(key)) => {
    if (searching()) {
      setSearchExpanded((previous) => ({ ...previous, [key]: value }));
      return;
    }
    prefs.update((draft) => {
      draft.expanded[key] = value;
    });
  };
  const rememberScroll = () => {
    if (searching() || !restored || effectiveScope() === "removed") return;
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
    if (!browsing) {
      const key = currentProject();
      if (key) toggle(key, true);
    }
    groups();
    queueMicrotask(() => {
      if (controller.signal.aborted || restored) return;
      restored = true;
      if (browsing || searching()) return;
      const target = [
        ...list.querySelectorAll<HTMLButtonElement>("[data-session-key]"),
      ].find((item) => item.dataset.sessionKey === currentKey());
      if (target) {
        setFocused(target.dataset.nav!);
        target.scrollIntoView({ block: "nearest" });
      } else {
        list.scrollTop = prefs.value.scroll[scrollKey()] ?? 0;
      }
    });
  });

  const changeQuery = (value: string) => {
    beginBrowsing();
    rememberScroll();
    setQuery(value);
    setSearchExpanded({});
    queueMicrotask(() => {
      if (!controller.signal.aborted)
        list.scrollTop = searching() || effectiveScope() === "removed"
          ? 0
          : (prefs.value.scroll[scrollKey()] ?? 0);
    });
  };
  const changeScope = (value: "all" | "current" | "removed") => {
    beginBrowsing();
    rememberScroll();
    setScope(value);
    setSearchExpanded({});
    if (value !== "removed")
      prefs.update((draft) => {
        draft.scope = value;
      });
    list.scrollTop = 0;
  };
  createEffect(() => {
    if (scope() !== "removed" || removedKeys().length) return;
    changeScope("all");
    changeQuery("");
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

  const open = async (entry: Entry | ProjectGroup) => {
    if (opening() || changing()) return;
    setOpening(entry.key);
    setError(undefined);
    const creating = !("session" in entry);
    let failure = creating ? "createFailed" : "openFailed";
    try {
      const server = ctx.servers.get(entry.server);
      if (!server?.connected || !server.compatible)
        throw new Error("Server unavailable");
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(15_000),
      ]);
      const session = creating
        ? await server.client.session.create(
            { location: { directory: entry.directory } },
            { signal },
          )
        : await server.client.session.get(
            { sessionID: entry.session.id },
            { signal },
          );
      if (controller.signal.aborted) return;
      failure = "openFailed";
      data.update(entry.server, session);
      if (session.time.archived !== undefined) {
        setError({ key: entry.key, message: ctx.t("archived") });
        setOpening(undefined);
        return;
      }
      server.data.session.remember(session);
      ctx.tabs.open({ server: entry.server, id: session.id }, { focus: true });
      setNavigating({
        key: `${entry.server}\0${session.id}`,
        server: entry.server,
        session,
      });
      routeTimer = setTimeout(() => {
        if (controller.signal.aborted) return;
        setNavigating(undefined);
        setOpening(undefined);
        setError({ key: entry.key, message: ctx.t("openFailed") });
      }, 10_000);
    } catch {
      if (controller.signal.aborted) return;
      setOpening(undefined);
      setError({ key: entry.key, message: ctx.t(failure) });
    }
  };

  const changeSession = async (entry: Entry, action: "archive" | "delete") => {
    if (opening() || changing()) return;
    setChanging({ key: entry.key, action });
    setError(undefined);
    try {
      if (
        action === "delete" &&
        !(await ctx.dialogs.confirm({
          title: ctx.t("deleteTitle"),
          description: ctx.t("deleteDescription", {
            title: entry.session.title || ctx.t("untitled"),
          }),
          confirm: ctx.t("delete"),
          danger: true,
        }))
      )
        return;
      if (controller.signal.aborted) return;
      const server = ctx.servers.get(entry.server);
      if (!server?.connected || !server.compatible)
        throw new Error("Server unavailable");
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(15_000),
      ]);
      if (action === "archive") {
        await server.client.session.update(
          { sessionID: entry.session.id, archived: true },
          { signal },
        );
      } else {
        await server.client.session.remove(
          { sessionID: entry.session.id },
          { signal },
        );
      }
      if (!controller.signal.aborted)
        data.remove(entry.server, entry.session.id);
    } catch {
      if (!controller.signal.aborted)
        setError({
          key: entry.key,
          message: ctx.t(action === "archive" ? "archiveFailed" : "deleteFailed"),
        });
    } finally {
      if (!controller.signal.aborted) setChanging(undefined);
    }
  };

  const removeProject = async (group: ProjectGroup) => {
    if (opening() || changing()) return;
    setChanging({ key: group.key, action: "remove" });
    setError(undefined);
    try {
      if (
        !(await ctx.dialogs.confirm({
          title: ctx.t("removeProjectTitle"),
          confirm: ctx.t("remove"),
          cancel: ctx.t("cancel"),
          danger: true,
        })) ||
        controller.signal.aborted
      )
        return;
      ctx.stores.removedProjects.update((draft) => {
        draft[group.key] = true;
      });
    } catch {
      if (!controller.signal.aborted)
        setError({ key: group.key, message: ctx.t("removeProjectFailed") });
    } finally {
      if (!controller.signal.aborted) setChanging(undefined);
    }
  };

  const restoreProject = (group: ProjectGroup) => {
    if (opening() || changing()) return;
    setError(undefined);
    const index = groups().findIndex((item) => item.key === group.key);
    try {
      ctx.stores.removedProjects.update((draft) => {
        delete draft[group.key];
      });
      queueMicrotask(() => {
        if (controller.signal.aborted) return;
        const buttons = [
          ...list.querySelectorAll<HTMLButtonElement>("[data-kind='project']"),
        ];
        const next = buttons[Math.min(index, buttons.length - 1)];
        if (next) next.focus({ preventScroll: true });
        else list.parentElement?.querySelector<HTMLInputElement>("input")?.focus();
      });
    } catch {
      setError({ key: group.key, message: ctx.t("restoreProjectFailed") });
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    beginBrowsing();
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
        onPointerDown={beginBrowsing}
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
              <Show when={removedKeys().length}>
                <button
                  type="button"
                  class="ps-scope"
                  aria-pressed={effectiveScope() === "removed"}
                  onClick={() => changeScope("removed")}
                >
                  {ctx.t("removed")}
                </button>
              </Show>
            </div>
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
          onPointerMove={beginBrowsing}
          onFocusIn={beginBrowsing}
          onWheel={beginBrowsing}
          onScroll={rememberScroll}
        >
          <Show
            when={
              allGroups().length ||
              effectiveScope() === "removed" ||
              !data.loading()
            }
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
                    <div
                      class="ps-project-row"
                      data-removed={effectiveScope() === "removed" || undefined}
                      data-changing={
                        opening() === key || changing()?.key === key || undefined
                      }
                    >
                      <button
                        type="button"
                        class="ps-row ps-project"
                        data-nav={`project:${key}`}
                        data-kind="project"
                        data-group={key}
                        tabIndex={
                          focused() === `project:${key}` ||
                          (!focused() && key === groups()[0]?.key)
                            ? 0
                            : -1
                        }
                        aria-expanded={
                          group().entries.length ? expanded(key) : undefined
                        }
                        onClick={() => {
                          if (group().entries.length) toggle(key);
                        }}
                      >
                        <ui.Icon
                          class={
                            group().entries.length ? undefined : "ps-no-sessions"
                          }
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
                        <span class="ps-project-meta">
                          <Show
                            when={
                              ctx.servers.list().length > 1 ||
                              !ctx.servers.get(group().server)
                            }
                          >
                            <span class="ps-server">
                              {ctx.servers.get(group().server)?.name ??
                                group().server}
                            </span>
                          </Show>
                          <Show when={group().entries.length}>
                            <span class="ps-count">
                              {group().entries.length}
                            </span>
                          </Show>
                        </span>
                      </button>
                      <div class="ps-project-actions">
                        <Show
                          when={effectiveScope() === "removed"}
                          fallback={
                            <>
                              <ui.IconButton
                                icon="new-session"
                                label={ctx.t("create")}
                                variant="ghost-muted"
                                busy={opening() === key}
                                disabled={
                                  !!opening() ||
                                  !!changing() ||
                                  !ctx.servers.get(group().server)?.connected ||
                                  !ctx.servers.get(group().server)?.compatible
                                }
                                onClick={() => void open(group())}
                              />
                              <ui.IconButton
                                icon="trash"
                                label={ctx.t("removeProject")}
                                variant="ghost-muted"
                                busy={changing()?.key === key}
                                disabled={!!opening() || !!changing()}
                                onClick={() => void removeProject(group())}
                              />
                            </>
                          }
                        >
                          <ui.Button
                            variant="ghost-muted"
                            size="small"
                            disabled={!!opening() || !!changing()}
                            onClick={() => restoreProject(group())}
                          >
                            {ctx.t("restore")}
                          </ui.Button>
                        </Show>
                      </div>
                    </div>
                    <Show when={group().entries.length && expanded(key)}>
                      <div class="ps-sessions">
                        <For each={visible(group()).map((entry) => entry.key)}>
                          {(entryKey) => {
                            const entry = () =>
                              group().entries.find(
                                (item) => item.key === entryKey,
                              )!;
                            return (
                              <div class="ps-entry">
                                <div
                                  class="ps-session-row"
                                  data-changing={
                                    changing()?.key === entryKey || undefined
                                  }
                                >
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
                                          sessionActivityTime(entry().session),
                                        ).toISOString()}
                                      >
                                        {age(sessionActivityTime(entry().session))}
                                      </time>
                                    </span>
                                  </button>
                                  <div class="ps-session-actions">
                                    <For each={["archive", "delete"] as const}>
                                      {(action) => (
                                        <ui.IconButton
                                          icon={
                                            action === "archive"
                                              ? "archive"
                                              : "trash"
                                          }
                                          label={ctx.t(action)}
                                          variant="ghost-muted"
                                          busy={
                                            changing()?.key === entryKey &&
                                            changing()?.action === action
                                          }
                                          disabled={
                                            !!opening() ||
                                            !!changing() ||
                                            !ctx.servers.get(entry().server)
                                              ?.connected ||
                                            !ctx.servers.get(entry().server)
                                              ?.compatible
                                          }
                                          onClick={() =>
                                            void changeSession(entry(), action)
                                          }
                                        />
                                      )}
                                    </For>
                                  </div>
                                </div>
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
