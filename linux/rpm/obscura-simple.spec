Name:           obscura-simple
Version:        %{?version}%{!?version:1.177}
Release:        %{?release}%{!?release:17}
Summary:        Unofficial Obscura VPN CLI, service, and native GUI
License:        LicenseRef-PolyForm-Noncommercial-1.0.0
URL:            https://github.com/gnustella-lab/obscura-simple
Source0:        obscura-simple
Source1:        obscura-simple-gui
Source2:        obscura-simple.service
Source3:        obscura-simple.sysusers
Source4:        obscura-simple.preset
Source5:        obscura-simple.desktop
Source6:        obscura-simple.metainfo.xml
Source7:        obscura-simple-64.png
Source8:        obscura-simple-128.png
Source9:        obscura-simple-256.png
Source10:       LICENSE.md

Requires:       glibc
Requires:       polkit
Requires:       shadow-utils
Requires:       systemd
Requires:       gtk4
Requires:       libadwaita
Requires:       webkitgtk6.0
Requires:       libsoup3
Requires:       tpm2-tss
Requires:       hicolor-icon-theme
Requires:       desktop-file-utils
BuildArch:      x86_64

%description
Obscura Simple is an independent, unofficial Linux client containing the
simple-client CLI, its isolated privileged system service, and native GTK 4 /
libadwaita / WebKitGTK GUI in one RPM. It does not modify or control the
official Obscura service.

%prep

%build

%install
install -Dpm0755 %{SOURCE0} %{buildroot}%{_bindir}/obscura-simple
install -Dpm0755 %{SOURCE1} %{buildroot}%{_bindir}/obscura-simple-gui
install -Dpm0644 %{SOURCE2} %{buildroot}%{_unitdir}/obscura-simple.service
install -Dpm0644 %{SOURCE3} %{buildroot}%{_sysusersdir}/obscura-simple.conf
install -Dpm0644 %{SOURCE4} %{buildroot}%{_presetdir}/80-obscura-simple.preset
install -Dpm0644 %{SOURCE5} %{buildroot}%{_datadir}/applications/io.github.gnustella_lab.obscura_simple.desktop
install -Dpm0644 %{SOURCE6} %{buildroot}%{_datadir}/metainfo/io.github.gnustella_lab.obscura_simple.metainfo.xml
install -Dpm0644 %{SOURCE7} %{buildroot}%{_datadir}/icons/hicolor/64x64/apps/io.github.gnustella_lab.obscura_simple.png
install -Dpm0644 %{SOURCE8} %{buildroot}%{_datadir}/icons/hicolor/128x128/apps/io.github.gnustella_lab.obscura_simple.png
install -Dpm0644 %{SOURCE9} %{buildroot}%{_datadir}/icons/hicolor/256x256/apps/io.github.gnustella_lab.obscura_simple.png
install -Dpm0644 %{SOURCE10} %{buildroot}%{_defaultlicensedir}/%{name}/LICENSE.md

%check
test -x %{buildroot}%{_bindir}/obscura-simple
test -x %{buildroot}%{_bindir}/obscura-simple-gui
grep -q '/run/obscura-simple.sock' %{buildroot}%{_bindir}/obscura-simple
grep -q '/run/obscura-simple.sock' %{buildroot}%{_bindir}/obscura-simple-gui
grep -q '^disable obscura-simple.service$' %{buildroot}%{_presetdir}/80-obscura-simple.preset
grep -q '^ExecStart=/usr/bin/obscura-simple service$' %{buildroot}%{_unitdir}/obscura-simple.service
grep -qE '^Requires:[[:space:]]+polkit[[:space:]]*$' %{_specdir}/obscura-simple.spec
! grep -qE 'systemctl (start|restart|enable)' %{buildroot}%{_unitdir}/obscura-simple.service

%pre
%sysusers_create_package %{name} %{_sysusersdir}/obscura-simple.conf

%post
%systemd_post obscura-simple.service
%{_bindir}/desktop-file-validate %{_datadir}/applications/io.github.gnustella_lab.obscura_simple.desktop >/dev/null 2>&1 || :

%preun
if [ "$1" -eq 0 ]; then
    %systemd_preun obscura-simple.service
fi

%postun
%systemd_postun obscura-simple.service

%files
%license %{_defaultlicensedir}/%{name}/LICENSE.md
%{_bindir}/obscura-simple
%{_bindir}/obscura-simple-gui
%{_unitdir}/obscura-simple.service
%{_sysusersdir}/obscura-simple.conf
%{_presetdir}/80-obscura-simple.preset
%{_datadir}/applications/io.github.gnustella_lab.obscura_simple.desktop
%{_datadir}/metainfo/io.github.gnustella_lab.obscura_simple.metainfo.xml
%{_datadir}/icons/hicolor/*/apps/io.github.gnustella_lab.obscura_simple.png

%changelog
* Sun Sep 13 2026 Obscura Simple contributors <noreply@github.com> - 1.177-17
- Add Fedora 44 RPM containing CLI, isolated service, and native GUI.
- Keep installation passive and preserve the official client/service.
