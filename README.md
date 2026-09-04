# Obscura VPN Client

> **Fork Notice — I forgot to fork before starting**
>
> This repository at `gnustella-lab/obscura-simple` is a **fork** of [`Sovereign-Engineering/obscuravpn-client`](https://github.com/Sovereign-Engineering/obscuravpn-client).
> I started developing (simple HTML GUI, English wrappers, `.deb` packaging) directly on a clone and forgot to click **Fork** on GitHub first.
> The commit history is preserved from the upstream `main` (`v1.177`) and all new work is on top of it. The upstream remains the canonical source; this fork exists to host the simple UI and installable package. If you are looking for the official client, go to the upstream link above.

Obscura VPN library, CLI client, and App — **simple HTML GUI edition** (see [`SIMPLE_UI.md`](SIMPLE_UI.md))

> **Language:** This fork is maintained **totally in English**. The original upstream is also English; the simple UI (`simple-ui/`) and helper scripts (`run-*.sh`) were translated from Portuguese and are now English-only.

## Releases

Current package revision: `1.177-6` — ready-to-use `.deb` with the simple UI (`obscura-simple_1.177-6_amd64.deb`, ~24M).

```bash
sudo apt install ./obscura-simple_1.177-6_amd64.deb
systemctl status obscura.service   # -> active (running)
sudo obscura add-operator $USER && newgrp obscura
```

The `.deb` is published as a release asset (not committed to the repo). Versioning: `tag.json` tracks the upstream version (`1.177`); the `-N` suffix (`-6`) is the fork packaging revision (`v1.177-simple-N` tags). See all releases [here](https://github.com/gnustella-lab/obscura-simple/releases).

## Support

No support is provided for this code directly. However, if you are experiencing issues with your Obscura VPN service please contact <support@obscura.net>.

## Contributions

At this time we are unable to accept external contributions. This is something that we plan to resolve soon. However until we finish the paperwork we are unable to look at any patches and will close all PRs without looking at them.

Conventions, terminology, and intended behavior are documented in the [docs](docs/) directory. Contributions must align with these documents or change them accordingly.

## Linux

For local development, build and run any of the binaries (each builds in the same Debian
container as the release):

- `contrib/bin/linux_run_gui.sh`: builds and runs the GUI.
- `contrib/bin/linux_run_cli.sh`: builds and runs the `obscura` CLI, passing its arguments through.
- `contrib/bin/linux_run_service.sh`: builds and runs the `obscura` system service the GUI and CLI talk to.

### Simple HTML GUI (this fork)

This fork replaces the React/Mantine `obscura-ui` with a lightweight vanilla HTML/CSS/JS interface (`simple-ui/`, ~28K `app.js` + ~6K `style.css` + ~12K `index.html`, no Node dependencies at runtime).

- **Views:** Connection (quick connect, city select, progress, session), Location (search, pinned, last used, grouped by country), Account, Settings, Help, About, Developer (5x click on the version in About).
- **Navigation:** the backend `osStatus.navigationView` is the source of truth, like the React UI — the native left sidebar and the web top bar stay in sync via `setNavigationView` and the `getOsStatus` long-poll (`location.hash` is only a mirror for refresh/deep-link).
- **Same Rust bridge** as the original (`commandBridge.postMessage`): `getOsStatus` long-poll, `jsonFfiCmd` for login/status/exit list/DNS, `startTunnel`/`stopTunnel`.
- **Dark theme** (light/dark via `color-scheme`) and the official robot logo (`simple-ui/logo.svg`).

Details: [`SIMPLE_UI.md`](SIMPLE_UI.md).

Build and run the simple GUI natively (without Nix/Docker):

```bash
# 1. Generate gresources from simple-ui
mkdir -p /tmp/obscura-gresources
glib-compile-resources --sourcedir=rustlib/src/gui --target=/tmp/obscura-gresources/icons.gresource rustlib/src/gui/icons.gresource.xml
python3 rustlib/gen-gresource-xml.py simple-ui /tmp/webui.generated.xml
glib-compile-resources --target=/tmp/obscura-gresources/webui.gresource /tmp/webui.generated.xml

# 2. Build
OBSCURA_VERSION=v1.177 OBSCURA_GRESOURCES_DIR=/tmp/obscura-gresources cargo build --features gui --bin obscura-gui

# 3. Run (service must be running)
WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 ./rustlib/target/debug/obscura-gui
```

Or use the helper: `./simple-ui/rebuild.sh`

Native wrappers (English, handle `obscura` group):

```bash
./run-service-native.sh  # in one terminal, keep running (requires sudo)
newgrp obscura
./run-cli-native.sh status
./run-cli-native.sh login <account-id>
./run-gui-native.sh
```

### Supported distributions

The released packages support:

- Debian 13
- Ubuntu 26.04
- Fedora 44
- RHEL 10 (requires EPEL)
- Arch Linux

### Building and signing packages

Build all the packages (`obscura-cli`, `obscura-gui`, `obscura`, plus
`obscura-repository` for deb and rpm, `obscura-keyring` for arch) and the signed
apt/dnf/pacman repositories:

```bash
./contrib/bin/linux-build-packages.bash
```

It derives the signing key from `linux/signing_keys/current.public.asc` (exporting its secret
from your gpg keyring) and prompts for its passphrase. Publish the three repository trees it
produces, `result-linux/dist-prod/{deb,rpm,arch}`, at `https://linux-pkgs.obscura.com/{deb,rpm,arch}`.
Pass `--test` to build instead with the committed keys in `linux/signing_keys_test/`.
Pass `--dirty` to build production packages from an untagged or modified tree.

For a quick local `.deb` with the simple UI (without Docker/signing, ready-to-use):

```bash
./contrib/bin/build-simple-deb.bash   # builds -> ./obscura-simple_1.177-6_amd64.deb
sudo apt install ./obscura-simple_1.177-6_amd64.deb
systemctl status obscura.service      # -> active (running)
sudo obscura add-operator $USER && newgrp obscura
```

The script generates gresources from `simple-ui/`, builds release binaries, and stages `DEBIAN/control` + `postinst` (sysusers, preset, enable, start) before running `dpkg-deb`. If the GUI shows `Service starting... unitActivating`, see [Troubleshooting](SIMPLE_UI.md#troubleshooting-service-unavailable--unitactivating).

The official split packages (`obscura-cli`/`obscura-gui`) are also ready-to-use: `linux/deb/rules:5` now installs `obscura-preset.conf:1` and runs `dh_installsystemd:22`, so `systemctl preset` + `start` happen in `postinst`. To build them with the simple UI via Nix: `contrib/bin/linux-build-binaries.bash --simple-ui --release --locked`.

### Signing key rotation

`linux/signing_keys/` holds `current.public.asc` (the public key of the keypair whose
private key signs releases), `next.public.asc` (the public key of the next keypair,
shipped ahead), and `revocation.asc` (the public key of every rotated-out keypair, with
its revocation certificate). It also holds `rotate_signing_key.bash`. The directory is
self-contained: copy it to an ephemeral machine along with the directory of encrypted
private keys, run the script there, and copy `current.public.asc`, `next.public.asc`,
and `revocation.asc` back.

User machines that already trust a rotated-out public key must stop trusting it. The packaging
scripts and the packages they ship handle this automatically; each format uses a
different mechanism:

- **deb**: the keyring file shipped by the `obscura-repository` package is built from just
  `current.public.asc` and `next.public.asc`, and upgrades replace it wholesale, so a
  rotated-out public key disappears from every user machine on its own.
- **rpm**: the `obscura-repository` package ships `RPM-GPG-KEY-obscura`, built from just
  `current.public.asc` and `next.public.asc` (so new installs never trust a rotated-out
  public key), and `RPM-GPG-KEY-obscura-revoked`, listing the fingerprints from `revocation.asc`.
  Its `obscura-package-signing-key-refresh.timer` runs daily, importing
  `RPM-GPG-KEY-obscura` and removing the public keys listed in `RPM-GPG-KEY-obscura-revoked`
  from the rpm database. The timer is needed because upgrading the package only
  replaces the public key files: rpm never re-reads them on its own, and scriptlets cannot
  import public keys while the transaction lock is held.
- **arch**: the `obscura-keyring` package ships `obscura.gpg`, built from
  `current.public.asc`, `next.public.asc`, and `revocation.asc`, plus `obscura-trusted`
  and `obscura-revoked`, listing the fingerprints of the trusted and revoked public keys
  respectively. Its install hook runs `pacman-key --populate obscura` on every install
  and upgrade, which imports the new public keys and disables the revoked ones.

### Nix Setup

- Install [`nix`](https://nixos.org/download/) (only the package manager is needed)
- Enable [`flake`s](https://nixos.wiki/wiki/Flakes)

    Add the following to `~/.config/nix/nix.conf` or `/etc/nix/nix.conf`:

    ```
    experimental-features = nix-command flakes
    ```

- Optional, but strongly recommended: Set up [`nix-direnv`](https://github.com/nix-community/nix-direnv) and integrate it with your preferred shell

  If you do this, you can omit the `nix develop ... --command` parts, as `cd`-ing into the repository directory will set up your environment variables with the correct tools as long as you've `direnv allow`-ed the directory.
