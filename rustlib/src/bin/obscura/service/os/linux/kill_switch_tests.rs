use super::*;
use obscuravpn_client::network_config::DnsContentBlock;
use socket2::{Domain, Protocol, Socket, Type};
use std::net::SocketAddr;
use std::process::Command;

fn prepare_network() {
    assert_eq!(
        std::env::var("OBSCURA_TEST_NETNS").as_deref(),
        Ok("1"),
        "use contrib/bin/linux-kill-switch-test.bash"
    );
    assert_ne!(
        std::fs::read_link("/proc/self/ns/net").unwrap(),
        std::fs::read_link("/proc/1/ns/net").unwrap()
    );
    for args in [
        vec!["link", "set", "lo", "up"],
        vec!["link", "add", "ks-test", "type", "dummy"],
        vec!["link", "set", "ks-test", "up"],
        vec!["addr", "add", "198.18.0.1/24", "dev", "ks-test"],
        vec!["addr", "add", "192.168.30.1/24", "dev", "ks-test"],
        vec!["-6", "addr", "add", "2001:db8::1/64", "dev", "ks-test", "nodad"],
    ] {
        assert!(Command::new("ip").args(args).status().unwrap().success());
    }
}

fn send(destination: &str, marked: bool) -> std::io::Result<usize> {
    let destination: SocketAddr = destination.parse().unwrap();
    let socket = Socket::new(Domain::for_address(destination), Type::DGRAM, Some(Protocol::UDP))?;
    socket.bind_device(Some(b"ks-test"))?;
    if marked {
        socket.set_mark(obscuravpn_client::net::FWMARK)?;
    }
    socket.send_to(b"kill-switch-test", &destination.into())
}

fn assert_blocked() {
    for destination in ["198.18.0.2:443", "198.18.0.2:53", "[2001:db8::2]:443", "[2001:db8::2]:53"] {
        assert_eq!(send(destination, false).unwrap_err().raw_os_error(), Some(libc::EPERM), "{destination}");
        assert!(send(destination, true).is_ok(), "marked service traffic: {destination}");
    }
}

#[tokio::test]
#[ignore = "requires an isolated network namespace; run linux-kill-switch-test.bash"]
async fn kill_switch_kernel() {
    prepare_network();
    for destination in ["198.18.0.2:443", "[2001:db8::2]:443"] {
        assert!(send(destination, false).is_ok(), "baseline: {destination}");
    }
    let mut store = FdStore::take_from_systemd();
    let mut nft = NftTable::create_or_adopt(&mut store).unwrap();
    for local_network_access in [false, true, false] {
        nft.apply_ruleset(disconnected_policy(true, local_network_access), "obscuravpn")
            .await
            .unwrap();
        assert_blocked();
        assert_eq!(send("192.168.30.2:53", false).is_ok(), local_network_access);
    }
    // A rejected atomic replacement must leave the previous blocking rules in place.
    assert!(nft.apply_ruleset(disconnected_policy(true, false), &"x".repeat(256)).await.is_err());
    assert_blocked();
    nft.apply_ruleset(disconnected_policy(false, false), "obscuravpn").await.unwrap();
    assert!(send("198.18.0.2:443", false).is_ok());
    assert!(send("[2001:db8::2]:443", false).is_ok());
    nft.apply_ruleset(disconnected_policy(true, false), "obscuravpn").await.unwrap();
    assert_blocked();
}

#[tokio::test]
#[ignore = "also requires /dev/net/tun and an isolated /run with no system D-Bus"]
async fn kill_switch_dns_failure() {
    prepare_network();
    assert_eq!(
        std::env::var("DBUS_SYSTEM_BUS_ADDRESS").as_deref(),
        Ok("unix:path=/run/missing-test-dbus")
    );
    let config = tempfile::tempdir().unwrap();
    let os = LinuxOsImpl::new(DnsManagerArg::Auto, config.path()).await.unwrap();
    let status = os.firewall_status().unwrap();
    assert_eq!(*status.borrow(), FirewallStatus::Unknown);
    assert!(os.unset_os_network_config(true, false).await.is_err());
    assert_eq!(*status.borrow(), FirewallStatus::Blocking);
    assert_blocked();
    assert!(
        os.set_os_network_config(
            OsNetworkConfig::dummy(DnsContentBlock::default(), false, false),
            QuicWgConnPacketSender::new(None),
        )
        .await
        .is_err()
    );
    assert_eq!(*status.borrow(), FirewallStatus::Blocking);
    assert_blocked();
    assert!(os.apply_firewall(disconnected_policy(true, false), &"x".repeat(256)).await.is_err());
    assert_eq!(*status.borrow(), FirewallStatus::Failed);
    assert_blocked();
    assert!(os.unset_os_network_config(false, false).await.is_err());
    assert_eq!(*status.borrow(), FirewallStatus::Inactive);
    assert!(send("198.18.0.2:443", false).is_ok());
}

#[tokio::test]
#[ignore = "requires isolated namespaces and /dev/net/tun; run linux-kill-switch-test.bash"]
async fn kill_switch_boot() {
    prepare_network();
    let config = tempfile::tempdir().unwrap();
    let path = config.path().join("config.json");
    let mut store = FdStore::take_from_systemd();
    let mut nft = NftTable::create_or_adopt(&mut store).unwrap();

    std::fs::write(&path, "{").unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(200), boot::protect(&mut nft, config.path()))
            .await
            .is_err()
    );
    assert_blocked();

    std::fs::write(&path, r#"{"feature_flags":{"killSwitch":true}}"#).unwrap();
    assert_eq!(boot::protect(&mut nft, config.path()).await, FirewallStatus::Blocking);
    assert_blocked();

    std::fs::write(&path, r#"{"feature_flags":{"killSwitch":false}}"#).unwrap();
    assert_eq!(boot::protect(&mut nft, config.path()).await, FirewallStatus::Unknown);
    assert_blocked(); // Disabled startup must not clear rules adopted from a live tunnel.
    drop(nft);

    std::fs::write(&path, r#"{"feature_flags":{"killSwitch":true}}"#).unwrap();
    let os = LinuxOsImpl::new(DnsManagerArg::Auto, config.path()).await.unwrap();
    assert_eq!(*os.firewall_status().unwrap().borrow(), FirewallStatus::Blocking);
    assert_blocked(); // No set/unset call has occurred: construction already protects traffic.
}
