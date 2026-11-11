import type { ProjectListOutput, SessionInfo } from "@opencode/client";

export type Snapshot = {
  sessions: SessionInfo[];
  projects: ProjectListOutput;
};

export type Entry = {
  key: string;
  server: string;
  session: SessionInfo;
};

export type ProjectGroup = {
  key: string;
  server: string;
  directory: string;
  name: string;
  entries: Entry[];
};

export function sessionActivityTime(session: SessionInfo) {
  return Math.max(
    session.time.busy ?? 0,
    session.time.idle ?? 0,
    session.time.created,
  );
}

export function pathKey(path: string) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function projectDirectory(
  session: SessionInfo,
  projects: ProjectListOutput,
) {
  const project = projects.find((item) => item.id === session.projectID);
  const directory = pathKey(session.location.directory);
  // The global project does not make unrelated non-Git directories one project.
  if (
    project &&
    project.id !== "global" &&
    pathKey(project.canonical) !== "/"
  ) {
    const belongs = [project.canonical, ...project.sandboxes].some((root) => {
      const key = pathKey(root);
      return directory === key || directory.startsWith(`${key}/`);
    });
    if (belongs) return project.canonical;
  }
  return session.location.directory;
}

export function groupSessions(snapshots: Record<string, Snapshot>) {
  const groups = new Map<string, ProjectGroup>();
  for (const [server, snapshot] of Object.entries(snapshots)) {
    for (const session of snapshot.sessions) {
      if (session.parentID || session.time.archived !== undefined) continue;
      const directory = projectDirectory(session, snapshot.projects);
      const key = `${server}\0${pathKey(directory)}`;
      let group = groups.get(key);
      if (!group) {
        const project = snapshot.projects.find(
          (item) => item.id === session.projectID,
        );
        group = {
          key,
          server,
          directory,
          name:
            (project?.id !== "global" && project?.name) ||
            pathKey(directory).split("/").at(-1) ||
            directory,
          entries: [],
        };
        groups.set(key, group);
      }
      group.entries.push({ key: `${server}\0${session.id}`, server, session });
    }
  }
  return [...groups.values()];
}
