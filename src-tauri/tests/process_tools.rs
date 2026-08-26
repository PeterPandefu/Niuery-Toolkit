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
