use niuery_toolkit_lib::process_tools::{
    is_protected_target, matches_process_identity, validate_port, ProcessTarget,
};

#[test]
fn rejects_ports_outside_the_iana_range() {
    assert_eq!(
        validate_port(0),
        Err("端口必须在 1 到 65535 之间".to_string())
    );
    assert_eq!(
        validate_port(65_536),
        Err("端口必须在 1 到 65535 之间".to_string())
    );
    assert_eq!(validate_port(1), Ok(1));
    assert_eq!(validate_port(65_535), Ok(65_535));
}

#[test]
fn rejects_a_reused_pid_before_termination() {
    let target = ProcessTarget {
        pid: 9527,
        creation_time: 101,
    };

    assert!(matches_process_identity(&target, 101));
    assert!(!matches_process_identity(&target, 102));
}

#[test]
fn protects_system_current_and_critical_processes() {
    assert!(is_protected_target(0, 9000, false));
    assert!(is_protected_target(4, 9000, false));
    assert!(is_protected_target(9000, 9000, false));
    assert!(is_protected_target(9527, 9000, true));
    assert!(!is_protected_target(9527, 9000, false));
}

#[test]
fn preserves_windows_process_identity_through_javascript_ipc() {
    let target = ProcessTarget {
        pid: 9527,
        creation_time: 134_052_868_280_123_457,
    };
    let value = serde_json::to_value(&target).unwrap();
    assert_eq!(value["creationTime"], "134052868280123457");
    let restored: ProcessTarget = serde_json::from_value(value).unwrap();
    assert_eq!(restored, target);
}

#[cfg(windows)]
mod windows_tests {
    use niuery_toolkit_lib::process_tools::{
        find_file_lock_owners, find_port_owners, folder_lock_owners, terminate_processes,
        ProcessOwner, TerminationStatus,
    };
    use std::io::BufRead;
    use std::os::windows::process::CommandExt;
    use std::path::{Path, PathBuf};
    use std::process::{Child, Command, Stdio};

