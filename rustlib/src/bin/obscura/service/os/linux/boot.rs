use super::{TrafficPolicy, netfilter::NftTable, tun::TUN_NAME};
use obscuravpn_client::os::os_trait::FirewallStatus;
use serde::Deserialize;
use std::path::Path;
use std::time::Duration;

#[derive(Default, Deserialize)]
#[serde(default)]
struct BootConfig {
    feature_flags: BootFlags,
}

#[derive(Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct BootFlags {
    kill_switch: Option<bool>,
}

pub(super) fn enabled(config_dir: &Path) -> anyhow::Result<bool> {
    let file = match std::fs::File::open(config_dir.join("config.json")) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    let config: BootConfig = serde_json::from_reader(file)?;
    Ok(config.feature_flags.kill_switch.unwrap_or(false))
}

pub(super) async fn protect(nft: &mut NftTable, config_dir: &Path) -> FirewallStatus {
    let mut status = FirewallStatus::Unknown;
    loop {
        let enabled = enabled(config_dir);
        if matches!(enabled, Ok(false)) {
            // The manager reconciles existing rules; never open an adopted tunnel here.
            return status;
        }
        if let Err(error) = &enabled {
            tracing::error!(
                message_id = "Q7mK2sV9",
                ?error,
                "cannot read boot kill switch preference; retaining protection and retrying"
            );
        }
        // No LAN exceptions until the full configuration restores DNS restrictions.
        let policy = TrafficPolicy::Engage { local_network_access: false, dns: vec![] };
        if nft.apply_ruleset(policy, TUN_NAME).await.is_ok() {
            status = FirewallStatus::Blocking;
            if enabled.is_ok() {
                return status;
            }
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_persisted_config_shape_and_defaults() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!enabled(dir.path()).unwrap());
        for (json, expected) in [
            ("{}", false),
            (r#"{"feature_flags":{"killSwitch":null}}"#, false),
            (r#"{"feature_flags":{"killSwitch":false}}"#, false),
            (r#"{"feature_flags":{"killSwitch":true}}"#, true),
        ] {
            std::fs::write(dir.path().join("config.json"), json).unwrap();
            assert_eq!(enabled(dir.path()).unwrap(), expected);
        }
        let mut config = obscuravpn_client::config::Config::default();
        config.feature_flags.kill_switch = Some(true);
        std::fs::write(dir.path().join("config.json"), serde_json::to_vec(&config).unwrap()).unwrap();
        assert!(enabled(dir.path()).unwrap());
    }

    #[test]
    fn invalid_preferences_are_not_treated_as_disabled() {
        let dir = tempfile::tempdir().unwrap();
        for json in ["{", "null", r#"{"feature_flags":null}"#, r#"{"feature_flags":{"killSwitch":"true"}}"#] {
            std::fs::write(dir.path().join("config.json"), json).unwrap();
            assert!(enabled(dir.path()).is_err());
        }
        std::fs::remove_file(dir.path().join("config.json")).unwrap();
        std::fs::create_dir(dir.path().join("config.json")).unwrap();
        assert!(enabled(dir.path()).is_err());
    }
}
