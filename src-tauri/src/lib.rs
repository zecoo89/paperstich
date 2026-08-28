use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::Serialize;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const MAX_IMAGE_FILES: usize = 500;
const MAX_IMAGE_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
struct Display {
    connector: String,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    primary: bool,
}

#[derive(Debug, Clone, Serialize)]
struct DirectoryImage {
    path: String,
    name: String,
    #[serde(rename = "dataUrl")]
    data_url: String,
}

fn parse_geometry(value: &str) -> Result<(u32, u32, i32, i32), String> {
    let dimensions_end = value
        .find('x')
        .ok_or_else(|| format!("不正なモニター解像度: {value}"))?;
    let position = &value[dimensions_end + 1..];
    let first_sign = position
        .char_indices()
        .find(|(_, character)| *character == '+' || *character == '-')
        .map(|(index, _)| index)
        .ok_or_else(|| format!("モニター座標がありません: {value}"))?;
    let coordinates = &position[first_sign..];
    let second_sign = coordinates[1..]
        .char_indices()
        .find(|(_, character)| *character == '+' || *character == '-')
        .map(|(index, _)| index + 1)
        .ok_or_else(|| format!("モニターのY座標がありません: {value}"))?;
    let width = value[..dimensions_end]
        .parse::<u32>()
        .map_err(|_| format!("不正なモニター幅: {value}"))?;
    let height = position[..first_sign]
        .parse::<u32>()
        .map_err(|_| format!("不正なモニター高さ: {value}"))?;
    let x = coordinates[..second_sign]
        .parse::<i32>()
        .map_err(|_| format!("不正なモニターX座標: {value}"))?;
    let y = coordinates[second_sign..]
        .parse::<i32>()
        .map_err(|_| format!("不正なモニターY座標: {value}"))?;
    Ok((width, height, x, y))
}

fn parse_xrandr(output: &str) -> Result<Vec<Display>, String> {
    let mut displays = Vec::new();
    for line in output.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 3 || fields[1] != "connected" {
            continue;
        }
        let geometry = fields
            .iter()
            .skip(2)
            .find(|field| {
                field.contains('x')
                    && field
                        .chars()
                        .any(|character| character == '+' || character == '-')
            })
            .ok_or_else(|| format!("アクティブな解像度を解析できません: {line}"))?;
        let (width, height, x, y) = parse_geometry(geometry)?;
        displays.push(Display {
            connector: fields[0].to_string(),
            name: fields[0].to_string(),
            x,
            y,
            width,
            height,
            primary: fields.contains(&"primary"),
        });
    }
    displays.sort_by_key(|display| (display.x, display.y, display.connector.clone()));
    if displays.is_empty() {
        return Err("XRandRからアクティブなモニターを検出できませんでした".to_string());
    }
    Ok(displays)
}

#[tauri::command]
fn get_displays() -> Result<Vec<Display>, String> {
    let result = Command::new("xrandr")
        .arg("--query")
        .output()
        .map_err(|error| format!("xrandrを実行できません: {error}"))?;
    if !result.status.success() {
        return Err(format!(
            "xrandrが失敗しました: {}",
            String::from_utf8_lossy(&result.stderr).trim()
        ));
    }
    parse_xrandr(&String::from_utf8_lossy(&result.stdout))
}

fn image_mime(path: &Path) -> Option<&'static str> {
    let name = path.file_name()?.to_str()?.to_ascii_lowercase();
    if name.ends_with(".png") {
        Some("image/png")
    } else if name.ends_with(".jpg") || name.ends_with(".jpeg") || name.ends_with(".jpg_large") {
        Some("image/jpeg")
    } else if name.ends_with(".webp") {
        Some("image/webp")
    } else {
        None
    }
}

fn collect_image_paths(directory: &Path, paths: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(directory).map_err(|error| {
        format!(
            "画像ディレクトリを読み込めません: {} ({error})",
            directory.display()
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "画像ディレクトリの項目を読み込めません: {} ({error})",
                directory.display()
            )
        })?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            format!(
                "画像ディレクトリの項目種別を取得できません: {} ({error})",
                path.display()
            )
        })?;
        if file_type.is_dir() {
            collect_image_paths(&path, paths)?;
        } else if file_type.is_file() && image_mime(&path).is_some() {
            paths.push(path);
        }
    }
    Ok(())
}

