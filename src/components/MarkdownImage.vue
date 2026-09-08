<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { assetId, resolveAssetSrc, safeExternalUrl } from '../services/assetService';

const props = defineProps<{ src: string; alt: string }>();
const resolved = ref('');
const failed = ref(false);

async function resolve() {
  resolved.value = '';
  failed.value = false;
  try {
    if (assetId(props.src)) resolved.value = await resolveAssetSrc(props.src);
    else {
      const external = safeExternalUrl(props.src);
      resolved.value = external?.startsWith('https:') || external?.startsWith('http:') ? external : '';
    }
    if (!resolved.value) failed.value = true;
  } catch {
    failed.value = true;
  }
}

onMounted(resolve);
watch(() => props.src, resolve);
</script>

<template>
  <figure class="markdown-image">
    <img v-if="resolved && !failed" :src="resolved" :alt="alt" @error="failed = true">
    <figcaption v-if="failed">{{ alt || '图片附件暂不可用' }}</figcaption>
  </figure>
</template>

<style scoped>
.markdown-image{margin:12px 0}.markdown-image img{display:block;max-width:100%;max-height:320px;border-radius:10px;object-fit:contain}.markdown-image figcaption{padding:14px;border:1px dashed currentColor;border-radius:9px;opacity:.6;text-align:center;font-size:.88em}
</style>
