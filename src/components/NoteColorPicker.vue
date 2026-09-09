<script setup lang="ts">
import { Check, ChevronDown } from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { NoteColorId, NoteColorOption } from '../contracts/note';
import { t } from '../services/i18n';
import { noteColorCss } from '../services/noteColorService';

const props = defineProps<{ modelValue: NoteColorId; colors: NoteColorOption[] }>();
const emit = defineEmits<{ 'update:modelValue': [color: NoteColorId] }>();
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const open = ref(false);
const gridHeight = computed(() => {
  const rows = Math.min(4, Math.max(1, Math.ceil(props.colors.length / 6)));
  return `${rows * 30 + (rows - 1) * 4}px`;
});

function optionButtons(): HTMLButtonElement[] {
  return [...(root.value?.querySelectorAll<HTMLButtonElement>('.note-color-option') ?? [])];
}

function close(restoreFocus = false) {
  open.value = false;
  if (restoreFocus) nextTick(() => trigger.value?.focus());
}

function toggle() {
  open.value = !open.value;
  if (open.value) nextTick(() => {
    const options = optionButtons();
    (options.find(option => option.dataset.color === props.modelValue) ?? options[0])?.focus();
  });
}

function select(color: NoteColorId) {
  emit('update:modelValue', color);
  close(true);
}

function onDocumentPointerDown(event: PointerEvent) {
  if (open.value && !root.value?.contains(event.target as Node)) close();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    close(true);
    return;
  }
  const options = optionButtons();
  const current = options.indexOf(document.activeElement as HTMLButtonElement);
  if (current < 0) return;
  let next = current;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % options.length;
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + options.length) % options.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = options.length - 1;
  else return;
  event.preventDefault();
  options[next]?.focus();
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown));
</script>

<template>
  <div ref="root" class="note-color-picker">
    <button ref="trigger" class="color-picker-trigger" type="button" :aria-label="t('更改便签颜色')" aria-haspopup="listbox" :aria-expanded="open" @click="toggle">
      <span class="current-color" :style="{ background: noteColorCss(modelValue) }"></span>
      <ChevronDown aria-hidden="true" />
    </button>
    <div v-if="open" class="color-popover">
      <div class="popover-heading"><span>{{ t('便签颜色') }}</span><small>{{ colors.length }}</small></div>
      <div class="note-color-grid" role="listbox" :aria-label="t('选择便签颜色')" :style="{ height: gridHeight }" @keydown="onKeydown">
        <button v-for="color in colors" :key="color.id" class="note-color-option" :class="{ selected: modelValue === color.id }" type="button" role="option" :aria-selected="modelValue === color.id" :aria-label="t('选择颜色 {color}', { color: color.name })" :data-color="color.id" @click="select(color.id)">
          <span class="color-swatch" :style="{ background: noteColorCss(color.id) }"></span>
          <span v-if="modelValue === color.id" class="selected-mark"><Check aria-hidden="true" /></span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.note-color-picker{position:relative;flex:0 0 auto}
.color-picker-trigger{height:32px;min-width:48px;padding:0 8px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--color-picker-border,var(--border,#d7e0ec));border-radius:10px;color:var(--color-picker-ink,var(--muted,#64748b));background:var(--color-picker-control,var(--surface-subtle,#f8fafc));cursor:pointer;transition:background .16s ease,border-color .16s ease}
.color-picker-trigger:hover,.color-picker-trigger[aria-expanded="true"]{border-color:var(--color-picker-border-active,#9eb2cb);background:var(--color-picker-control-hover,var(--accent-soft,#eef4fb))}
.current-color{width:18px;height:18px;flex:0 0 18px;border:2px solid rgba(255,255,255,.72);border-radius:50%;box-shadow:0 0 0 1px rgba(63,75,92,.28)}
.color-picker-trigger svg{width:14px;height:14px;stroke-width:2}
.color-popover{position:absolute;z-index:20;top:calc(100% + 8px);right:0;width:224px;box-sizing:border-box;padding:10px;border:1px solid var(--color-picker-popover-border,var(--border,#dce5f0));border-radius:14px;color:var(--color-picker-popover-ink,var(--text,#10213b));background:var(--color-picker-popover,var(--surface,#fff));box-shadow:0 16px 38px color-mix(in srgb,var(--text,#10213b) 22%,transparent);overflow:hidden}
.popover-heading{height:28px;padding:0 3px 7px;display:flex;align-items:center;justify-content:space-between;color:var(--color-picker-popover-ink,var(--text,#10213b));font-size:12px;font-weight:700}
.popover-heading small{min-width:22px;height:20px;padding:0 6px;display:grid;place-items:center;border-radius:10px;color:var(--color-picker-muted,var(--muted,#64748b));background:var(--color-picker-count-bg,var(--surface-subtle,#f8fafc));font-size:10px;font-weight:700}
.note-color-grid{width:100%;max-height:146px;box-sizing:border-box;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));grid-auto-rows:30px;align-content:start;gap:4px;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--color-picker-scrollbar,var(--border,#dce5f0)) transparent}
.note-color-grid::-webkit-scrollbar{width:5px}.note-color-grid::-webkit-scrollbar-thumb{border-radius:999px;background:var(--color-picker-scrollbar,var(--border,#dce5f0))}
.note-color-option{position:relative;width:100%;min-width:0;height:30px;min-height:0;margin:0;padding:4px;display:grid;grid-template-columns:1fr;place-items:center;border:0;border-radius:8px;background:transparent;cursor:pointer}
.note-color-option:hover,.note-color-option:focus-visible,.note-color-option.selected{outline:0;background:var(--color-picker-option-hover,var(--accent-soft,#edf3fa))}
.color-swatch{width:20px;height:20px;border:2px solid rgba(255,255,255,.72);border-radius:50%;box-shadow:0 0 0 1px rgba(63,75,92,.28);transition:transform .14s ease}
.note-color-option:hover .color-swatch{transform:scale(1.08)}
.note-color-option.selected .color-swatch{box-shadow:0 0 0 2px var(--color-picker-selected,var(--accent,#4e7fc9));transform:scale(.88)}
.selected-mark{position:absolute;right:1px;bottom:1px;width:12px;height:12px;display:grid;place-items:center;border:2px solid var(--color-picker-popover,var(--surface,#fff));border-radius:50%;color:#fff;background:var(--color-picker-selected,var(--accent,#4e7fc9));box-sizing:border-box}
.selected-mark svg{width:8px;height:8px;stroke-width:3}
</style>
