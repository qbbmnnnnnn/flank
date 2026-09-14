<script setup lang="ts" generic="T extends string | number">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";

const props = defineProps<{
  modelValue: T;
  options: readonly { value: T; label: string }[];
  ariaLabel?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: T] }>();

const root = ref<HTMLElement | null>(null);
/** Position of the sliding highlight, kept in sync with the selected button. */
const marker = ref({ left: 0, width: 0 });
const measured = ref(false);
let observer: ResizeObserver | undefined;

async function measure() {
  await nextTick();
  const selected = root.value?.querySelector<HTMLElement>("button.selected");
  if (!selected || !root.value) return;
  marker.value = { left: selected.offsetLeft - root.value.clientLeft, width: selected.offsetWidth };
}

watch(() => props.modelValue, () => void measure());

onMounted(async () => {
  await measure();
  // Only enable the transition once the marker sits on the right segment.
  requestAnimationFrame(() => { measured.value = true; });
  if (!root.value || typeof ResizeObserver === "undefined") return;
  // Text width follows the app font and language, so re-measure whenever geometry changes.
  observer = new ResizeObserver(() => void measure());
  observer.observe(root.value);
  root.value.querySelectorAll("button").forEach((button) => observer?.observe(button));
});

onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div ref="root" class="segmented" role="group" :aria-label="ariaLabel">
    <span class="segmented-marker" :class="{ measured }" :style="{ left: `${marker.left}px`, width: `${marker.width}px` }" aria-hidden="true"></span>
    <button v-for="option in options" :key="option.value" type="button" :class="{ selected: option.value === modelValue }" :aria-pressed="option.value === modelValue" @click="emit('update:modelValue', option.value)">{{ option.label }}</button>
  </div>
</template>
