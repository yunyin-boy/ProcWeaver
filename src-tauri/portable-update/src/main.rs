#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    #[cfg(windows)]
    if procweaver_portable_update::run_updater().is_err() {
        std::process::exit(1);
    }
}
