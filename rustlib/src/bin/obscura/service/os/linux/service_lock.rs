use crate::service::os::linux::start_error::LinuxServiceStartError;
use std::fs::{File, TryLockError};
use std::io::ErrorKind;

// Intentionally shared with the official client: only one VPN backend may own
// routing, DNS and firewall state at a time. Never rename or unlink this lock.
const LOCK_PATH: &str = "/run/obscura.lock";

pub struct ServiceLock {
    _file: File,
}

impl ServiceLock {
    pub fn new() -> Result<Self, LinuxServiceStartError> {
        Self::open(std::path::Path::new(LOCK_PATH))
    }

    fn open(path: &std::path::Path) -> Result<Self, LinuxServiceStartError> {
        let mut options = File::options();
        options.create(true).write(true).read(true);
        let file = options.open(path).map_err(|error| {
            tracing::error!(message_id = "muFNujy4", ?error, "failed to create or open lock file: {error}");
            match error.kind() {
                ErrorKind::PermissionDenied => LinuxServiceStartError::InsufficientPermissions,
                _ => anyhow::Error::new(error).context("failed to create or open lock file").into(),
            }
        })?;
        file.try_lock().map_err(|error| {
            tracing::error!(message_id = "wwkKzjFi", ?error, "failed to take exclusive lock on lock file: {error}");
            match error {
                TryLockError::WouldBlock => LinuxServiceStartError::AlreadyRunning,
                error => anyhow::Error::new(error).context("failed to take exclusive lock on lock file").into(),
            }
        })?;
        Ok(Self { _file: file })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_lock_rejects_a_second_backend_until_owner_exits() {
        assert_eq!(LOCK_PATH, "/run/obscura.lock");
        let temp = tempfile::NamedTempFile::new().unwrap();
        let first = ServiceLock::open(temp.path()).unwrap();
        assert!(matches!(ServiceLock::open(temp.path()), Err(LinuxServiceStartError::AlreadyRunning)));
        drop(first);
        assert!(ServiceLock::open(temp.path()).is_ok());
    }
}
