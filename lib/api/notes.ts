import type { OrgRole } from "../domain-enums";
import { daysSince } from "./pipeline";

export type NoteRow = {
  id: string;
  applicationId: string;
  authorId: string | null;
  authorName: string;
  authorRole: string;
  text: string;
  createdAt: Date;
  editedAt: Date | null;
  parentId: string | null;
  pinned: boolean;
};

type FeedExtras = { application: { fullName: string; positionId: string; createdAt: Date; position: { title: string } } };

/**
 * Every note payload carries `parentId` (null for a top-level note) and `pinned`. The dashboard treats the presence of
 * those keys as "this server stores replies / pins", so they are always sent, never omitted.
 */
export function serializeNote(n: NoteRow) {
  return {
    id: n.id,
    applicationId: n.applicationId,
    authorId: n.authorId,
    authorName: n.authorName,
    authorRole: n.authorRole,
    text: n.text,
    createdAt: n.createdAt,
    editedAt: n.editedAt,
    parentId: n.parentId ?? null,
    pinned: !!n.pinned,
  };
}

/** The org-wide feed adds who/what each note is about, so the feed can group by candidate. */
export function serializeFeedNote(n: NoteRow & FeedExtras) {
  return {
    ...serializeNote(n),
    candidateName: n.application.fullName,
    positionId: n.application.positionId,
    positionTitle: n.application.position.title,
    // whole days since the candidate applied (the feed card says "Applied 3 days ago")
    appliedDaysAgo: daysSince(n.application.createdAt),
  };
}

/** Anyone who can write notes can pin one. Viewers read only. */
export function canPinNotes(role: OrgRole | string): boolean {
  return role !== "VIEWER";
}

/** Editing text: the author only. Deleting: the author, or an Owner / Admin. */
export function canEditNoteText(note: { authorId: string | null }, userId: string): boolean {
  return note.authorId === userId;
}
export function canDeleteNote(note: { authorId: string | null }, userId: string, role: OrgRole | string): boolean {
  return note.authorId === userId || role === "OWNER" || role === "ADMIN";
}
