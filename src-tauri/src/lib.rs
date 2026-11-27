pub mod commands;
pub mod storage;
pub mod platform;
pub mod local_nodes;
pub mod external_proxy;
pub mod function_mode;
pub mod process_capture;
pub mod edition;
#[cfg(feature = "process-edition")]
pub mod process_app;
#[cfg(windows)]
pub mod portable_update;
#[cfg(feature = "process-edition")]
mod process_conflict;
mod bundle_repository;
#[cfg(not(target_os = "android"))]
mod app_lifecycle;
#[cfg(all(not(target_os = "android"), not(feature = "process-edition")))]
mod desktop_startup;
#[cfg(target_os = "android")]
#[path = "platform/android/lifecycle.rs"]
mod app_lifecycle;
#[cfg(windows)]
mod windows_identity;
mod shutdown;
pub mod routing_overrides;
pub mod capture;

#[cfg(not(feature = "process-edition"))]
use std::sync::Mutex;
#[cfg(not(feature = "process-edition"))]
use commands::process::{CoreState, CoreStateMutex};
#[cfg(all(not(target_os = "android"), not(feature = "process-edition")))]
use tauri::Manager;

#[cfg(all(target_os = "android", not(feature = "process-edition")))]
#[tauri::command]
fn get_first_use_status() -> Option<()> {
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
#[cfg(not(feature = "process-edition"))]
pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(windows)]
    windows_identity::initialize(&context.config().identifier)
        .expect("无法设置 ProcWeaver 的 Windows 任务栏身份");
    let core_state: CoreStateMutex = Mutex::new(CoreState {
        child: None,
        mixed_port: 7890,
        controller_port: 9090,
        active_core: None,
        active_core_path: None,
        core_mode: None,
        started_at: None,
    });

    let builder = tauri::Builder::default();
    #[cfg(not(target_os = "android"))]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            app_lifecycle::show(app);
            if desktop_startup::started() {
                commands::bundle_launch::dispatch(app, args);
            }
        }));
    #[cfg(target_os = "android")]
    let builder = builder.plugin(platform::android::init());
    builder
        .plugin(tauri_plugin_opener::init())
        .manage(core_state)
        // Tauri creates configured webviews before the application setup callback.
        // Their first IPC (including UI restore) must already have valid data paths.
        .plugin(tauri::plugin::Builder::<_, ()>::new("storage-init")
            .setup(|app, _| {
                storage::initialize(app)?;
                function_mode::initialize();
                process_capture::initialize();
                commands::local_rules::initialize()?;
                Ok(())
            })
            .build())
        .setup(|_app| {
            #[cfg(not(target_os = "android"))]
            desktop_startup::setup(_app.handle())?;
            #[cfg(windows)]
            portable_update::watch_trial(_app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(not(target_os = "android"))]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && !shutdown::ready() {
                    api.prevent_close();
                    if !desktop_startup::started() {
                        window.app_handle().exit(0);
                        return;
                    }
                    let settings = commands::settings::get_general_settings().unwrap_or_default();
                    match settings.close_action.as_str() {
                        "minimize" => {
                            if window.hide().is_ok() { return; }
                        }
                        "exit" => {
                            shutdown::request(window.app_handle(), 0);
                            return;
                        }
                        _ => {
                            use tauri::Emitter;
                            let _ = window.emit("request-close-action", ());
                        }
                    }
                }
            }
        })
        .invoke_handler({
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
            #[cfg(not(target_os = "android"))]
            desktop_startup::get_first_use_status,
            #[cfg(target_os = "android")]
            get_first_use_status,
            #[cfg(not(target_os = "android"))]
            desktop_startup::confirm_first_use,
            #[cfg(not(target_os = "android"))]
            desktop_startup::exit_first_use,
            #[cfg(not(target_os = "android"))]
            desktop_startup::save_guide_progress,
            function_mode::get_function_mode,
            process_capture::get_process_capture,
            process_capture::set_process_capture,
            function_mode::set_function_mode,
            function_mode::get_process_preferences,
            function_mode::save_process_preferences,
            external_proxy::get_external_proxy,
            external_proxy::save_external_proxy_settings,
            external_proxy::apply_external_bundles,
            external_proxy::test_external_proxy,
            local_nodes::get_local_nodes,
            local_nodes::get_local_node,
            local_nodes::save_local_nodes,
            local_nodes::preview_local_nodes,
            bundle_repository::read_bundle_repository_file,
            bundle_repository::cancel_bundle_repository_request,
            commands::bundle_launch::launch_bundle_app,
            commands::bundle_launch::get_bundle_entry_states,
            commands::bundle_launch::take_bundle_launch_requests,
            commands::bundle_launch::take_bundle_capture_warning,
            commands::bundle_launch::choose_bundle_executable,
            commands::bundle_launch::inspect_bundle_stale_connections,
            commands::bundle_launch::reset_bundle_stale_connections,
            commands::bundle_shortcuts::get_bundle_shortcuts,
            commands::bundle_shortcuts::change_bundle_shortcut,
            commands::business_bundles::get_business_bundles,
            commands::business_bundles::save_business_bundles,
            commands::business_bundles::mount_repository_business_bundle,
            commands::business_bundles::delete_business_bundle,
            commands::routing_overrides::get_routing_overrides,
            routing_overrides::custom_rules::get_custom_rule_workbench,
            routing_overrides::custom_rules::save_custom_rules,
            commands::routing_overrides::save_routing_overrides,
            commands::routing_overrides::confirm_bundle_hot_reset,
            commands::routing_overrides::get_process_tree,
            commands::routing_overrides::choose_routing_executable,
            commands::routing_overrides::diagnose_routing_dns,
            commands::mihomo_api::get_traffic_snapshot,
            commands::local_rules::get_local_rule_plan,
            commands::exclusions::get_exclusions,
            commands::exclusions::save_exclusions,
            commands::local_rules::set_local_rule_plan_enabled,
            commands::ip_health::check_ip_health,
            commands::ip_health::wait_for_exit_connection,
            commands::process::get_cpu_info,
            platform::get_platform_capabilities,
            platform::get_android_applications,
            platform::android_mobile_action,
            commands::mobile_settings::get_lan_outbounds,
            commands::config_transfer::export_config_snapshot,
            commands::config_transfer::preview_config_snapshot,
            commands::config_transfer::restore_config_snapshot,
            commands::config_transfer::pending_restore_ui,
            commands::config_sync::sync_config_remote,
            platform::get_core_log_token,
            platform::save_android_document,
            platform::get_macos_tun_readiness,
            commands::process::get_core_status,
            commands::process::start_core,
            commands::process::stop_core,
            commands::process::restart_core,
            commands::sysproxy::set_system_proxy,
            commands::sysproxy::get_system_proxy_status,
            commands::profile::list_profiles,
            commands::profile::add_profile,
            commands::profile::import_profile_content,
            commands::profile::update_profile,
            commands::profile::select_profile,
            commands::profile_switch::preview_profile_switch,
            commands::profile::delete_profile,
            commands::profile::edit_profile_metadata,
            commands::profile::get_profile_content,
            commands::profile::save_profile_content,
            commands::profile::export_profile_file,
            commands::profile::add_external_rule_provider,
            commands::profile::remove_external_rule_provider,
            commands::mihomo_api::get_mihomo_proxies,
            commands::mihomo_api::switch_public_node,
            routing_overrides::policy_groups::get_policy_groups,
            routing_overrides::policy_groups::save_policy_group,
            routing_overrides::policy_groups::admission::test_policy_group_nodes,
            routing_overrides::policy_groups::admission::check_policy_group_now,
            routing_overrides::policy_groups::admission::set_policy_group_test_url,
            routing_overrides::policy_groups::runtime::select_policy_group_member,
            commands::mihomo_api::switch_mihomo_proxy,
            commands::mihomo_api::test_mihomo_delay,
            commands::mihomo_api::get_mihomo_rules,
            commands::mihomo_api::set_mihomo_mode,
            commands::mihomo_api::get_mihomo_config,
            commands::mihomo_api::get_public_routing_mode,
            commands::mihomo_api::get_mihomo_rule_providers,
            commands::mihomo_api::update_mihomo_rule_provider,
            commands::mihomo_api::get_active_connections,
            commands::mihomo_api::close_connection,
            commands::mihomo_api::close_all_connections,
            commands::geo::get_geo_config,
            commands::geo::save_geo_config,
            commands::geo::sync_geo_resource,
            commands::geo::sync_all_geo_resources,
            commands::profile::get_smart_groups,
            commands::profile::save_smart_groups,
            commands::profile::get_business_channels,
            commands::profile::save_business_channels,
            commands::profile::sync_smart_groups_to_core,
            commands::settings::get_general_settings,
            commands::settings::save_general_settings,
            commands::settings::patch_general_settings,
            #[cfg(windows)]
            commands::settings::set_tun_enabled,
            #[cfg(not(target_os = "android"))]
            commands::lan_access::get_lan_access_status,
            #[cfg(not(target_os = "android"))]
            commands::tun::get_tun_status,
            commands::settings::set_close_action,
            commands::settings::get_active_traffic_driver,
            commands::settings::clean_windivert_residual_service,
            commands::dns::get_dns_settings,
            commands::dns::save_dns_settings,
            commands::dns::get_hosts_conflict_warning,
            commands::dns::clear_hosts_conflict_warning,
            #[cfg(windows)]
            commands::dns_listener::get_dns_listener_status,
            commands::health_probe::begin_health_probe,
            commands::health_probe::probe_node_health,
            commands::health_probe::end_health_probe,
            commands::health_probe::get_health_cache,
            commands::health_probe::save_health_cache,
            commands::window::window_minimize,
            commands::window::window_start_dragging,
            commands::window::window_toggle_maximize,
            commands::window::window_is_maximized,
            commands::window::window_close,
            commands::window::window_execute_close,
            commands::window::window_set_form_factor,
            commands::window::window_set_always_on_top,
            commands::unlock_probe::probe_unlock_matrix,
            commands::system::check_is_admin,
            commands::system::restart_elevated,
            commands::dns_adapter::toggle_dns_guard,
            commands::dns_adapter::get_dns_guard_status,
            commands::dns_adapter::get_dns_guard_info,
            commands::dns_adapter::run_network_emergency_repair,
            commands::app_launcher::launch_preset_app,
            commands::shortcut_manager::get_shortcut_status,
            commands::shortcut_manager::patch_existing_shortcut,
            commands::shortcut_manager::restore_existing_shortcut,
            commands::shortcut_manager::create_dedicated_shortcut,
            commands::shortcut_manager::get_app_shortcut_status,
            commands::shortcut_manager::patch_app_shortcut,
            commands::shortcut_manager::restore_app_shortcut,
            commands::shortcut_manager::create_dedicated_app_shortcut,
            commands::process_watcher::toggle_process_watcher,
            commands::process_watcher::get_process_watcher_status,
            commands::process_watcher::get_watcher_mode,
            commands::process_watcher::set_watcher_mode,
            #[cfg(not(windows))]
            commands::maintenance::check_app_update,
            #[cfg(not(windows))]
            commands::maintenance::download_app_update,
            #[cfg(not(windows))]
            commands::maintenance::install_app_update,
            #[cfg(windows)]
            portable_update::check_app_update,
            #[cfg(windows)]
            portable_update::apply_portable_update,
            #[cfg(windows)]
            portable_update::portable_workbench_ready,
            commands::maintenance::restart_app,
            commands::maintenance::get_mihomo_core_detail,
            commands::maintenance::check_mihomo_update,
            commands::maintenance::check_rules_repo_update,
            commands::maintenance::check_core_rules_update,
            commands::maintenance::download_core_rules_update,
            app_lifecycle::update_tray_menu,
            app_lifecycle::update_tray_traffic,
            commands::window::window_monitor_visible,
            app_lifecycle::get_tray_payload,
            app_lifecycle::execute_tray_menu_action,
            app_lifecycle::hide_tray_menu,
            app_lifecycle::show_tray_menu,
            ];
            move |invoke: tauri::ipc::Invoke<tauri::Wry>| {
                #[cfg(not(target_os = "android"))]
                if !desktop_startup::started() && !matches!(
                    invoke.message.command(),
                    "get_first_use_status" | "confirm_first_use" | "exit_first_use"
                ) {
                    invoke.resolver.reject("请先阅读并确认首次使用须知");
                    return true;
                }
                handler(invoke)
            }
        })
        .on_window_event(|window, event| {
            if window.label() == "tray-menu" {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            } else if window.label() == "main" {
                #[cfg(not(target_os = "android"))]
                if !desktop_startup::started() {
                    return;
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let settings = crate::commands::settings::get_general_settings().unwrap_or_default();
                    match settings.close_action.as_str() {
                        "minimize" => {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                        "exit" => {
                            api.prevent_close();
                            crate::shutdown::request(window.app_handle(), 0);
                        }
                        _ => {
                            use tauri::Emitter;
                            api.prevent_close();
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("request-close-action", ());
                        }
                    }
                }
            }
        })
        .build(context)
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            #[cfg(not(target_os = "android"))]
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if desktop_startup::started() && !shutdown::ready() {
                    api.prevent_exit();
                    shutdown::request(app_handle, code.unwrap_or(0));
                }
            }
        });
}
