import { createCurrentHostResolutionRepository } from "../database/repositories/factory.js";
import { resolveHostById } from "../hosts/host-resolver.js";
import { createCurrentProjectCredentialRepository } from "./factory.js";

export interface ProjectHostCredentialInitialization {
  projectId: string;
  projectHostId: number;
  hostId: number;
  createdBy: string;
}

function isProjectCredentialAuthType(
  authType: string,
): authType is "password" | "key" | "none" {
  return authType === "password" || authType === "key" || authType === "none";
}

/**
 * Mirrors one host's effective SSH credential into the CloudSSH project vault.
 * Termix 2.9's host resolver already applies shared auth, plugin auth settings,
 * external-secret references and username expansion, so this compatibility
 * layer consumes the resolved host instead of duplicating pre-2.9 logic.
 */
export async function initializeProjectHostCredential(
  input: ProjectHostCredentialInitialization,
): Promise<void> {
  const credentials = await createCurrentProjectCredentialRepository();
  const reference = await credentials.findProjectHostReference(
    input.projectHostId,
  );
  if (
    !reference ||
    reference.projectId !== input.projectId ||
    reference.hostId !== input.hostId
  ) {
    throw new Error("Project host reference does not match the requested host");
  }

  const assigned = await credentials.resolveForProjectHost(input.projectHostId);
  if (assigned) {
    if (
      assigned.projectId !== input.projectId ||
      assigned.hostId !== input.hostId
    ) {
      throw new Error("Project credential belongs to another host");
    }
    if (!assigned.managed) return;
  }

  const repository = createCurrentHostResolutionRepository();
  const ownerId = await repository.findHostOwnerId(input.hostId);
  if (!ownerId) throw new Error("Host owner could not be resolved");

  const resolved = await resolveHostById(input.hostId, ownerId);
  if (!resolved) throw new Error("Host credentials are locked");

  const host = resolved as unknown as Record<string, unknown>;
  const authType = String(host.authType ?? "none");
  if (!isProjectCredentialAuthType(authType)) {
    if (assigned?.managed) {
      await credentials.removeManagedForProjectHost(
        input.projectId,
        input.projectHostId,
      );
    }
    throw new Error(`Unsupported project SSH authentication type: ${authType}`);
  }

  await credentials.ensureForProjectHost({
    projectId: input.projectId,
    projectHostId: input.projectHostId,
    hostName: String(host.name || host.ip || input.hostId),
    username: String(host.username || ""),
    authType,
    keyType: typeof host.keyType === "string" ? host.keyType : null,
    secret: {
      password: typeof host.password === "string" ? host.password : undefined,
      privateKey: typeof host.key === "string" ? host.key : undefined,
      passphrase:
        typeof host.keyPassword === "string" ? host.keyPassword : undefined,
      certificate:
        typeof host.certPublicKey === "string" ? host.certPublicKey : undefined,
    },
    createdBy: input.createdBy,
  });
}
