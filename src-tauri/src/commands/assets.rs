use std::path::PathBuf;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::{
    app::AppState,
    domain::{asset::AssetRecord, error::AppError},
};

const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;

fn image_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(("png", "image/png"));
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Some(("jpg", "image/jpeg"));
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(("gif", "image/gif"));
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(("webp", "image/webp"));
    }
    if bytes.starts_with(b"BM") {
        return Some(("bmp", "image/bmp"));
    }
    None
}

#[tauri::command]
pub async fn import_image(
    path: String,
    state: State<'_, AppState>,
) -> Result<AssetRecord, AppError> {
    let source = PathBuf::from(path);
    let metadata = std::fs::metadata(&source)
        .map_err(|error| AppError::validation(format!("无法读取所选图片: {error}")))?;
    if !metadata.is_file() || metadata.len() > MAX_IMAGE_BYTES {
        return Err(AppError::validation("图片必须是小于 25 MB 的普通文件"));
    }
    let bytes = std::fs::read(&source)
        .map_err(|error| AppError::internal(format!("读取图片失败: {error}")))?;
    let (extension, mime_type) = image_type(&bytes).ok_or_else(|| {
        AppError::validation("文件内容不是受支持的 PNG、JPEG、GIF、WebP 或 BMP 图片")
    })?;
    let content_hash = format!("{:x}", Sha256::digest(&bytes));
    let relative_path = format!("assets/images/{content_hash}.{extension}");
    let destination = state.app_data_dir.join(&relative_path);
    if !destination.exists() {
        let parent = destination
            .parent()
            .expect("asset destination has a parent");
        std::fs::create_dir_all(parent)
            .map_err(|error| AppError::internal(format!("创建附件目录失败: {error}")))?;
        let temporary = parent.join(format!(".{content_hash}.tmp"));
        std::fs::write(&temporary, &bytes)
            .map_err(|error| AppError::internal(format!("写入附件失败: {error}")))?;
        std::fs::rename(&temporary, &destination)
            .map_err(|error| AppError::internal(format!("保存附件失败: {error}")))?;
    }
    let asset = AssetRecord {
        id: content_hash.clone(),
        content_hash,
        relative_path,
        original_name: source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("image")
            .to_owned(),
        mime_type: mime_type.to_owned(),
        byte_size: metadata.len() as i64,
        sync_state: "pending".to_owned(),
        created_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64,
    };
    state
        .database
        .save_attachment(&asset)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
pub fn open_external_url(url: String, app: AppHandle) -> Result<(), AppError> {
    let parsed = url::Url::parse(&url).map_err(|_| AppError::validation("链接地址无效"))?;
    if !matches!(parsed.scheme(), "https" | "http" | "mailto") {
        return Err(AppError::validation("不支持此链接协议"));
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|error| AppError::internal(format!("打开链接失败: {error}")))
}

#[tauri::command]
pub async fn resolve_asset_path(
    id: String,
    state: State<'_, AppState>,
) -> Result<String, AppError> {
    if id.len() != 64 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(AppError::validation("附件 ID 无效"));
    }
    let asset = state
        .database
        .attachment(&id)
        .await
        .map_err(AppError::from)?;
    let path = state.app_data_dir.join(asset.relative_path);
    if !path.is_file() {
        return Err(AppError::internal("附件文件不存在，可能尚未同步到此设备"));
    }
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::image_type;

    #[test]
    fn detects_image_content_instead_of_trusting_extensions() {
        assert_eq!(
            image_type(b"\x89PNG\r\n\x1a\nrest"),
            Some(("png", "image/png"))
        );
        assert_eq!(image_type(b"not really an image"), None);
    }
}
