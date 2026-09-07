export type NoteScope = "active" | "archived" | "deleted";
export type NoteColor = "lemon" | "peach" | "rose" | "lilac" | "sky" | "mint";
/** Built-in paper or a user color added from the settings color pool. */
export type NoteColorId = NoteColor | (string & {});
export type TextDirection = "automatic" | "ltr" | "rtl";

/** One swatch of the note color pool. User colors carry their own hex `value`. */
export interface NoteColorOption {
  id: string;
  name: string;
  value?: string;
}

export const CUSTOM_NOTE_COLOR_PREFIX = "custom-";
export const MAX_CUSTOM_NOTE_COLORS = 12;

export interface NoteRecord {
  id: string;
  title: string;
  body: string;
  color: NoteColorId;
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
  color: NoteColorId;
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
