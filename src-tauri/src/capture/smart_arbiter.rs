/// 获取当前系统物理上正在生效的接管驱动类型
/// 返回: "app_proxy" | "user_mode" | "windivert" | "tun"
pub fn get_active_driver_name() -> String {
    if !crate::platform::supports_tun() { return "app_proxy".into(); }
    let settings = crate::commands::settings::get_general_settings().unwrap_or_default();
    match settings.traffic_mode.as_str() {
        #[cfg(windows)]
        "user_mode" => "user_mode".to_string(),
        #[cfg(windows)]
        "windivert_v1" => if super::windivert::session::stats().active { "windivert".into() } else { "windivert_pending".into() },
        "tun" => "tun".to_string(),
        _ => "app_proxy".to_string(),
    }
}
