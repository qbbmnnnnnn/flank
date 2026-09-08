import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';

export const ASSET_URI_PREFIX = 'flank-asset://';

export interface AssetRecord {
  id: string;
  contentHash: string;
  relativePath: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  syncState: 'local' | 'pending' | 'synced';
  createdAtMs: number;
}

export function assetId(uri: string): string | null {
  if (!uri.startsWith(ASSET_URI_PREFIX)) return null;
  const id = uri.slice(ASSET_URI_PREFIX.length);
  return /^[a-f\d]{64}$/i.test(id) ? id.toLowerCase() : null;
}

export async function pickAndImportImage(): Promise<AssetRecord | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({ multiple: false, directory: false, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] });
  if (!path) return null;
  return invoke<AssetRecord>('import_image', { path });
}

export async function resolveAssetSrc(uri: string): Promise<string> {
  const id = assetId(uri);
  if (!id || !isTauri()) return '';
  const path = await invoke<string>('resolve_asset_path', { id });
  return convertFileSrc(path);
}

export function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export async function openExternalUrl(value: string): Promise<boolean> {
  const url = safeExternalUrl(value);
  if (!url) return false;
  if (isTauri()) {
    await invoke('open_external_url', { url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return true;
}