#[tauri::command]
fn load_directory_images(directories: Vec<String>) -> Result<Vec<DirectoryImage>, String> {
    if directories.is_empty() {
        return Err("画像ディレクトリが1つも指定されていません".to_string());
    }

    let mut paths = Vec::new();
    for directory in directories {
        let path = PathBuf::from(&directory);
        if !path.is_dir() {
            return Err(format!(
                "画像ディレクトリが存在しないか、ディレクトリではありません: {directory}"
            ));
        }
        collect_image_paths(&path, &mut paths)?;
    }
    paths.sort();
    if paths.len() > MAX_IMAGE_FILES {
        return Err(format!(
            "画像ファイルが多すぎます: {}枚（上限: {}枚）",
            paths.len(), MAX_IMAGE_FILES
        ));
    }

    let mut seen = HashSet::new();
    let mut images = Vec::with_capacity(paths.len());
    for path in paths {
        let path = path.canonicalize().map_err(|error| {
            format!(
                "画像ファイルのパスを確定できません: {} ({error})",
                path.display()
            )
        })?;
        if !seen.insert(path.clone()) {
            continue;
        }
        let mime = image_mime(&path)
            .ok_or_else(|| format!("対応していない画像形式です: {}", path.display()))?;
        let file_size = fs::metadata(&path)
            .map_err(|error| format!("画像ファイルのサイズを取得できません: {} ({error})", path.display()))?
            .len();
        if file_size > MAX_IMAGE_BYTES {
            return Err(format!(
                "画像ファイルが大きすぎます: {} ({} bytes / 上限: {} bytes)",
                path.display(), file_size, MAX_IMAGE_BYTES
            ));
        }
        let bytes = fs::read(&path).map_err(|error| {
            format!("画像ファイルを読み込めません: {} ({error})", path.display())
        })?;
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| format!("画像ファイル名をUTF-8として扱えません: {}", path.display()))?;
        images.push(DirectoryImage {
            path: path.to_string_lossy().into_owned(),
            name: name.to_string(),
            data_url: format!("data:{mime};base64,{}", BASE64.encode(bytes)),
        });
    }
    Ok(images)
}

fn output_path() -> Result<PathBuf, String> {
    let root = env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))
        .ok_or_else(|| "XDG_CACHE_HOMEまたはHOMEが設定されていません".to_string())?;
    Ok(root.join("paperstich").join("merged.png"))
}

fn desktop_bounds(displays: &[Display]) -> (i32, i32, u32, u32) {
    let left = displays.iter().map(|display| display.x).min().unwrap_or(0);
    let top = displays.iter().map(|display| display.y).min().unwrap_or(0);
    let right = displays
        .iter()
        .map(|display| display.x + display.width as i32)
        .max()
        .unwrap_or(0);
    let bottom = displays
        .iter()
        .map(|display| display.y + display.height as i32)
        .max()
        .unwrap_or(0);
    (left, top, (right - left) as u32, (bottom - top) as u32)
}

fn png_dimensions(png: &[u8]) -> Result<(u32, u32), String> {
    if png.len() < 24 || png[..8] != [137, 80, 78, 71, 13, 10, 26, 10] || &png[12..16] != b"IHDR" {
        return Err("Canvasから有効なPNGを受け取れませんでした".to_string());
    }
    Ok((
        u32::from_be_bytes([png[16], png[17], png[18], png[19]]),
        u32::from_be_bytes([png[20], png[21], png[22], png[23]]),
    ))
}

fn file_uri(path: &Path) -> String {
    let mut value = String::from("file://");
    for byte in path.to_string_lossy().as_bytes() {
        let byte = *byte;
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/' | b'~') {
            value.push(byte as char);
        } else {
            value.push_str(&format!("%{byte:02X}"));
        }
    }
    value
}

fn gsettings(arguments: &[&str]) -> Result<std::process::Output, String> {
    Command::new("gsettings")
        .args(arguments)
        .output()
        .map_err(|error| format!("gsettingsを実行できません: {error}"))
}

