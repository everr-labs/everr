use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    os::{
        fd::{AsFd, AsRawFd, OwnedFd},
        unix::{
            fs::{DirBuilderExt, OpenOptionsExt},
            net::UnixStream,
        },
    },
    path::{Path, PathBuf},
    thread::JoinHandle,
};

use anyhow::{Context, Result};
use fs2::FileExt;

const MAX_BYTES: u64 = 5 * 1024 * 1024;
const BACKUPS: usize = 3;

pub(super) fn path() -> Result<PathBuf> {
    let dir = if let Some(dir) = std::env::var_os("EVERR_LOCAL_LOG_DIR").filter(|d| !d.is_empty()) {
        PathBuf::from(dir)
    } else {
        let home = dirs::home_dir().context("resolve home directory for local logs")?;
        default_dir(
            &home,
            std::env::var_os("XDG_STATE_HOME").as_deref(),
            cfg!(target_os = "macos"),
        )
    };
    Ok(dir.join("local.log"))
}

fn default_dir(home: &Path, state: Option<&std::ffi::OsStr>, macos: bool) -> PathBuf {
    let base = if macos {
        home.join("Library/Logs")
    } else {
        state
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .unwrap_or_else(|| home.join(".local/state"))
    };
    base.join(if cfg!(debug_assertions) {
        "everr-dev"
    } else {
        "everr"
    })
}

/// Owns capture for the detached supervisor, including collector output.
pub struct Capture {
    saved: [OwnedFd; 2],
    worker: Option<JoinHandle<io::Result<()>>>,
}

impl Capture {
    pub fn start() -> Result<Option<Self>> {
        if std::env::var_os(super::local_lifecycle::BACKGROUND_INSTANCE_ID).is_none() {
            return Ok(None);
        }
        let log = RotatingLog::open(path()?)?;
        let (mut reader, writer) = UnixStream::pair()?;
        let saved = [
            io::stdout().as_fd().try_clone_to_owned()?,
            io::stderr().as_fd().try_clone_to_owned()?,
        ];
        redirect(writer.as_raw_fd(), 1)?;
        if let Err(error) = redirect(writer.as_raw_fd(), 2) {
            let _ = redirect(saved[0].as_raw_fd(), 1);
            return Err(error.into());
        }
        drop(writer);
        let worker = std::thread::spawn(move || {
            let mut log = log;
            let mut bytes = [0; 8192];
            loop {
                let count = match reader.read(&mut bytes) {
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    result => result?,
                };
                if count == 0 {
                    return Ok(());
                }
                log.write(&bytes[..count])?;
            }
        });
        Ok(Some(Self {
            saved,
            worker: Some(worker),
        }))
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        let _ = io::stdout().flush();
        let _ = io::stderr().flush();
        for (index, fd) in self.saved.iter().enumerate() {
            let _ = redirect(fd.as_raw_fd(), index as i32 + 1);
        }
        if let Some(worker) = self.worker.take() {
            if !matches!(worker.join(), Ok(Ok(()))) {
                eprintln!("could not finish writing the local supervisor log");
            }
        }
    }
}

