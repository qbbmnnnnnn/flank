import Sortable, { type SortableEvent } from "sortablejs";

export const NOTE_DRAG_DELAY_MS = 240;

export function moveItem<T>(items: T[], oldIndex: number, newIndex: number): T[] {
  if (oldIndex === newIndex || oldIndex < 0 || newIndex < 0 || oldIndex >= items.length || newIndex >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, moved);
  return next;
}

export interface NoteSortableOptions {
  draggable: string;
  disabled?: boolean;
  /** Descendants that must keep exclusive pointer ownership. */
  filter?: string;
  onStart?: () => void;
  onEnd?: (oldIndex: number, newIndex: number) => void;
  onCancel?: () => void;
}

/**
 * SortableJS setup shared by the library and the Dock. A short primary-button
 * hold intentionally separates reordering from the existing click/hover/menu
 * interactions on each note.
 */
export function createNoteSortable(element: HTMLElement, options: NoteSortableOptions): Sortable {
  return Sortable.create(element, {
    draggable: options.draggable,
    disabled: options.disabled,
    delay: NOTE_DRAG_DELAY_MS,
    delayOnTouchOnly: false,
    touchStartThreshold: 4,
    fallbackTolerance: 4,
    forceFallback: true,
    fallbackOnBody: false,
    animation: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 230,
    easing: "cubic-bezier(.22,1,.36,1)",
    filter: options.filter ?? "button,a,input,textarea,select,[contenteditable='true']",
    preventOnFilter: false,
    ghostClass: "note-sort-ghost",
    chosenClass: "note-sort-chosen",
    dragClass: "note-sort-drag",
    onStart: options.onStart,
    onEnd(event: SortableEvent) {
      if (event.oldIndex === undefined || event.newIndex === undefined) {
        options.onCancel?.();
        return;
      }
      if (event.oldIndex !== event.newIndex) options.onEnd?.(event.oldIndex, event.newIndex);
      else options.onCancel?.();
    },
  });
}
