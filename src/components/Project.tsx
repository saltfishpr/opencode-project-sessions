import { For, Show, type JSX } from "solid-js";
import type { NavigatorContext } from "../definition";
import type { Entry, ProjectGroup } from "../model";

export function Project(props: {
  ctx: NavigatorContext;
  group: ProjectGroup;
  visible: Entry[];
  removed: boolean;
  expanded: boolean;
  focused: string;
  first: boolean;
  serverName?: string;
  creating: boolean;
  removing: boolean;
  actionsDisabled: boolean;
  createDisabled: boolean;
  onToggle(): void;
  onCreate(): void;
  onRemove(): void;
  onRestore(): void;
  onMore(): void;
  renderSession(entry: () => Entry, key: string): JSX.Element;
}) {
  const { ui } = props.ctx;
  const key = props.group.key;
  const total = () => props.group.entries.length;
  const remaining = () => total() - props.visible.length;

  return (
    <section class="ps-group" aria-label={props.group.name}>
      <div
        class="ps-project-row"
        data-changing={props.creating || props.removing || undefined}
      >
        <button
          type="button"
          class="ps-row ps-project"
          data-nav={`project:${key}`}
          data-kind="project"
          data-group={key}
          tabIndex={
            props.focused === `project:${key}` || (!props.focused && props.first)
              ? 0
              : -1
          }
          aria-expanded={total() ? props.expanded : undefined}
          onClick={() => {
            if (total()) props.onToggle();
          }}
        >
          <ui.Icon
            class={total() ? undefined : "ps-no-sessions"}
            name={props.expanded ? "chevron-down" : "chevron-right"}
          />
          <ui.Icon name="folder" />
          <span class="ps-copy">
            <span class="ps-title">{props.group.name}</span>
            <span class="ps-description" dir="auto">
              {props.group.directory}
            </span>
          </span>
          <span class="ps-project-meta">
            <Show when={props.serverName !== undefined}>
              <span class="ps-server">{props.serverName}</span>
            </Show>
            <Show when={total()}>
              <span class="ps-count">{total()}</span>
            </Show>
          </span>
        </button>
        <div class="ps-project-actions">
          <Show
            when={props.removed}
            fallback={
              <>
                <ui.IconButton
                  icon="new-session"
                  label={props.ctx.t("create")}
                  variant="ghost-muted"
                  busy={props.creating}
                  disabled={props.createDisabled}
                  onClick={() => props.onCreate()}
                />
                <ui.IconButton
                  icon="trash"
                  label={props.ctx.t("removeProject")}
                  variant="ghost-muted"
                  busy={props.removing}
                  disabled={props.actionsDisabled}
                  onClick={() => props.onRemove()}
                />
              </>
            }
          >
            <ui.IconButton
              icon="arrow-undo-down"
              label={props.ctx.t("restore")}
              variant="ghost-muted"
              disabled={props.actionsDisabled}
              onClick={() => props.onRestore()}
            />
          </Show>
        </div>
      </div>
      <Show when={total() && props.expanded}>
        <div class="ps-sessions">
          <For each={props.visible.map((entry) => entry.key)}>
            {(entryKey) =>
              props.renderSession(
                () => props.group.entries.find((entry) => entry.key === entryKey)!,
                entryKey,
              )
            }
          </For>
          <Show when={remaining() > 0}>
            <button
              type="button"
              class="ps-row ps-more"
              data-nav={`more:${key}`}
              data-kind="more"
              data-group={key}
              tabIndex={props.focused === `more:${key}` ? 0 : -1}
              onClick={() => props.onMore()}
            >
              {props.ctx.t("more", { count: remaining() })}
            </button>
          </Show>
        </div>
      </Show>
    </section>
  );
}