fn redirect(from: i32, to: i32) -> io::Result<()> {
    // Both descriptors are live; dup2 atomically replaces only stdout or stderr.
    if unsafe { nix::libc::dup2(from, to) } < 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

struct RotatingLog {
    path: PathBuf,
    file: File,
    size: u64,
    _lock: File,
}

impl RotatingLog {
    fn open(path: PathBuf) -> Result<Self> {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path.parent().unwrap())
            .context("create local log directory")?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .mode(0o600)
            .open(path.with_extension("log.lock"))?;
        lock.try_lock_exclusive().context("another instance is writing to this local log directory; use EVERR_LOCAL_LOG_DIR for a separate instance")?;
        let mut file = Self::open_file(&path)?;
        let mut size = file.metadata()?.len();
        if size > MAX_BYTES {
            file.seek(SeekFrom::Start(size - MAX_BYTES))?;
            let mut tail = Vec::new();
            (&mut file).take(MAX_BYTES).read_to_end(&mut tail)?;
            file.set_len(0)?;
            file.write_all(&tail)?;
            size = MAX_BYTES;
        }
        Ok(Self {
            path,
            file,
            size,
            _lock: lock,
        })
    }

    fn open_file(path: &Path) -> io::Result<File> {
        OpenOptions::new()
            .create(true)
            .read(true)
            .append(true)
            .mode(0o600)
            .open(path)
    }

    fn rotate(&mut self) -> io::Result<()> {
        for index in (1..=BACKUPS).rev() {
            let from = if index == 1 {
                self.path.clone()
            } else {
                self.path.with_extension(format!("log.{}", index - 1))
            };
            let to = self.path.with_extension(format!("log.{index}"));
            match fs::rename(from, to) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        self.file = Self::open_file(&self.path)?;
        self.size = 0;
        Ok(())
    }

    fn write(&mut self, mut bytes: &[u8]) -> io::Result<()> {
        while !bytes.is_empty() {
            if self.size >= MAX_BYTES {
                self.rotate()?;
            }
            let count = bytes.len().min((MAX_BYTES - self.size) as usize);
            self.file.write_all(&bytes[..count])?;
            self.size += count as u64;
            bytes = &bytes[count..];
        }
        Ok(())
    }
}

pub(super) fn tail(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(file.metadata()?.len().saturating_sub(8192)))?;
    let mut bytes = Vec::new();
    file.take(8192).read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_follow_platform_conventions_and_ignore_relative_xdg_paths() {
        let home = Path::new("/home/test");
        let app = if cfg!(debug_assertions) {
            "everr-dev"
        } else {
            "everr"
        };
        assert_eq!(
            default_dir(home, None, true),
            home.join("Library/Logs").join(app)
        );
        assert_eq!(
            default_dir(home, None, false),
            home.join(".local/state").join(app)
        );
        assert_eq!(
            default_dir(home, Some("relative".as_ref()), false),
            default_dir(home, None, false)
        );
        assert_eq!(
            default_dir(home, Some("/state".as_ref()), false),
            Path::new("/state").join(app)
        );
    }

    #[test]
    fn rotation_bounds_storage_preserves_order_and_excludes_competing_writers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("local.log");
        let mut log = RotatingLog::open(path.clone()).unwrap();
        assert!(RotatingLog::open(path.clone()).is_err());
        for byte in b'a'..=b'f' {
            log.write(&vec![byte; MAX_BYTES as usize]).unwrap();
        }
        log.write(b"latest").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"latest");
        for (index, byte) in [b'f', b'e', b'd'].into_iter().enumerate() {
            assert_eq!(
                fs::read(path.with_extension(format!("log.{}", index + 1))).unwrap(),
                vec![byte; MAX_BYTES as usize]
            );
        }
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), BACKUPS + 2);
        drop(log);
        let mut log = RotatingLog::open(path.clone()).unwrap();
        log.write(b" again").unwrap();
        assert_eq!(tail(&path).unwrap(), "latest again");
    }

    #[test]
    fn oversized_existing_log_keeps_recent_output_and_new_logs_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("logs/local.log");
        let log = RotatingLog::open(path.clone()).unwrap();
        assert_eq!(
            fs::metadata(path.parent().unwrap())
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        drop(log);
        let mut bytes = vec![b'x'; MAX_BYTES as usize + 100];
        bytes.extend_from_slice(b"recent");
        fs::write(&path, bytes).unwrap();
        let mut log = RotatingLog::open(path.clone()).unwrap();
        assert_eq!(fs::metadata(&path).unwrap().len(), MAX_BYTES);
        assert!(tail(&path).unwrap().ends_with("recent"));
        log.write(b"new output").unwrap();
        assert_eq!(
            fs::metadata(path.with_extension("log.1")).unwrap().len(),
            MAX_BYTES
        );
        assert_eq!(fs::read(&path).unwrap(), b"new output");
    }
}
