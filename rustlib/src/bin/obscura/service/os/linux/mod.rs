mod boot;
pub mod dns;
mod fd_store;
pub mod ipc;
#[cfg(test)]
mod kill_switch_tests;
mod netfilter;
mod network_manager;
pub mod routes;
mod service_lock;
pub mod start_error;
pub mod tun;

use crate::service::os::linux::dns::{DnsManager, DnsManagerArg, choose_dns_manager, resolved};
use crate::service::os::linux::fd_store::FdStore;
use crate::service::os::linux::ipc::ServiceIpc;
use crate::service::os::linux::netfilter::NftTable;
use crate::service::os::linux::routes::preferred_interface::watch_preferred_network_interface;
use crate::service::os::linux::routes::traffic_capture_routes::{enable_src_valid_mark, spawn_route_enforcer};
use crate::service::os::linux::service_lock::ServiceLock;
use crate::service::os::linux::tun::Tun;
use bytes::Bytes;
use obscuravpn_client::manager_cmd::{ManagerCmd, ManagerCmdErrorCode, ManagerCmdOk, PeerUid};
use obscuravpn_client::net::NetworkInterface;
use obscuravpn_client::network_config::OsNetworkConfig;
use obscuravpn_client::os::os_trait::{FirewallStatus, Os};
use obscuravpn_client::quicwg::QuicWgConnPacketSender;
pub use start_error::LinuxServiceStartError;
use std::net::IpAddr;
use std::path::Path;
use tokio::sync::Mutex;
use tokio::sync::watch::{Receiver, Sender};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TrafficPolicy {
    Engage { local_network_access: bool, dns: Vec<IpAddr> },
    Disengage,
}

fn disconnected_policy(kill_switch: bool, local_network_access: bool) -> TrafficPolicy {
    if kill_switch {
        TrafficPolicy::Engage { local_network_access, dns: vec![] }
    } else {
        TrafficPolicy::Disengage
    }
}

pub struct LinuxOsImpl {
    tun: Tun,
    nft: Mutex<NftTable>,
    firewall_status: Sender<FirewallStatus>,
    routing: Sender<TrafficPolicy>,
    preferred_network_interface: Receiver<Option<NetworkInterface>>,
    current_network_config: tokio::sync::Mutex<Result<Option<OsNetworkConfig>, ()>>,
    dns_manager_arg: DnsManagerArg,
    ipc: ServiceIpc,
    _lock: ServiceLock,
}

impl LinuxOsImpl {
    pub async fn new(dns_manager_arg: DnsManagerArg, config_dir: &Path) -> Result<Self, LinuxServiceStartError> {
        let lock: ServiceLock = ServiceLock::new()?;

        let mut fd_store = FdStore::take_from_systemd();
        let mut nft = loop {
            match NftTable::create_or_adopt(&mut fd_store) {
                Ok(nft) => break nft,
                Err(()) if matches!(boot::enabled(config_dir), Ok(false)) => return Err(LinuxServiceStartError::NftablesSetup),
                Err(()) => tokio::time::sleep(std::time::Duration::from_secs(1)).await,
            }
        };
        fd_store.remove_unclaimed();
        let firewall_status = boot::protect(&mut nft, config_dir).await;
        let ipc = ServiceIpc::new(&lock).await?;
        let tun = Tun::create().map_err(|()| LinuxServiceStartError::TunSetup)?;
        let routing = spawn_route_enforcer(tun.interface()).await;
        let preferred_network_interface = watch_preferred_network_interface().await;
        let _ = enable_src_valid_mark();
        notify_ready();
        Ok(Self {
            _lock: lock,
            ipc,
            tun,
            nft: Mutex::new(nft),
            firewall_status: tokio::sync::watch::channel(firewall_status).0,
            routing,
            preferred_network_interface,
            current_network_config: Ok(None).into(),
            dns_manager_arg,
        })
    }

    pub fn network_interface(&self) -> Receiver<Option<NetworkInterface>> {
        self.preferred_network_interface.clone()
    }

    async fn apply_firewall(&self, policy: TrafficPolicy, tun_name: &str) -> Result<(), ()> {
        self.firewall_status.send_replace(FirewallStatus::Applying);
        let blocking = matches!(policy, TrafficPolicy::Engage { .. });
        let result = self.nft.lock().await.apply_ruleset(policy, tun_name).await;
        self.firewall_status.send_replace(match result {
            Ok(()) if blocking => FirewallStatus::Blocking,
            Ok(()) => FirewallStatus::Inactive,
            Err(()) => FirewallStatus::Failed,
        });
        result
    }
}

#[cfg(test)]
mod tests {
    use super::{TrafficPolicy, disconnected_policy};

    #[test]
    fn disconnected_policy_keeps_filtering_when_kill_switch_is_enabled() {
        assert_eq!(
            disconnected_policy(true, true),
            TrafficPolicy::Engage { local_network_access: true, dns: vec![] }
        );
    }

