import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js";
import { createStore } from "solid-js/store";
import type { SessionInfo } from "@opencode/client";
import type { NavigatorContext } from "./definition";
import type { Snapshot } from "./model";

export function createNavigatorData(
  ctx: NavigatorContext,
  cache: Map<string, Snapshot>,
) {
  const [state, setState] = createStore<{
    snapshots: Record<string, Snapshot>;
    loading: Record<string, boolean>;
    errors: Record<string, boolean>;
  }>({ snapshots: Object.fromEntries(cache), loading: {}, errors: {} });
  const [revision, setRevision] = createSignal(0);

  createEffect(() => {
    revision();
    const servers = ctx.servers.list().flatMap((id) => {
      const server = ctx.servers.get(id);
      return server
        ? [
            {
              id,
              client: server.client,
              data: server.data,
              connected: server.connected,
              compatible: server.compatible,
            },
          ]
        : [];
    });
    const controller = new AbortController();
    const signal = controller.signal;
    onCleanup(() => controller.abort());

    untrack(() => {
      const listed = new Set(servers.map((server) => server.id));
      for (const id of Object.keys(state.snapshots)) {
        if (!listed.has(id)) {
          setState("snapshots", (snapshots) => {
            const next = { ...snapshots };
            delete next[id];
            return next;
          });
          cache.delete(id);
        }
      }

      for (const server of servers) {
        const publish = (
          sessions: SessionInfo[],
          projects = state.snapshots[server.id]?.projects ?? [],
        ) => {
          const snapshot = { sessions, projects };
          cache.set(server.id, snapshot);
          setState("snapshots", server.id, snapshot);
        };
        const update = (session: SessionInfo) => {
          const previous = state.snapshots[server.id]?.sessions ?? [];
          const index = previous.findIndex((item) => item.id === session.id);
          const next = [...previous];
          if (session.parentID || session.time.archived !== undefined) {
            if (index !== -1) next.splice(index, 1);
          } else if (index === -1) next.push(session);
          else next[index] = session;
          publish(next);
        };

        setState("errors", server.id, !server.connected || !server.compatible);
        setState("loading", server.id, server.connected && server.compatible);
        if (!server.connected || !server.compatible) continue;

        const changed = new Map<string, SessionInfo | null>();
        // Changes received during pagination win over older index pages.
        onCleanup(
          server.data.listen(({ details: event }) => {
            if (event.type === "session.deleted") {
              changed.set(event.data.sessionID, null);
              publish(
                (state.snapshots[server.id]?.sessions ?? []).filter(
                  (item) => item.id !== event.data.sessionID,
                ),
              );
              return;
            }
            if (
              ![
                "session.created",
                "session.renamed",
                "session.moved",
                "session.archived",
                "session.unarchived",
                "session.execution.started",
                "session.execution.succeeded",
                "session.execution.failed",
                "session.execution.interrupted",
              ].includes(event.type) ||
              !("sessionID" in event.data) ||
              typeof event.data.sessionID !== "string"
            )
              return;
            void server.client.session
              .get({ sessionID: event.data.sessionID }, { signal })
              .then((session) => {
                if (signal.aborted) return;
                changed.set(session.id, session);
                update(session);
              })
              .catch(() => {
                if (!signal.aborted) setState("errors", server.id, true);
              });
          }),
        );

        void (async () => {
          try {
            const previous = state.snapshots[server.id]?.sessions ?? [];
            const projects = await server.client.project.list(
              {},
              {
                signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
              },
            );
            const sessions = new Map<string, SessionInfo>();
            let cursor: string | undefined;
            do {
              const page = await server.client.session.list(
                {
                  parentID: null,
                  archived: false,
                  limit: 200,
                  order: "desc",
                  cursor,
                },
                {
                  signal: AbortSignal.any([
                    signal,
                    AbortSignal.timeout(15_000),
                  ]),
                },
              );
              if (signal.aborted) return;
              page.data.forEach((session) => sessions.set(session.id, session));
              cursor = page.cursor.next ?? undefined;
              // Keep cached older pages visible until a complete refresh can replace them.
              const visible = new Map(
                (cursor ? previous : []).map((session) => [
                  session.id,
                  session,
                ]),
              );
              sessions.forEach((session, id) => visible.set(id, session));
              for (const [id, session] of changed) {
                if (session) visible.set(id, session);
                else visible.delete(id);
              }
              publish([...visible.values()], projects);
            } while (cursor);
          } catch {
            if (!signal.aborted) setState("errors", server.id, true);
          } finally {
            if (!signal.aborted) setState("loading", server.id, false);
          }
        })();
      }
    });
  });

  const snapshots = createMemo(() =>
    Object.fromEntries(
      ctx.servers
        .list()
        .flatMap((id) =>
          state.snapshots[id] ? [[id, state.snapshots[id]]] : [],
        ),
    ),
  );
  return {
    snapshots,
    loading: () => ctx.servers.list().some((id) => state.loading[id]),
    failed: () => ctx.servers.list().some((id) => state.errors[id]),
    refresh: () => setRevision((value) => value + 1),
    update(server: string, session: SessionInfo) {
      const snapshot = state.snapshots[server];
      if (!snapshot) return;
      const sessions = snapshot.sessions.filter(
        (item) => item.id !== session.id,
      );
      if (!session.parentID && session.time.archived === undefined)
        sessions.push(session);
      const next = { ...snapshot, sessions };
      cache.set(server, next);
      setState("snapshots", server, next);
    },
  };
}
