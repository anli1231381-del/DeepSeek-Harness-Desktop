use serde_json::{json, Value};
use std::{collections::HashMap, io::{BufRead, BufReader, Write}, path::PathBuf, process::{Child, ChildStdin, Command, Stdio}, sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Arc, Mutex}, time::{Duration, Instant}};
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::{CreateJobObjectW, SetInformationJobObject, AssignProcessToJobObject, JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE}};

type Reply = oneshot::Sender<Result<Value, String>>;
const CHAT_URL: &str = "https://chat.deepseek.com/";
#[derive(Default)]
struct ChatViewState(tokio::sync::Mutex<()>);

// Remote content must never gain access to local projects, credentials or commands.
fn require_local_view(caller: &tauri::Webview) -> Result<(), String> {
    let url = caller.url().map_err(|_| "无法识别窗口来源")?;
    let local = matches!((url.scheme(), url.host_str()), ("http" | "https", Some("tauri.localhost")) | ("tauri", Some("localhost")))
        || (cfg!(debug_assertions) && url.scheme() == "http" && matches!(url.host_str(), Some("localhost" | "127.0.0.1")) && url.port() == Some(1420));
    if caller.label() == "main" && local { Ok(()) } else { Err("此页面无权访问桌面功能".into()) }
}

#[tauri::command]
async fn chat_view(caller: tauri::Webview, state: tauri::State<'_, ChatViewState>, visible: bool, x: Option<f64>, y: Option<f64>, width: Option<f64>, height: Option<f64>) -> Result<(), String> {
    require_local_view(&caller)?;
    let _guard = state.0.lock().await;
    let window = caller.window();
    let existing = window.get_webview("deepseek-chat");
    if !visible { return existing.map_or(Ok(()), |view| view.hide().map_err(|_| "无法隐藏对话页".into())); }
    let (x, y, width, height) = match (x, y, width, height) {
        (Some(x), Some(y), Some(w), Some(h)) if [x, y, w, h].iter().all(|n| n.is_finite()) && x >= 0.0 && y >= 0.0 && w > 0.0 && h > 0.0 => (x, y, w, h),
        _ => return Err("对话区域尺寸无效".into()),
    };
    let size = window.inner_size().map_err(|_| "无法读取窗口尺寸")?.to_logical::<f64>(window.scale_factor().map_err(|_| "无法读取窗口缩放")?);
    let (width, height) = (width.min(size.width - x), height.min(size.height - y));
    if width <= 0.0 || height <= 0.0 { return Err("对话区域超出窗口".into()); }
    let position = tauri::LogicalPosition::new(x, y);
    let size = tauri::LogicalSize::new(width, height);
    if let Some(view) = existing {
        view.set_bounds(tauri::Rect { position: position.into(), size: size.into() }).map_err(|_| "无法调整对话区域")?;
        view.show().map_err(|_| "无法显示对话页")?;
    } else {
        let builder = tauri::webview::WebviewBuilder::new("deepseek-chat", tauri::WebviewUrl::External(CHAT_URL.parse().unwrap()))
            .on_navigation(|url| url.scheme() == "https")
            .on_new_window(|url, _| if url.scheme() == "https" { tauri::webview::NewWindowResponse::Allow } else { tauri::webview::NewWindowResponse::Deny })
            .disable_drag_drop_handler();
        window.add_child(builder, position, size).map_err(|_| "无法打开对话页，请重试")?;
    }
    Ok(())
}

#[tauri::command]
async fn reload_chat(caller: tauri::Webview, state: tauri::State<'_, ChatViewState>) -> Result<(), String> {
    require_local_view(&caller)?;
    let _guard = state.0.lock().await;
    if let Some(view) = caller.get_webview("deepseek-chat") { view.reload().map_err(|_| "无法刷新对话页")?; }
    Ok(())
}

#[tauri::command]
fn open_deepseek_web(caller: tauri::Webview) -> Result<(), String> {
    require_local_view(&caller)?;
    #[cfg(windows)]
    let result = hidden(Command::new("rundll32.exe").args(["url.dll,FileProtocolHandler", CHAT_URL])).spawn();
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(CHAT_URL).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(CHAT_URL).spawn();
    result.map(|_| ()).map_err(|_| "无法打开默认浏览器".into())
}