    #[test]
    fn disconnected_policy_removes_filtering_when_kill_switch_is_disabled() {
        assert_eq!(disconnected_policy(false, true), TrafficPolicy::Disengage);
    }
}

impl Os for LinuxOsImpl {
    fn firewall_status(&self) -> Option<Receiver<FirewallStatus>> {
        Some(self.firewall_status.subscribe())
    }

    async fn set_os_network_config(&self, network_config: OsNetworkConfig, tunnel: QuicWgConnPacketSender) -> Result<(), ()> {
        let mut current_network_config = self.current_network_config.lock().await;
        let tun = self.tun.interface();

        // Attempt all config steps regardless of individual failures to minimize leaks until intentionally disconnecting. E.g. DNS queries shouldn't leak because route setup failed.
        let policy = TrafficPolicy::Engage {
            local_network_access: network_config.local_network_access,
            dns: if network_config.use_system_dns {
                vec![]
            } else {
                network_config.dns.clone()
            },
        };
        let mut result = self.apply_firewall(policy.clone(), &tun.name).await;
        result = result.and(self.routing.send(policy.clone()).map_err(|error| {
            tracing::error!(message_id = "bK3wNr8T", ?error, "route enforcer is not running");
        }));
        match choose_dns_manager(self.dns_manager_arg).await {
            Err(()) => result = Err(()),
            Ok(DnsManager::NetworkManager) => result = result.and(network_manager::set_dns(&tun, &network_config).await),
            Ok(dns_manager) => {
                if dns_manager.is_resolved() {
                    if network_config.use_system_dns {
                        result = result.and(resolved::reset_dns(&tun).await);
                    } else {
                        result = result.and(resolved::set_dns(&tun, &network_config.dns).await);
                    }
                }
            }
        }
        result = result.and(self.tun.set_config(network_config.mtu, network_config.ipv4, network_config.ipv6));
        *current_network_config = result.map(|_| Some(network_config));

        self.tun.spawn_read_task(tunnel);
        result
    }

    async fn unset_os_network_config(&self, kill_switch: bool, local_network_access: bool) -> Result<(), ()> {
        let mut current_network_config = self.current_network_config.lock().await;
        let tun = self.tun.interface();
        let policy = disconnected_policy(kill_switch, local_network_access);
        let mut result = self.apply_firewall(policy.clone(), &tun.name).await;
        result = result.and(self.routing.send(policy.clone()).map_err(|error| {
            tracing::error!(message_id = "fZ8pQm2W", ?error, "route enforcer is not running");
        }));
        match choose_dns_manager(self.dns_manager_arg).await {
            Err(()) => result = Err(()),
            Ok(DnsManager::NetworkManager) => result = result.and(network_manager::reset_dns(&tun).await),
            Ok(dns_manager) => {
                if dns_manager.is_resolved() {
                    result = result.and(resolved::reset_dns(&tun).await);
                }
            }
        }
        *current_network_config = result.map(|_| None);
        result
    }

    fn packet_for_os(&self, packet: Bytes) {
        self.tun.send(packet)
    }
}

impl LinuxOsImpl {
    /// Returns next manager command. Blocks until a command is available. The response function is called with the command result.
    pub async fn next_manager_command(
        &self,
    ) -> (
        ManagerCmd,
        Option<PeerUid>,
        Box<dyn FnOnce(Result<ManagerCmdOk, ManagerCmdErrorCode>) + Send>,
    ) {
        loop {
            let request = self.ipc.next().await;
            let peer_uid = request.peer_uid;
            let decoded = ManagerCmd::from_json(&request.message);
            let response_fn = move |result: Result<ManagerCmdOk, ManagerCmdErrorCode>| {
                let json_response = serde_json::to_vec(&result)
                    .map_err(|error| {
                        tracing::error!(message_id = "8Jj0yWQt", ?error, "failed to encode command result: {}", error);
                        ManagerCmdErrorCode::Other
                    })
                    .unwrap_or(JSON_OTHER_ERROR.into());
                request.respond(json_response)
            };
            match decoded {
                Ok(cmd) => return (cmd, Some(peer_uid), Box::new(response_fn)),
                Err(error) => response_fn(Err(error)),
            }
        }
    }
}

fn notify_ready() {
    if let Err(error) = sd_notify::notify(&[sd_notify::NotifyState::Ready]) {
        tracing::error!(message_id = "qL2mVs9X", ?error, "failed to notify systemd");
    }
}

const JSON_OTHER_ERROR: &str = r#"{"Err":"other"}"#;

#[test]
fn test_other_error_json() {
    assert_eq!(
        serde_json::to_string(&Result::<ManagerCmdOk, ManagerCmdErrorCode>::Err(ManagerCmdErrorCode::Other)).unwrap(),
        JSON_OTHER_ERROR
    )
}
