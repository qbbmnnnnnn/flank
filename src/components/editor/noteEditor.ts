import { EditorSelection, Prec, type EditorState, type Extension } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { defaultKeymap, history, historyKeymap, insertNewlineAndIndent, isolateHistory } from '@codemirror/commands';
import { markdown, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown';
import { Decoration, EditorView, ViewPlugin, WidgetType, drawSelection, keymap, placeholder, type DecorationSet, type ViewUpdate } from '@codemirror/view';

export type MarkdownFormat = 'heading' | 'bold' | 'italic' | 'list' | 'code';
export type EditorLabels = { placeholder: string; ariaLabel: string; taskLabel: (checked: boolean) => string };

/** Preserve legacy Unicode tasks as well as standard Markdown task syntax. */
export function taskPrefix(text: string) {
  const match = /^([ \t]*)(?:(☐|☑)[ \t]?|([-*+])[ \t]+\[([ xX])\][ \t]?)/.exec(text);
  if (!match) return null;
  return { length: match[0].length, indent: match[1], checked: match[2] === '☑' || /x/i.test(match[4] ?? ''),
    next: match[2] ? `${match[1]}☐ ` : `${match[1]}${match[3]} [ ] `, unicode: Boolean(match[2]) };
}

function isCode(state: EditorState, position: number) {
  for (let node = syntaxTree(state).resolveInner(position, 1); node; node = node.parent!) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true;
  }
  return false;
}

export function focusStart(view: EditorView) {
  const task = taskPrefix(view.state.doc.line(1).text);
  view.dispatch({ selection: { anchor: task?.length ?? 0 }, scrollIntoView: true });
  view.focus();
}

export function continueTask(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) return false;
  const line = state.doc.lineAt(selection.head);
  const task = taskPrefix(line.text);
  if (isCode(state, line.from) || !task || selection.head < line.from + task.length) return false;
  if (!line.text.slice(task.length).trim()) {
    view.dispatch({ changes: { from: line.from, to: line.to, insert: task.indent },
      selection: { anchor: line.from + task.indent.length }, userEvent: 'input', scrollIntoView: true });
  } else {
    const insert = `\n${task.next}`;
    view.dispatch({ changes: { from: selection.head, insert }, selection: { anchor: selection.head + insert.length },
      userEvent: 'input', scrollIntoView: true });
  }
  return true;
}

export function removeTaskPrefix(view: EditorView): boolean {
  const { state } = view;
  const selection = state.selection.main;
  if (!selection.empty) return false;
  const line = state.doc.lineAt(selection.head);
  const task = taskPrefix(line.text);
  if (isCode(state, line.from) || !task || selection.head !== line.from + task.length) return false;
  view.dispatch({ changes: { from: line.from + task.indent.length, to: line.from + task.length },
    selection: { anchor: line.from + task.indent.length }, userEvent: 'delete.backward', scrollIntoView: true });
  return true;
}

export function toggleTask(view: EditorView, position: number) {
  const line = view.state.doc.lineAt(position);
  const task = taskPrefix(line.text);
  if (!task) return;
  const prefix = line.text.slice(0, task.length);
  const insert = task.unicode ? prefix.replace(/[☐☑]/, task.checked ? '☐' : '☑')
    : prefix.replace(/\[[ xX]\]/, task.checked ? '[ ]' : '[x]');
  const current = view.state.selection.main;
  const sameLine = view.state.doc.lineAt(current.head).number === line.number;
  const anchor = sameLine ? Math.max(line.from + task.length, current.head) : line.to;
  view.dispatch({ changes: { from: line.from, to: line.from + task.length, insert },
    selection: { anchor }, userEvent: 'input.task', annotations: isolateHistory.of('full'), scrollIntoView: true });
  view.focus();
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly label: string) { super(); }
  eq(other: TaskWidget) { return this.checked === other.checked && this.label === other.label; }
  toDOM(view: EditorView) {
    // Include the text gap inside the widget box. An external button margin is not
    // part of the rectangle CodeMirror uses for an empty task's caret coordinates.
    const marker = document.createElement('span');
    marker.className = 'editor-task-marker';
    marker.setAttribute('contenteditable', 'false');
    const box = document.createElement('button');
    box.type = 'button';
    box.className = `editor-task-box${this.checked ? ' is-checked' : ''}`;
    box.setAttribute('contenteditable', 'false');
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    box.setAttribute('aria-label', this.label);
    box.addEventListener('mousedown', event => event.preventDefault());
    box.addEventListener('click', event => {
      event.preventDefault();
      // Resolve the widget's current document position, never capture a stale line number.
      toggleTask(view, view.posAtDOM(box));
    });
    marker.appendChild(box);
    return marker;
  }
  ignoreEvent() { return true; }
}

function taskWidgets(label: EditorLabels['taskLabel']) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) this.decorations = this.build(update.view);
    }
    build(view: EditorView) {
      const decorations = [];
      const visited = new Set<number>();
      for (const { from, to } of view.visibleRanges) {
        let line = view.state.doc.lineAt(from);
        while (line.from <= to) {
          const task = taskPrefix(line.text);
          if (task && !visited.has(line.number) && !isCode(view.state, line.from + task.indent.length)) {
            decorations.push(Decoration.replace({ widget: new TaskWidget(task.checked, label(task.checked)) })
              .range(line.from + task.indent.length, line.from + task.length));
          }
          visited.add(line.number);
          if (line.number === view.state.doc.lines) break;
          line = view.state.doc.line(line.number + 1);
        }
      }
      return Decoration.set(decorations, true);
    }
  }, {
    decorations: plugin => plugin.decorations,
    // Cursor movement and deletion treat the checkbox marker as one indivisible unit.
    provide: plugin => EditorView.atomicRanges.of(view => view.plugin(plugin)?.decorations ?? Decoration.none),
  });
}