#[derive(Default)]
struct Bridge {
    input: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    pending: Mutex<HashMap<u64, Reply>>,
    sequence: AtomicU64,
    closing: AtomicBool,
    failure: Mutex<Option<String>>,
    job: Mutex<Option<usize>>,
    diagnostics: Mutex<Vec<String>>,
}

// The OS owns the full Node/Harness process tree even if either process crashes.
#[cfg(windows)]
fn own_process_tree(child: &Child, state: &Bridge) -> Result<(), String> {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() { return Err(std::io::Error::last_os_error().to_string()); }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits as *const _ as *const _, std::mem::size_of_val(&limits) as u32) == 0 || AssignProcessToJobObject(job, child.as_raw_handle()) == 0 {
            let error = std::io::Error::last_os_error().to_string(); CloseHandle(job); return Err(error);
        }
        *state.job.lock().unwrap() = Some(job as usize);
    }
    Ok(())
}

fn release_process_tree(state: &Bridge) {
    #[cfg(windows)]
    if let Some(job) = state.job.lock().unwrap().take() { unsafe { CloseHandle(job as _); } }
}

fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    command
}

fn start(app: &tauri::AppHandle, bridge: Arc<Bridge>) -> Result<(), String> {
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let script = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../runtime/bridge.mjs")
    } else { resources.join("runtime/bridge.mjs") };
    let app_data = std::env::var_os("HARNESS_DESKTOP_DATA").map(PathBuf::from)
        .unwrap_or(app.path().app_data_dir().map_err(|e| e.to_string())?);
    std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    let node = std::env::var_os("HARNESS_DESKTOP_NODE").map(PathBuf::from)
        .or_else(|| { let p = resources.join("runtime/node/node.exe"); p.is_file().then_some(p) })
        .or_else(|| std::env::var_os("ProgramFiles").map(|p| PathBuf::from(p).join("nodejs/node.exe")).filter(|p| p.is_file()))
        .unwrap_or_else(|| PathBuf::from("node"));
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH").map(|value| std::env::split_paths(&value).collect()).unwrap_or_default();
    if let Some(parent) = node.parent().filter(|path| !path.as_os_str().is_empty()) { paths.insert(0, dunce::simplified(parent).to_path_buf()); }
    let child_path = std::env::join_paths(paths).map_err(|error| error.to_string())?;
    let mut child = hidden(Command::new(dunce::simplified(&node)).env("PATH", child_path).arg(dunce::simplified(&script)).arg(dunce::simplified(&app_data.join("state.json"))).arg(dunce::simplified(&resources.join("runtime"))))
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()
        .map_err(|e| format!("无法启动本地运行环境，请安装 Node.js 24 或设置 HARNESS_DESKTOP_NODE。{e}"))?;
    #[cfg(windows)]
    if let Err(error) = own_process_tree(&child, &bridge) { let _ = child.kill(); let _ = child.wait(); return Err(format!("无法建立运行进程管理：{error}")); }
    *bridge.input.lock().unwrap() = child.stdin.take();
    let output = child.stdout.take().ok_or("无法读取本地运行环境输出")?;
    let errors = child.stderr.take().ok_or("无法读取本地运行环境诊断")?;
    *bridge.child.lock().unwrap() = Some(child);
    let diagnostics = bridge.clone();
    let error_reader = std::thread::spawn(move || {
        for line in BufReader::new(errors).lines() {
            let Ok(line) = line else { break };
            let lower = line.to_lowercase();
            let safe = if ["sk-", "authorization", "api_key", "api key", "token"].iter().any(|key| lower.contains(key)) { "[敏感诊断已隐藏]".to_string() } else { line.chars().take(512).collect() };
            let mut tail = diagnostics.diagnostics.lock().unwrap();
            tail.push(safe); if tail.len() > 12 { tail.remove(0); }
        }
    });
    let handle = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines() {
            let Ok(line) = line else { break };
            let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
            if message.get("event").is_some() { let _ = handle.emit("app-event", json!({"changed":true})); }
            else if let Some(id) = message["id"].as_u64() {
                if let Some(reply) = bridge.pending.lock().unwrap().remove(&id) {
                    let result = if let Some(error) = message["error"].as_str() { Err(error.to_string()) } else { Ok(message["result"].clone()) };
                    let _ = reply.send(result);
                }
            }
        }
        release_process_tree(&bridge);
        let _ = error_reader.join();
        let error = format!("本地桥接进程已退出，请重新启动应用并检查 Harness 安装。\n{}", bridge.diagnostics.lock().unwrap().join("\n"));
        *bridge.failure.lock().unwrap() = Some(error.clone());
        for (_, reply) in bridge.pending.lock().unwrap().drain() { let _ = reply.send(Err(error.clone())); }
        let _ = handle.emit("app-event", json!({"disconnected":true}));
    });
    Ok(())
}