    struct Fixture {
        child: Option<Child>,
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("占用验证-{}", nanoid::nanoid!()));
            std::fs::create_dir_all(root.join("深层目录")).unwrap();
            std::fs::write(root.join("深层目录").join("测试文件.txt"), "验证内容").unwrap();
            Self { child: None, root }
        }

        fn start(&mut self, script: &str, cwd: Option<&Path>) -> String {
            let mut command = Command::new("powershell.exe");
            command
                .args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    script,
                ])
                .env("RESOURCE_TEST_ROOT", &self.root)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            if let Some(cwd) = cwd {
                command.current_dir(cwd);
            }
            command.creation_flags(0x0800_0000);
            self.child = Some(command.spawn().unwrap());
            let mut line = String::new();
            std::io::BufReader::new(self.child.as_mut().unwrap().stdout.as_mut().unwrap())
                .read_line(&mut line)
                .unwrap();
            assert!(
                !line.trim().is_empty(),
                "测试进程必须完成资源占用后再开始查询"
            );
            line.trim().to_string()
        }

        fn pid(&self) -> u32 {
            self.child.as_ref().unwrap().id()
        }

        fn terminate_owner(&mut self, owners: Vec<ProcessOwner>) {
            // 只结束本测试启动的进程，即使同一资源还有其他占用者。
            let owner = owners
                .into_iter()
                .find(|owner| owner.target.pid == self.pid())
                .expect("必须找到真实测试进程");
            assert!(owner.target.creation_time > 0);
            // 模拟前端查询后通过 JSON IPC 原样回传进程身份。
            let target =
                serde_json::from_str(&serde_json::to_string(&owner.target).unwrap()).unwrap();
            let results = terminate_processes(vec![target]).unwrap();
            assert_eq!(results[0].status, TerminationStatus::Terminated);
            self.child.as_mut().unwrap().wait().unwrap();
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            if let Some(child) = &mut self.child {
                let _ = child.kill();
                let _ = child.wait();
            }
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn releases_real_tcp_and_udp_listeners() {
        for protocol in ["tcp", "udp"] {
            let mut fixture = Fixture::new();
            let script = if protocol == "tcp" {
                "$s = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $s.Start(); [Console]::WriteLine($s.LocalEndpoint.Port); Start-Sleep 90"
            } else {
                "$s = [Net.Sockets.UdpClient]::new(0); [Console]::WriteLine($s.Client.LocalEndPoint.Port); Start-Sleep 90"
            };
            let port: u16 = fixture.start(script, None).parse().unwrap();
            let owners = find_port_owners(u32::from(port)).unwrap();
            assert!(owners.iter().any(|owner| owner.target.pid == fixture.pid()
                && owner
                    .endpoints
                    .iter()
                    .any(|endpoint| endpoint.protocol == protocol)));
            fixture.terminate_owner(owners);
            assert!(!find_port_owners(u32::from(port))
                .unwrap()
                .iter()
                .any(|owner| owner.target.pid == fixture.pid()));
            if protocol == "tcp" {
                assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
            } else {
                assert!(std::net::UdpSocket::bind(("0.0.0.0", port)).is_ok());
            }
        }
    }

    #[test]
    fn releases_a_real_exclusive_file_lock() {
        let mut fixture = Fixture::new();
        fixture.start("$p = Join-Path $env:RESOURCE_TEST_ROOT '深层目录/测试文件.txt'; $f = [IO.File]::Open($p, 'Open', 'ReadWrite', 'None'); [Console]::WriteLine('ready'); Start-Sleep 90", None);
        let path = fixture.root.join("深层目录/测试文件.txt");
        assert!(std::fs::OpenOptions::new().write(true).open(&path).is_err());
        let owners = find_file_lock_owners(path.to_string_lossy().into()).unwrap();
        fixture.terminate_owner(owners);
        assert!(find_file_lock_owners(path.to_string_lossy().into())
            .unwrap()
            .is_empty());
        assert!(std::fs::OpenOptions::new().write(true).open(&path).is_ok());
        std::fs::rename(&path, fixture.root.join("已解锁.txt")).unwrap();
    }

    #[test]
    fn releases_nested_file_locks_and_deduplicates_folder_owners() {
        let mut fixture = Fixture::new();
        fixture.start("$p = Join-Path $env:RESOURCE_TEST_ROOT '深层目录/测试文件.txt'; $f = [IO.File]::Open($p, 'Open', 'ReadWrite', 'None'); $g = [IO.File]::Open((Join-Path $env:RESOURCE_TEST_ROOT '第二个.txt'), 'Create', 'ReadWrite', 'ReadWrite'); [Console]::WriteLine('ready'); Start-Sleep 90", None);
        let path = fixture.root.clone();
        let owners = folder_lock_owners(path.to_str().unwrap()).unwrap();
        assert_eq!(
            owners
                .iter()
                .filter(|owner| owner.target.pid == fixture.pid())
                .count(),
            1
        );
        fixture.terminate_owner(owners);
        assert!(folder_lock_owners(path.to_str().unwrap())
            .unwrap()
            .is_empty());
        std::fs::remove_dir_all(path.join("深层目录")).unwrap();
        let moved = path.with_extension("已解除");
        std::fs::rename(&path, &moved).unwrap();
        fixture.root = moved;
    }

    #[test]
    fn releases_a_directory_used_as_working_directory() {
        let mut fixture = Fixture::new();
        let path = fixture.root.join("深层目录");
        fixture.start("[Console]::WriteLine('ready'); Start-Sleep 90", Some(&path));
        assert!(std::fs::rename(&path, fixture.root.join("重命名后")).is_err());
        let owners = folder_lock_owners(fixture.root.to_str().unwrap()).unwrap();
        fixture.terminate_owner(owners);
        assert!(folder_lock_owners(fixture.root.to_str().unwrap())
            .unwrap()
            .is_empty());
        std::fs::rename(&path, fixture.root.join("重命名后")).unwrap();
    }

    #[test]
    fn validates_folder_targets_and_reports_empty_folders() {
        let fixture = Fixture::new();
        assert!(folder_lock_owners("").unwrap_err().contains("请选择"));
        assert!(folder_lock_owners(fixture.root.join("不存在").to_str().unwrap()).is_err());
        assert!(
            folder_lock_owners(fixture.root.join("深层目录/测试文件.txt").to_str().unwrap())
                .unwrap_err()
                .contains("不能选择文件")
        );
        assert!(folder_lock_owners(fixture.root.to_str().unwrap())
            .unwrap()
            .is_empty());
        assert!(find_file_lock_owners(fixture.root.to_string_lossy().into())
            .unwrap_err()
            .contains("不能选择文件夹"));
    }

    #[test]
    fn does_not_follow_directory_junctions_outside_the_target() {
        let fixture = Fixture::new();
        let mut outside = Fixture::new();
        outside.start("$p = Join-Path $env:RESOURCE_TEST_ROOT '深层目录/测试文件.txt'; $f = [IO.File]::Open($p, 'Open', 'ReadWrite', 'None'); [Console]::WriteLine('ready'); Start-Sleep 90", None);
        let junction = fixture.root.join("外部目录链接");
        let status = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", "New-Item -ItemType Junction -Path $env:RESOURCE_TEST_LINK -Target $env:RESOURCE_TEST_OUTSIDE -ErrorAction Stop | Out-Null"])
            .env("RESOURCE_TEST_LINK", &junction)
            .env("RESOURCE_TEST_OUTSIDE", &outside.root)
            .creation_flags(0x0800_0000)
            .status().unwrap();
        assert!(status.success());
        assert!(folder_lock_owners(fixture.root.to_str().unwrap())
            .unwrap()
            .is_empty());
        assert!(folder_lock_owners(outside.root.to_str().unwrap())
            .unwrap()
            .iter()
            .any(|owner| owner.target.pid == outside.pid()));
        assert!(outside
            .child
            .as_mut()
            .unwrap()
            .try_wait()
            .unwrap()
            .is_none());
        std::fs::remove_dir(junction).unwrap();
    }

    #[test]
    fn refuses_changed_identity_and_protects_the_current_process() {
        let mut fixture = Fixture::new();
        let port: u16 = fixture.start("$s = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $s.Start(); [Console]::WriteLine($s.LocalEndpoint.Port); Start-Sleep 90", None).parse().unwrap();
        let owners = find_port_owners(u32::from(port)).unwrap();
        let mut target = owners
            .iter()
            .find(|owner| owner.target.pid == fixture.pid())
            .unwrap()
            .target
            .clone();
        target.creation_time += 1;
        assert_eq!(
            terminate_processes(vec![target]).unwrap()[0].status,
            TerminationStatus::IdentityChanged
        );
        assert!(fixture
            .child
            .as_mut()
            .unwrap()
            .try_wait()
            .unwrap()
            .is_none());
        fixture.terminate_owner(owners);
        let target = super::ProcessTarget {
            pid: std::process::id(),
            creation_time: 1,
        };
        assert_eq!(
            terminate_processes(vec![target]).unwrap()[0].status,
            TerminationStatus::Protected
        );
    }
}
