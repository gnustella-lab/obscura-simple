pub mod autostart;
pub mod debug_bundle;
pub mod exit_list_watch;
pub mod file_manager;
pub mod ipc;
pub mod status;
pub mod status_watch;
pub mod systemd;
pub mod tray;

pub fn argv0() -> Option<std::path::PathBuf> {
    std::env::args_os().next().map(std::path::PathBuf::from)
}

pub async fn current_user_name() -> Option<String> {
    let user = tokio::task::spawn_blocking(|| nix::unistd::User::from_uid(nix::unistd::getuid()))
        .await
        .map_err(|error| tracing::error!(message_id = "bW5nTk8D", %error, "task resolving current user failed"))
        .ok()?
        .map_err(|error| tracing::error!(message_id = "rV2mXs7J", %error, "failed to resolve current user"))
        .ok()?;
    let Some(user) = user else {
        tracing::error!(message_id = "kD9pQf4Y", "current user does not exist");
        return None;
    };
    Some(user.name)
}

pub fn user_config_dir() -> Option<camino::Utf8PathBuf> {
    xdg_base_dir("XDG_CONFIG_HOME", &[".config"])
}

pub fn ui_log_dir() -> Option<camino::Utf8PathBuf> {
    Some(
        xdg_base_dir("XDG_STATE_HOME", &[".local", "state"])?
            .join(if cfg!(feature = "simple-client") { "obscura-simple" } else { "obscura" })
            .join("logs"),
    )
}

pub fn ui_config_dir() -> Option<camino::Utf8PathBuf> {
    Some(user_config_dir()?.join(if cfg!(feature = "simple-client") { "obscura-simple" } else { "obscura" }))
}

#[cfg(all(test, feature = "simple-client"))]
mod simple_identity_tests {
    #[test]
    fn ipc_and_service_do_not_target_the_official_client() {
        assert_eq!(super::ipc::SOCKET_PATH, "/run/obscura-simple.sock");
        assert_eq!(super::ipc::LIVE_GROUPS_SOCKET_PATH, "/run/obscura-simple-live-groups.sock");
        assert_eq!(super::systemd::UNIT_NAME, "obscura-simple.service");
        if let Some(config) = super::ui_config_dir() {
            assert!(config.ends_with("obscura-simple"));
        }
        if let Some(logs) = super::ui_log_dir() {
            assert!(logs.ends_with("obscura-simple/logs"));
        }
    }
}

fn xdg_base_dir(env_var: &str, home_relative: &[&str]) -> Option<camino::Utf8PathBuf> {
    let xdg_dir = std::env::var(env_var).ok().filter(|dir| !dir.is_empty());
    let home = std::env::var("HOME").ok().filter(|dir| !dir.is_empty());
    match (xdg_dir, home) {
        (Some(xdg_dir), _) => Some(camino::Utf8PathBuf::from(xdg_dir)),
        (None, Some(home)) => Some(camino::Utf8PathBuf::from_iter(
            std::iter::once(home.as_str()).chain(home_relative.iter().copied()),
        )),
        (None, None) => None,
    }
}
