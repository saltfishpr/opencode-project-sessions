import { For, Show } from "solid-js";
import type { NavigatorContext } from "../definition";

export type SessionAction = "archive" | "delete";

export function Session(props: {
  ctx: NavigatorContext;
  entryKey: string;
  projectKey: string;
  title?: string;
  description?: string;
  current: boolean;
  tabbable: boolean;
  opening: boolean;
  changing?: SessionAction;
  actionsDisabled: boolean;
  status?: "approval" | "input" | "working";
  activityTime: number;
  formatAge(timestamp: number): string;
  error?: string;
  onOpen(): void;
  onChange(action: SessionAction): void;
}) {
  const { ui } = props.ctx;
  return (
    <div class="ps-entry">
      <div class="ps-session-row" data-changing={!!props.changing || undefined}>
        <button
          type="button"
          class="ps-row ps-session"
          data-current={props.current || undefined}
          data-nav={props.entryKey}
          data-kind="session"
          data-group={props.projectKey}
          data-session-key={props.entryKey}
          tabIndex={props.tabbable ? 0 : -1}
          aria-current={props.current ? "page" : undefined}
          aria-busy={props.opening}
          onClick={() => props.onOpen()}
        >
          <span class="ps-copy">
            <span class="ps-title" dir="auto">
              {props.title || props.ctx.t("untitled")}
            </span>
            <Show when={props.description}>
              {(value) => (
                <span class="ps-description" dir="auto">
                  {value()}
                </span>
              )}
            </Show>
          </span>
          <span class="ps-meta">
            <Show when={props.opening}>
              <ui.Loader size="small" />
            </Show>
            <span class="ps-labels">
              <Show when={props.status}>
                {(value) => (
                  <span class="ps-status" data-status={value()}>
                    <span class="ps-dot" />
                    {props.ctx.t(value())}
                  </span>
                )}
              </Show>
            </span>
            <time dateTime={new Date(props.activityTime).toISOString()}>
              {props.formatAge(props.activityTime)}
            </time>
          </span>
        </button>
        <div class="ps-session-actions">
          <For each={["archive", "delete"] as const}>
            {(action) => (
              <ui.IconButton
                icon={action === "archive" ? "archive" : "trash"}
                label={props.ctx.t(action)}
                variant="ghost-muted"
                busy={props.changing === action}
                disabled={props.actionsDisabled}
                onClick={() => props.onChange(action)}
              />
            )}
          </For>
        </div>
      </div>
      <Show when={props.error}>
        <div class="ps-error ps-row-error" role="alert">
          {props.error}
        </div>
      </Show>
    </div>
  );
}
