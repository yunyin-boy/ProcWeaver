#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    #[cfg(windows)]
    if !proc_weaver_lib::portable_update::bootstrap_app() { return; }
    proc_weaver_lib::process_app::run();
}
