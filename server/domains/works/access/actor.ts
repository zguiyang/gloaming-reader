import { AUTH_USER_ROLE } from '@/shared/auth';

/** Minimal identity for Work read authorization — no HTTP or session types. */
export type WorkReadActor = {
  userId: string;
  role: string;
};

export function workReadActorFromIdentity(identity: { id: string; role?: string | null }): WorkReadActor {
  return { userId: identity.id, role: identity.role ?? AUTH_USER_ROLE };
}
