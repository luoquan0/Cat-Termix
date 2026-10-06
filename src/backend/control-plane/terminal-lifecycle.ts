import { getServiceImplementation } from "../plugins/service-registry.js";
import { createCloudSshSqliteContext } from "./sqlite-context.js";
import { ControlPlaneManagementError } from "./management-repository.js";

export interface TerminalSessionFilter {
  hostId?: number;
  hostIds?: readonly number[];
  projectHostId?: number;
  projectHostIds?: readonly number[];
  userId?: string;
  userIds?: readonly string[];
  pinned?: boolean;
}

export interface TerminalLifecycleScope {
  hostIds?: readonly number[];
  projectHostIds?: readonly number[];
  userIds?: readonly string[];
}

export interface TerminalLifecycleCoordinator {
  runDestructiveOperation<T>(
    scope: TerminalLifecycleScope,
    operation: () => T | Promise<T>,
  ): Promise<T>;
  retire(scope: TerminalLifecycleScope): void;
}

interface LiveSessionInfo {
  id: string;
  userId: string;
  hostId: number;
  tmuxSessionName: string | null;
}

interface LiveSessionsCoreService {
  listAll(): LiveSessionInfo[];
  runDestructiveOperation<T>(
    scope: { hostIds?: readonly number[]; userIds?: readonly string[] },
    operation: () => T | Promise<T>,
  ): Promise<T>;
  retire(scope: {
    hostIds?: readonly number[];
    userIds?: readonly string[];
  }): void;
}

function liveSessions(): LiveSessionsCoreService {
  const service = getServiceImplementation<LiveSessionsCoreService>(
    "sessions.live",
    "1.0.0",
    "ssh",
  );
  if (!service) {
    throw new ControlPlaneManagementError(
      503,
      "SSH terminal lifecycle service is unavailable",
    );
  }
  return service;
}

function positiveIds(values: readonly number[] | undefined): number[] {
  return [
    ...new Set(
      (values ?? []).filter(
        (value) => Number.isSafeInteger(value) && value > 0,
      ),
    ),
  ];
}

function hostIdsForProjectHosts(projectHostIds: readonly number[]): number[] {
  const ids = positiveIds(projectHostIds);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = createCloudSshSqliteContext()
    .sqlite.prepare(
      `SELECT DISTINCT host_id AS hostId
         FROM project_hosts
        WHERE id IN (${placeholders})`,
    )
    .all(...ids) as Array<{ hostId: number }>;
  return rows.map((row) => row.hostId);
}

function lifecycleHostIds(scope: TerminalLifecycleScope): number[] {
  return [
    ...new Set([
      ...positiveIds(scope.hostIds),
      ...hostIdsForProjectHosts(scope.projectHostIds ?? []),
    ]),
  ];
}

export function findTerminalSessions(
  filter: TerminalSessionFilter,
): readonly LiveSessionInfo[] {
  const hostIds = new Set(
    lifecycleHostIds({
      hostIds: [
        ...(filter.hostId ? [filter.hostId] : []),
        ...(filter.hostIds ?? []),
      ],
      projectHostIds: [
        ...(filter.projectHostId ? [filter.projectHostId] : []),
        ...(filter.projectHostIds ?? []),
      ],
    }),
  );
  const userIds = new Set([
    ...(filter.userId ? [filter.userId] : []),
    ...(filter.userIds ?? []),
  ]);

  return liveSessions()
    .listAll()
    .filter((session) => hostIds.size === 0 || hostIds.has(session.hostId))
    .filter((session) => userIds.size === 0 || userIds.has(session.userId))
    .filter((_session) => {
      // Termix 2.9 no longer exposes CloudSSH's old "pinned" flag. For an
      // access-revocation check, treating every matching live session as
      // protected is the safe/conservative equivalent.
      return filter.pinned !== false;
    });
}

export const terminalLifecycleCoordinator: TerminalLifecycleCoordinator = {
  async runDestructiveOperation(scope, operation) {
    return liveSessions().runDestructiveOperation(
      {
        hostIds: lifecycleHostIds(scope),
        userIds: scope.userIds,
      },
      operation,
    );
  },

  retire(scope) {
    // A project-host association can be retired while the underlying host is
    // still valid in another project. Only explicit host retirement is
    // permanent in the 2.9 terminal service.
    const hostIds = positiveIds(scope.hostIds);
    if (hostIds.length === 0) return;
    liveSessions().retire({ hostIds, userIds: scope.userIds });
  },
};
