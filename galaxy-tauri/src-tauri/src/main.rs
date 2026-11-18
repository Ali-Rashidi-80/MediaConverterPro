#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use galaxy_tauri_lib::constants::APP_NAME;
use galaxy_tauri_lib::logging::AppLogger;

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let msg = format!("{} Crash: {}", APP_NAME, info);
        eprintln!("{}", msg);
        AppLogger::write_crash_log(&msg);
    }));

    galaxy_tauri_lib::run();
}
