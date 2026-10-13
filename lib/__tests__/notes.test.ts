import { describe, it, expect } from "vitest";
import { serializeNote, serializeFeedNote, canPinNotes, canEditNoteText, canDeleteNote, type NoteRow } from "../api/notes";
import { createNoteSchema, updateNoteSchema } from "../api/validation";

const now = new Date("2026-03-10T12:00:00Z");
const base: NoteRow = {
  id: "n1",
  applicationId: "app1",
  authorId: "u1",
  authorName: "Rita Cole",
  authorRole: "RECRUITER",
  text: "Strong systems background.",
  createdAt: new Date("2026-03-09T12:00:00Z"),
  editedAt: null,
  parentId: null,
  pinned: false,
};

describe("serializeNote", () => {
  it("always carries parentId and pinned, even for a plain note", () => {
    const out = serializeNote(base);
    expect(out).toHaveProperty("parentId", null);
    expect(out).toHaveProperty("pinned", false);
  });

  it("carries a reply's parent and a pinned flag through", () => {
    expect(serializeNote({ ...base, parentId: "n0", pinned: false }).parentId).toBe("n0");
    expect(serializeNote({ ...base, pinned: true }).pinned).toBe(true);
  });

  it("keeps a deleted author's note (authorId null) readable", () => {
    expect(serializeNote({ ...base, authorId: null }).authorId).toBeNull();
  });
});

describe("serializeFeedNote", () => {
  it("adds candidate / position context and how long ago the candidate applied", () => {
    const out = serializeFeedNote({
      ...base,
      application: { fullName: "Alice Nguyen", positionId: "pos1", createdAt: new Date(Date.now() - 3 * 86400000 - 5000), position: { title: "Senior Backend Engineer" } },
    });
    expect(out.candidateName).toBe("Alice Nguyen");
    expect(out.positionId).toBe("pos1");
    expect(out.positionTitle).toBe("Senior Backend Engineer");
    expect(out.appliedDaysAgo).toBe(3);
    expect(Number.isFinite(out.appliedDaysAgo)).toBe(true);
    expect(out.parentId).toBeNull();
    expect(out.pinned).toBe(false);
  });
});

describe("note permissions", () => {
  it("every role except VIEWER can pin", () => {
    expect(canPinNotes("OWNER")).toBe(true);
    expect(canPinNotes("ADMIN")).toBe(true);
    expect(canPinNotes("RECRUITER")).toBe(true);
    expect(canPinNotes("VIEWER")).toBe(false);
  });

  it("only the author can edit the text — not even an Owner", () => {
    expect(canEditNoteText({ authorId: "u1" }, "u1")).toBe(true);
    expect(canEditNoteText({ authorId: "u1" }, "owner")).toBe(false);
    expect(canEditNoteText({ authorId: null }, "u1")).toBe(false);
  });

  it("the author or an Owner / Admin can delete; other members and viewers cannot", () => {
    expect(canDeleteNote({ authorId: "u1" }, "u1", "RECRUITER")).toBe(true);
    expect(canDeleteNote({ authorId: "u1" }, "u2", "OWNER")).toBe(true);
    expect(canDeleteNote({ authorId: "u1" }, "u2", "ADMIN")).toBe(true);
    expect(canDeleteNote({ authorId: "u1" }, "u2", "RECRUITER")).toBe(false);
    expect(canDeleteNote({ authorId: "u1" }, "u2", "VIEWER")).toBe(false);
    expect(canDeleteNote({ authorId: null }, "u2", "RECRUITER")).toBe(false);
    expect(canDeleteNote({ authorId: null }, "u2", "ADMIN")).toBe(true);
  });
});

describe("createNoteSchema", () => {
  it("trims the text and rejects blank notes", () => {
    const ok = createNoteSchema.safeParse({ text: "  hello  " });
    expect(ok.success && ok.data.text).toBe("hello");
    expect(createNoteSchema.safeParse({ text: "   " }).success).toBe(false);
    expect(createNoteSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a parentId, null, or none", () => {
    expect(createNoteSchema.safeParse({ text: "x", parentId: "n0" }).success).toBe(true);
    expect(createNoteSchema.safeParse({ text: "x", parentId: null }).success).toBe(true);
    expect(createNoteSchema.safeParse({ text: "x" }).success).toBe(true);
    expect(createNoteSchema.safeParse({ text: "x", parentId: "" }).success).toBe(false);
  });
});

describe("updateNoteSchema", () => {
  it("accepts text, pinned, or both", () => {
    expect(updateNoteSchema.safeParse({ text: "edited" }).success).toBe(true);
    expect(updateNoteSchema.safeParse({ pinned: true }).success).toBe(true);
    expect(updateNoteSchema.safeParse({ pinned: false, text: "edited" }).success).toBe(true);
  });

  it("rejects an empty update and blank text", () => {
    const r = updateNoteSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toBe("Nothing to update");
    expect(updateNoteSchema.safeParse({ text: "  " }).success).toBe(false);
  });

  it("rejects a non-boolean pinned", () => {
    expect(updateNoteSchema.safeParse({ pinned: "yes" }).success).toBe(false);
  });
});
