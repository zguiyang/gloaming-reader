import { AUTH_USER_ROLE, isAdminRole } from '@gloaming/shared/auth';

/** Minimal identity for Work read authorization — no HTTP or session types. */
export type WorkReadActor = {
  userId: string | null;
  role: string;
};

export function anonymousWorkReadActor(): WorkReadActor {
  return { userId: null, role: AUTH_USER_ROLE };
}

export function workReadActorFromIdentity(identity: { id: string; role?: string | null } | null): WorkReadActor {
  if (!identity) {
    return anonymousWorkReadActor();
  }
  return { userId: identity.id, role: identity.role ?? AUTH_USER_ROLE };
}

export function isWorkReadAdmin(actor: WorkReadActor): boolean {
  return actor.userId !== null && isAdminRole(actor.role);
}
