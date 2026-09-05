use super::*;
use crate::network_config::OsNetworkConfig;
use crate::os::os_trait::{FirewallStatus, RevocableOs};
use crate::quicwg::QuicWgConnPacketSender;

struct TestOs {
    firewall: Sender<FirewallStatus>,
    block_attempts: Sender<usize>,
}

impl Os for TestOs {
    fn firewall_status(&self) -> Option<Receiver<FirewallStatus>> {
        Some(self.firewall.subscribe())
    }

    async fn set_os_network_config(&self, _: OsNetworkConfig, _: QuicWgConnPacketSender) -> Result<(), ()> {
        panic!("no network interface should be available in this test")
    }

    async fn unset_os_network_config(&self, kill_switch: bool, _: bool) -> Result<(), ()> {
        if kill_switch {
            self.block_attempts.send_modify(|count| *count += 1);
        }
        Err(())
    }

    fn packet_for_os(&self, _: bytes::Bytes) {}
}

fn test_os() -> Arc<TestOs> {
    Arc::new(TestOs { firewall: channel(FirewallStatus::Unknown).0, block_attempts: channel(0).0 })
}

#[tokio::test]
async fn firewall_status_reaches_subscribers_and_old_status_remains_readable() {
    let directory = tempfile::tempdir().unwrap();
    let os = test_os();
    let (_network, network) = channel(None);
    let manager = Manager::new(
        directory.path().into(),
        WgKeyStore::None,
        "firewall-test".into(),
        Arc::new(RevocableOs::new(os.clone())),
        network,
        None,
        true,
    )
    .unwrap();
    let mut status = manager.subscribe();
    for expected in [
        FirewallStatus::Applying,
        FirewallStatus::Blocking,
        FirewallStatus::Failed,
        FirewallStatus::Inactive,
    ] {
        let previous_version = status.borrow().version;
        os.firewall.send_replace(expected);
        let updated = tokio::time::timeout(Duration::from_secs(3), status.wait_for(|status| status.firewall_status == expected))
            .await
            .unwrap()
            .unwrap();
        assert_ne!(updated.version, previous_version);
        assert_ne!(updated.feature_flags.kill_switch, Some(true));
    }
    let mut old_status = serde_json::to_value(&*status.borrow()).unwrap();
    old_status.as_object_mut().unwrap().remove("firewallStatus");
    assert_eq!(
        serde_json::from_value::<Status>(old_status).unwrap().firewall_status,
        FirewallStatus::Unknown
    );
}

#[tokio::test]
async fn kill_switch_without_interface_retries_failed_protection() {
    let directory = tempfile::tempdir().unwrap();
    let client = ClientState::new(directory.path().into(), WgKeyStore::None, "firewall-test".into(), true).unwrap();
    client.set_feature_flag("killSwitch", true);
    client.set_tunnel_target_state(None, Some(true));
    let os = test_os();
    let mut attempts = os.block_attempts.subscribe();
    let _tunnel = TunnelState::new(client, os);
    tokio::time::timeout(Duration::from_secs(4), attempts.wait_for(|count| *count >= 2))
        .await
        .unwrap()
        .unwrap();
}
