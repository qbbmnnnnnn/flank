export type NoteScope = "active" | "archived" | "deleted";
export type NoteColor = "lemon" | "peach" | "rose" | "lilac" | "sky" | "mint";
export type TextDirection = "automatic" | "ltr" | "rtl";

export interface NoteRecord {
  id: string;
  title: string;
  body: string;
  color: NoteColor;
  createdAtMs: number;
  updatedAtMs: number;
  archivedAtMs: number | null;
  deletedAtMs: number | null;
  sortKey: string;
  textDirection: TextDirection;
  revision: number;
}

export interface ListNotesQuery {
  scope: NoteScope;
  query: string;
}

export interface CreateNoteInput {
  title: string;
  body: string;
  color: NoteColor;
  textDirection: TextDirection;
}

export interface UpdateNoteInput extends CreateNoteInput {
  id: string;
  expectedRevision: number;
}

export interface NoteMutationInput {
  id: string;
  expectedRevision: number;
}
