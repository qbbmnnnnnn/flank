// @vitest-environment jsdom
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import NoteEditor from './NoteEditor.vue';
import DockPanelView from '../features/dock/DockPanelView.vue';
import MarkdownEditor from './MarkdownEditor.vue';

const bridge = vi.hoisted(() => ({ handlers: new Map<string, (payload: unknown) => Promise<void>>(), emit: vi.fn() }));
vi.mock('../features/dock/bridge', async importOriginal => ({
  ...await importOriginal<object>(), isTauriRuntime: () => false, emitToDock: bridge.emit,
  listenOnWebview: async (event: string, handler: (payload: unknown) => Promise<void>) => {
    bridge.handlers.set(event, handler); return () => bridge.handlers.delete(event);
  },
}));
vi.mock('../services/settingsService', async () => {
  const { ref } = await import('vue');
  return { savedSettings: ref({ language: 'zh-CN', noteColors: [] }) };
});
vi.mock('../services/noteColorService', () => ({ noteColorPool: () => [], pickRandomNoteColor: () => 'lemon', noteColorCss: () => '#fff', notePaperStyle: () => ({}) }));
vi.mock('../services/i18n', () => ({ t: (text: string) => text }));

let wrapper: VueWrapper;
let view: EditorView;
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  // jsdom does not lay out text; geometry is covered by the real-browser suite.
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  bridge.emit.mockClear();
});
afterEach(() => { wrapper?.unmount(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

for (const entry of ['library', 'dock'] as const) describe(`${entry}: shared Markdown editor`, () => {
  async function setup(body = '') {
    if (entry === 'library') wrapper = mount(NoteEditor, { attachTo: document.body, props: { note: null } });
    else {
      wrapper = mount(DockPanelView, { attachTo: document.body });
      await flushPromises();
      bridge.handlers.get('dock-panel:open')!({ isNew: true, anchorSide: 'right' });
      await flushPromises();
    }
    expect(wrapper.findComponent(MarkdownEditor).exists()).toBe(true);
    view = EditorView.findFromDOM(wrapper.find('.cm-editor').element as HTMLElement)!;
    if (body) view.dispatch({ changes: { from: 0, insert: body }, selection: { anchor: body.length } });
    await flushPromises();
  }
  async function key(key: string, extra = {}) { await wrapper.find('.cm-content').trigger('keydown', { key, ...extra }); }
  function text(value: string) { view.dispatch(view.state.replaceSelection(value)); }
  it('uses a document-driven placeholder, not an is-empty pseudo element', async () => {
    await setup(); expect(wrapper.find('.cm-placeholder').exists()).toBe(true);
    text('中文'); await flushPromises(); expect(wrapper.find('.cm-placeholder').exists()).toBe(false);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length } }); await flushPromises();
    expect(wrapper.find('.cm-placeholder').exists()).toBe(true);
  });
  it('supports repeated empty and non-empty newlines', async () => {
    await setup(); text('a'); await key('Enter'); text('b'); await key('Enter'); await key('Enter'); text('c');
    expect(view.state.doc.toString()).toBe('a\nb\n\nc');
    expect(view.state.selection.main.head).toBe(6);
  });
  it('places the caret after an empty task marker and keeps Enter usable', async () => {
    await setup(); await wrapper.find('.format-bar button').trigger('click');
    expect(view.state.doc.toString()).toBe('☐ '); expect(view.state.selection.main.head).toBe(2);
    expect(wrapper.find('.editor-task-box').attributes('contenteditable')).toBe('false');
    expect(wrapper.find('.cm-placeholder').exists()).toBe(false);
    text('task'); await key('Enter'); expect(view.state.doc.toString()).toBe('☐ task\n☐ ');
    await key('Enter'); expect(view.state.doc.toString()).toBe('☐ task\n');
  });
  it('continues standard Markdown tasks without changing their storage format', async () => {
    await setup('- [x] done'); await key('Enter'); expect(view.state.doc.toString()).toBe('- [x] done\n- [ ] ');
    await key('Enter'); expect(view.state.doc.toString()).toBe('- [x] done\n');
  });
  it('toggles the clicked task and moves selection to its text', async () => {
    await setup('☐ task\nother');
    await wrapper.find('.editor-task-box').trigger('click');
    expect(view.state.doc.toString()).toBe('☑ task\nother'); expect(view.state.selection.main.head).toBe(6);
    text('!'); expect(view.state.doc.toString()).toBe('☑ task!\nother');
    undo(view); undo(view); expect(view.state.doc.toString()).toBe('☐ task\nother');
  });
  it('replaces a cross-line range on Enter or multiline insertion', async () => {
    await setup('abcd\nefgh'); view.dispatch({ selection: { anchor: 2, head: 7 } }); await key('Enter');
    expect(view.state.doc.toString()).toBe('ab\ngh');
    view.dispatch({ selection: { anchor: 1, head: 4 } }); text('X\nY');
    expect(view.state.doc.toString()).toBe('aX\nYh');
  });
  it('formats model selections and preserves native undo/redo', async () => {
    await setup('abcd'); view.dispatch({ selection: { anchor: 1, head: 3 } });
    await wrapper.findAll('.format-bar button')[2].trigger('click');
    expect(view.state.doc.toString()).toBe('a**bc**d');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('bc');
    undo(view); expect(view.state.doc.toString()).toBe('abcd');
    redo(view); expect(view.state.doc.toString()).toBe('a**bc**d');
  });
  it('retains blank lines and caret during parent rerenders', async () => {
    await setup('\ntext\n\n'); view.dispatch({ selection: { anchor: 3 } });
    await wrapper.find('.editor-title').setValue('Updated');
    expect(view.state.doc.toString()).toBe('\ntext\n\n'); expect(view.state.selection.main.head).toBe(3);
  });
});
