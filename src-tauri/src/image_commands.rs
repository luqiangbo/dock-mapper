use crate::AppState;
use tauri::State;

#[tauri::command]
pub fn upload_image(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("图片上传必须使用原始二进制请求".into());
    };
    state.images.insert(bytes.clone())
}

#[tauri::command]
pub fn release_image(state: State<'_, AppState>, image_id: String) {
    state.images.remove(&image_id);
}
