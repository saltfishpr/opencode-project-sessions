import { Command, Plugin, Style, TitlebarItem } from "@opencode/plugin/gui";
import { onCleanup } from "solid-js";
import { definition } from "./definition";
import { Navigator } from "./navigator";
import type { Snapshot } from "./model";
import css from "./styles.css?inline";

export default Plugin.define({
  ...definition,
  setup(ctx) {
    const cache = new Map<string, Snapshot>();
    let close: (() => void) | undefined;
    const open = () => {
      if (close) return;
      const dialog = ctx.dialogs.open((dialog) => {
        onCleanup(() => {
          close = undefined;
        });
        return <Navigator ctx={ctx} cache={cache} close={dialog.close} />;
      });
      close = dialog.close;
    };
    ctx.add(Style, css);
    ctx.add(
      Command,
      (): Command => ({
        id: "open",
        title: ctx.t("command"),
        keywords: "projects sessions navigator 项目 会话 导航",
        section: "navigation",
        run: open,
      }),
    );
    ctx.add(
      TitlebarItem,
      (): TitlebarItem => ({
        id: "open",
        label: ctx.t("title"),
        icon: "folder",
        run: open,
      }),
    );
  },
});
