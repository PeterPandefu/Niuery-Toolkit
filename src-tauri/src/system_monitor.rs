use serde::Serialize;
use std::sync::Mutex;
use std::time::Instant;
use sysinfo::{Networks, System};
use tauri::State;

#[derive(Debug, Serialize, Clone)]
pub struct SystemStats {
    pub cpu_usage: f32,
    pub cpu_count: usize,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub network_received_bytes_per_sec: u64,
    pub network_transmitted_bytes_per_sec: u64,
    pub uptime_seconds: u64,
    pub host_name: Option<String>,
}

pub struct SystemMonitorState {
    system: Mutex<System>,
    networks: Mutex<Networks>,
    last_network: Mutex<(u64, u64, Instant)>,
}

impl Default for SystemMonitorState {
    fn default() -> Self {
        let mut system = System::new_all();
        system.refresh_all();
        let networks = Networks::new_with_refreshed_list();
        Self {
            system: Mutex::new(system),
            networks: Mutex::new(networks),
            last_network: Mutex::new((0, 0, Instant::now())),
        }
    }
}

#[tauri::command]
pub fn get_system_stats(state: State<'_, SystemMonitorState>) -> Result<SystemStats, String> {
    let mut system = state
        .system
        .lock()
        .map_err(|_| "系统监控状态不可用".to_string())?;
    system.refresh_cpu_usage();
    system.refresh_memory();

    let mut networks = state
        .networks
        .lock()
        .map_err(|_| "网络监控状态不可用".to_string())?;
    networks.refresh(true);
    let (received, transmitted) = networks.values().fold((0_u64, 0_u64), |(rx, tx), network| {
        (
            rx.saturating_add(network.received()),
            tx.saturating_add(network.transmitted()),
        )
    });

    let mut last = state
        .last_network
        .lock()
        .map_err(|_| "网络监控状态不可用".to_string())?;
    let elapsed = last.2.elapsed().as_secs_f64().max(0.1);
    let is_first_sample = last.0 == 0 && last.1 == 0;
    let rx_rate = if is_first_sample {
        0
    } else {
        ((received.saturating_sub(last.0) as f64) / elapsed) as u64
    };
    let tx_rate = if is_first_sample {
        0
    } else {
        ((transmitted.saturating_sub(last.1) as f64) / elapsed) as u64
    };
    *last = (received, transmitted, Instant::now());

    Ok(SystemStats {
        cpu_usage: system.global_cpu_usage(),
        cpu_count: system.cpus().len(),
        memory_used_bytes: system.used_memory(),
        memory_total_bytes: system.total_memory(),
        network_received_bytes_per_sec: rx_rate,
        network_transmitted_bytes_per_sec: tx_rate,
        uptime_seconds: System::uptime(),
        host_name: System::host_name(),
    })
}