#[tauri::command]
async fn bridge(caller: tauri::Webview, operation: String, params: Option<Value>, state: tauri::State<'_, Arc<Bridge>>) -> Result<Value, String> {
    require_local_view(&caller)?;
    if state.closing.load(Ordering::SeqCst) { return Err("应用正在关闭".into()); }
    if let Some(error) = state.failure.lock().unwrap().clone() { return Err(error); }
    let id = state.sequence.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = oneshot::channel();
    state.pending.lock().unwrap().insert(id, tx);
    let payload = format!("{}\n", json!({"id":id,"operation":operation,"params":params.unwrap_or(json!({}))}));
    let written = {
        let mut input = state.input.lock().unwrap();
        input.as_mut().ok_or_else(|| "本地运行环境未就绪".to_string()).and_then(|stdin| stdin.write_all(payload.as_bytes()).map_err(|e| e.to_string()))
    };
    if let Err(error) = written { state.pending.lock().unwrap().remove(&id); return Err(error); }
    match tokio::time::timeout(Duration::from_secs(60), rx).await {
        Ok(Ok(value)) => value,
        _ => { state.pending.lock().unwrap().remove(&id); Err("操作超时或运行环境已退出，请重试。".into()) }
    }
}

#[tauri::command]
async fn choose_folder(caller: tauri::Webview) -> Result<Option<String>, String> {
    require_local_view(&caller)?;
    tauri::async_runtime::spawn_blocking(|| rfd::FileDialog::new().set_title("选择项目或 Harness 目录").pick_folder().map(|p| dunce::simplified(&p).to_string_lossy().into_owned()))
        .await.map_err(|e| e.to_string())
}

pub fn run() {
    let shared = Arc::new(Bridge::default());
    let setup_state = shared.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_window("main") { let _ = window.show(); let _ = window.set_focus(); }
        }))
        .manage(shared.clone())
        .manage(ChatViewState::default())
        .invoke_handler(tauri::generate_handler![bridge, choose_folder, chat_view, reload_chat, open_deepseek_web])
        .setup(move |app| {
            if let Err(error) = start(app.handle(), setup_state.clone()) { *setup_state.failure.lock().unwrap() = Some(error); }
            Ok(())
        })
        .build(tauri::generate_context!()).expect("无法创建桌面窗口");
    app.run(move |handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if shared.closing.swap(true, Ordering::SeqCst) { return; }
            api.prevent_exit();
            let state = shared.clone(); let handle = handle.clone();
            std::thread::spawn(move || {
                state.input.lock().unwrap().take();
                if let Some(mut child) = state.child.lock().unwrap().take() {
                    let deadline = Instant::now() + Duration::from_secs(20);
                    loop {
                        if matches!(child.try_wait(), Ok(Some(_))) { break; }
                        if Instant::now() >= deadline {
                            #[cfg(windows)]
                            { let _ = hidden(Command::new("taskkill").args(["/PID", &child.id().to_string(), "/T", "/F"])).status(); }
                            let _ = child.kill(); let _ = child.wait(); break;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                }
                release_process_tree(&state);
                handle.exit(0);
            });
        }
    });
}
