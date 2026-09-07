<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { t } from '../services/i18n';
import { savedSettings } from '../services/settingsService';
import { applyMarkdown, focusStart, insertTask, localizedEditorExtensions, noteEditorExtensions, type MarkdownFormat } from './editor/noteEditor';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [body: string] }>();
const host = ref<HTMLElement | null>(null);
const language = new Compartment();
let view: EditorView | undefined;
const labels = () => localizedEditorExtensions({ placeholder: t('随便写点什么。。。'),
  ariaLabel: t('便签内容，支持 Markdown'), taskLabel: checked => t(checked ? '标记为未完成' : '标记为完成') });
const state = (doc: string) => EditorState.create({ doc,
  extensions: [noteEditorExtensions(body => emit('update:modelValue', body)), language.of(labels())] });

onMounted(() => { view = new EditorView({ state: state(props.modelValue), parent: host.value! }); });
watch(() => props.modelValue, body => {
  // Parent echoes from auto-save must never replace the active DOM/selection or IME session.
  if (view && body !== view.state.doc.toString()) view.setState(state(body));
});
watch(() => savedSettings.value.language, () => {
  view?.dispatch({ effects: language.reconfigure(labels()) });
});
onBeforeUnmount(() => { view?.destroy(); view = undefined; });

defineExpose({
  focusStart: () => { if (view) focusStart(view); },
  requestMeasure: () => view?.requestMeasure(),
  insertTask: () => { if (view) insertTask(view); },
  format: (format: MarkdownFormat) => { if (view) applyMarkdown(view, format); },
});
</script>

<template>
  <div ref="host" class="markdown-editor"></div>
</template>

<style scoped>
.markdown-editor{min-width:0;min-height:0;height:100%;user-select:text;-webkit-user-select:text}
.markdown-editor :deep(.cm-editor){height:100%;color:inherit;background:transparent;font-family:inherit;font-size:inherit;line-height:inherit}
.markdown-editor :deep(.cm-editor.cm-focused){outline:none}
.markdown-editor :deep(.cm-scroller){overflow:auto;font-family:inherit;line-height:inherit;scrollbar-width:thin;scrollbar-color:var(--editor-scrollbar,#cbd8e9) transparent}
.markdown-editor :deep(.cm-content){min-height:100%;padding:var(--editor-padding-top,6px) 0 20px;caret-color:currentColor;user-select:text;-webkit-user-select:text}
.markdown-editor :deep(.cm-line){padding:0 var(--editor-padding-x,24px);overflow-wrap:anywhere}
.markdown-editor :deep(.cm-placeholder){color:var(--editor-placeholder,#a8b6c9);font:inherit;pointer-events:none}
.markdown-editor :deep(.cm-cursor){border-left-color:currentColor;border-left-width:1.5px}
.markdown-editor :deep(.cm-selectionBackground){background:rgba(79,126,203,.22)}
.markdown-editor :deep(.cm-focused .cm-selectionBackground){background:rgba(79,126,203,.3)}
.markdown-editor :deep(.editor-task-marker){display:inline-block;box-sizing:border-box;width:28px;height:19px;padding-right:9px;vertical-align:-3px;line-height:19px;user-select:none;-webkit-user-select:none}
.markdown-editor :deep(.editor-task-box){display:inline-block;box-sizing:border-box;width:19px;height:19px;margin:0;padding:0;vertical-align:top;border:1.6px solid currentColor;border-radius:6px;color:inherit;background:transparent;cursor:pointer;font-family:system-ui,sans-serif;line-height:16px;user-select:none;-webkit-user-select:none}
.markdown-editor :deep(.editor-task-box.is-checked){border-color:#3d985c;background:#4cab69;color:#fff}
.markdown-editor :deep(.editor-task-box.is-checked::after){content:'✓';font-size:13px;font-weight:800}
.markdown-editor :deep(.editor-task-box:focus-visible){outline:2px solid currentColor;outline-offset:2px}
</style>