export function localizedEditorExtensions(labels: EditorLabels): Extension {
  return [placeholder(labels.placeholder), EditorView.contentAttributes.of({
    'aria-label': labels.ariaLabel, 'aria-multiline': 'true', spellcheck: 'true',
  }), taskWidgets(labels.taskLabel)];
}

export function noteEditorExtensions(onChange: (body: string) => void): Extension {
  return [
    history(), drawSelection(), EditorView.lineWrapping,
    markdown({ addKeymap: false }),
    syntaxHighlighting(HighlightStyle.define([
      { tag: tags.heading1, fontSize: '1.55em', fontWeight: '800', color: 'var(--editor-heading,currentColor)' },
      { tag: tags.heading2, fontSize: '1.35em', fontWeight: '800', color: 'var(--editor-heading,currentColor)' },
      { tag: tags.heading3, fontSize: '1.18em', fontWeight: '750', color: 'var(--editor-heading,currentColor)' },
      { tag: tags.strong, fontWeight: '800', color: 'var(--editor-strong,currentColor)' },
      { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--editor-emphasis,currentColor)' },
      { tag: tags.link, color: 'var(--editor-link,#315f9f)', textDecoration: 'underline' },
      { tag: tags.url, color: 'var(--editor-link,#315f9f)', textDecoration: 'underline' },
    ])),
    Prec.high(keymap.of([
      { key: 'Enter', run: continueTask },
      { key: 'Enter', run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
      { key: 'Enter', run: insertNewlineAndIndent },
      { key: 'Shift-Enter', run: insertNewlineAndIndent },
      { key: 'Backspace', run: removeTaskPrefix },
    ])),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.updateListener.of(update => {
      if (update.docChanged) onChange(update.state.doc.toString());
    }),
  ];
}

export function insertTask(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const existing = taskPrefix(line.text);
  if (existing) {
    view.dispatch({ selection: { anchor: line.from + existing.length }, scrollIntoView: true });
  } else {
    // Convert the current line, without moving its existing text into a different task.
    view.dispatch({ changes: { from: line.from, insert: '☐ ' },
      selection: { anchor: view.state.selection.main.head + 2 }, userEvent: 'input.task',
      annotations: isolateHistory.of('full'), scrollIntoView: true });
  }
  view.focus();
}

export function insertLink(view: EditorView) {
  const selection = view.state.selection.main;
  const label = view.state.sliceDoc(selection.from, selection.to) || '链接文字';
  const url = 'https://';
  const insert = `[${label}](${url})`;
  const urlFrom = selection.from + label.length + 3;
  view.dispatch({ changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.range(urlFrom, urlFrom + url.length), userEvent: 'input.format',
    annotations: isolateHistory.of('full'), scrollIntoView: true });
  view.focus();
}

export function insertImage(view: EditorView, uri: string, fallbackAlt: string) {
  const selection = view.state.selection.main;
  const alt = view.state.sliceDoc(selection.from, selection.to) || fallbackAlt;
  const line = view.state.doc.lineAt(selection.from);
  const before = line.text.slice(0, Math.max(0, selection.from - line.from)).trim();
  const after = line.text.slice(Math.max(0, selection.to - line.from)).trim();
  // 图片独占一行，主窗口与便签栏才能按块级图片渲染。
  const insert = `${before ? "\n" : ""}![${alt}](${uri})${after ? "\n" : ""}`;
  view.dispatch({ changes: { from: selection.from, to: selection.to, insert },
    selection: { anchor: selection.from + insert.length }, userEvent: 'input.format',
    annotations: isolateHistory.of('full'), scrollIntoView: true });
  view.focus();
}

export function applyMarkdown(view: EditorView, format: MarkdownFormat) {
  const { state } = view;
  const selection = state.selection.main;
  if (format === 'heading' || format === 'list') {
    const line = state.doc.lineAt(selection.head);
    const task = taskPrefix(line.text);
    const from = line.from + (task?.length ?? 0);
    const text = line.text.slice(task?.length ?? 0);
    const match = text.match(format === 'heading' ? /^#{1,6}\s+/ : /^[-*+]\s+/);
    const insert = match ? '' : format === 'heading' ? '## ' : '- ';
    view.dispatch({ changes: { from, to: from + (match?.[0].length ?? 0), insert },
      userEvent: 'input.format', annotations: isolateHistory.of('full'), scrollIntoView: true });
  } else {
    const mark = { bold: '**', italic: '*', code: '`' }[format];
    const selected = state.sliceDoc(selection.from, selection.to);
    view.dispatch({ changes: { from: selection.from, to: selection.to, insert: mark + selected + mark },
      selection: EditorSelection.range(selection.from + mark.length, selection.to + mark.length),
      userEvent: 'input.format', annotations: isolateHistory.of('full'), scrollIntoView: true });
  }
  view.focus();
}
