import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

import type {
  CreateNoteInput,
  ListNotesQuery,
  NoteMutationInput,
  NoteRecord,
  UpdateNoteInput,
} from "../contracts/note";

async function mutate<T>(command: string, input: unknown): Promise<T> {
  const result = await invoke<T>(command, { input });
  await emit("notes:changed", { command });
  return result;
}

export const noteService = {
  list: (query: ListNotesQuery) => invoke<NoteRecord[]>("list_notes", { query }),
  create: (input: CreateNoteInput) => mutate<NoteRecord>("create_note", input),
  update: (input: UpdateNoteInput) => mutate<NoteRecord>("update_note", input),
  archive: (input: NoteMutationInput) => mutate<NoteRecord>("archive_note", input),
  unarchive: (input: NoteMutationInput) => mutate<NoteRecord>("unarchive_note", input),
  delete: (input: NoteMutationInput) => mutate<NoteRecord>("delete_note", input),
  restoreDeleted: (input: NoteMutationInput) => mutate<NoteRecord>("restore_deleted_note", input),
  permanentlyDelete: (input: NoteMutationInput) => mutate<void>("permanently_delete_note", input),
};