fn apply_backend(path: &Path) -> Result<(), String> {
    let desktop = [
        "XDG_CURRENT_DESKTOP",
        "XDG_SESSION_DESKTOP",
        "DESKTOP_SESSION",
    ]
    .iter()
    .filter_map(|key| env::var(key).ok())
    .collect::<Vec<_>>()
    .join(":")
    .to_lowercase();
    let candidates = if desktop.contains("cinnamon") {
        vec![("org.cinnamon.desktop.background", "picture-uri", None, true)]
    } else if desktop.contains("gnome") || desktop.contains("ubuntu") || desktop.contains("budgie")
    {
        vec![(
            "org.gnome.desktop.background",
            "picture-uri",
            Some("picture-uri-dark"),
            true,
        )]
    } else if desktop.contains("mate") {
        vec![("org.mate.background", "picture-filename", None, false)]
    } else {
        return Err(format!(
            "未対応のデスクトップ環境です: {}。Cinnamon、GNOME、MATEに対応しています",
            if desktop.is_empty() { "不明" } else { &desktop }
        ));
    };
    let selected = candidates
        .into_iter()
        .find(|(schema, _, _, _)| {
            gsettings(&["list-schemas"])
                .map(|result| {
                    result.status.success()
                        && String::from_utf8_lossy(&result.stdout)
                            .lines()
                            .any(|line| line == *schema)
                })
                .unwrap_or(false)
        })
        .ok_or_else(|| {
            "対応する壁紙設定が見つかりません。Cinnamon、GNOME、MATEに対応しています".to_string()
        })?;
    let keys = gsettings(&["list-keys", selected.0]).map_err(|error| error.to_string())?;
    if !keys.status.success() {
        return Err(format!("設定キーを取得できません: {}", selected.0));
    }
    let key_lines = String::from_utf8_lossy(&keys.stdout);
    let value = if selected.3 {
        file_uri(path)
    } else {
        path.to_string_lossy().to_string()
    };
    let operations = [("picture-options", "spanned"), (selected.1, value.as_str())];
    for (key, setting) in operations {
        if !key_lines.lines().any(|line| line == key) {
            return Err(format!(
                "デスクトップ設定に必要な項目がありません: {} {key}",
                selected.0
            ));
        }
        let result = gsettings(&["set", selected.0, key, setting])?;
        if !result.status.success() {
            return Err(format!(
                "壁紙設定に失敗しました: {}",
                String::from_utf8_lossy(&result.stderr).trim()
            ));
        }
    }
    if let Some(dark_key) = selected.2 {
        if key_lines.lines().any(|line| line == dark_key) {
            let result = gsettings(&["set", selected.0, dark_key, value.as_str()])?;
            if !result.status.success() {
                return Err(format!(
                    "ダークモードの壁紙設定に失敗しました: {}",
                    String::from_utf8_lossy(&result.stderr).trim()
                ));
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn apply_wallpaper(png: Vec<u8>, width: u32, height: u32) -> Result<String, String> {
    let displays = get_displays()?;
    let (_, _, expected_width, expected_height) = desktop_bounds(&displays);
    if width != expected_width || height != expected_height {
        return Err(format!("Canvasのサイズがモニター配置と一致しません: {width}×{height} / 期待値 {expected_width}×{expected_height}"));
    }
    let (png_width, png_height) = png_dimensions(&png)?;
    if png_width != width || png_height != height {
        return Err(format!(
            "PNGのサイズが宣言値と一致しません: {png_width}×{png_height} / {width}×{height}"
        ));
    }
    let path = output_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| format!("出力先の親ディレクトリを取得できません: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("キャッシュディレクトリを作成できません: {error}"))?;
    let temporary = parent.join(".merged.png.tmp");
    fs::write(&temporary, png).map_err(|error| format!("合成画像を保存できません: {error}"))?;
    fs::rename(&temporary, &path).map_err(|error| format!("合成画像を確定できません: {error}"))?;
    apply_backend(&path)?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_displays,
            load_directory_images,
            apply_wallpaper
        ])
        .run(tauri::generate_context!())
        .expect("PaperStichの起動に失敗しました");
}

#[cfg(test)]
mod tests {
    use super::{image_mime, parse_xrandr};
    use std::path::Path;

    #[test]
    fn recognizes_supported_image_formats_case_insensitively() {
        assert_eq!(image_mime(Path::new("wallpaper.PNG")), Some("image/png"));
        assert_eq!(image_mime(Path::new("wallpaper.jpeg")), Some("image/jpeg"));
        assert_eq!(image_mime(Path::new("wallpaper.WEBP")), Some("image/webp"));
        assert_eq!(image_mime(Path::new("wallpaper.gif")), None);
    }

    #[test]
    fn parses_mixed_orientation_and_negative_coordinates() {
        let displays = parse_xrandr(
            "DVI-D-0 connected 1080x1920+0-300 (normal left inverted right x axis y axis)\n\
             HDMI-A-0 connected primary 2560x1440+1080+0 (normal left inverted right x axis y axis)",
        )
        .expect("XRandR should parse");

        assert_eq!(displays.len(), 2);
        assert_eq!(displays[0].connector, "DVI-D-0");
        assert_eq!((displays[0].x, displays[0].y), (0, -300));
        assert_eq!((displays[0].width, displays[0].height), (1080, 1920));
        assert!(displays[1].primary);
        assert_eq!((displays[1].x, displays[1].y), (1080, 0));
    }
}
