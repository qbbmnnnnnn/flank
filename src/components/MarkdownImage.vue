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
.markdown-image{margin:var(--markdown-image-margin,12px auto);max-width:100%;text-align:center}.markdown-image img{display:block;width:auto;height:auto;max-width:100%;max-height:var(--markdown-image-max-height,320px);margin:0 auto;border-radius:10px;object-fit:contain}.markdown-image figcaption{padding:14px;border:1px dashed currentColor;border-radius:9px;opacity:.6;text-align:center;font-size:.88em}
</style>
