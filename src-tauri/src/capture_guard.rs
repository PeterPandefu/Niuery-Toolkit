use std::sync::{Mutex, MutexGuard};

/// 串行化所有捕获工具的“检查并启动”阶段，避免并发入口同时通过空闲检查。
#[derive(Default)]
pub struct CaptureGuardState(Mutex<()>);

impl CaptureGuardState {
    pub fn lock(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.0
            .lock()
            .map_err(|_| "屏幕捕获互斥状态不可用".to_string())
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptureActivity {
    Idle,
    Screenshot,
    Longshot,
    Recording,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptureShortcut {
    Screenshot,
    Longshot,
    Recording,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShortcutDecision {
    Start,
    Ignore,
    StopRecording,
}

/// 捕获快捷键统一决策：已有捕获会话时忽略其他工具，仅保留录屏快捷键停止当前录制。
pub fn decide_shortcut(activity: CaptureActivity, shortcut: CaptureShortcut) -> ShortcutDecision {
    match (activity, shortcut) {
        (CaptureActivity::Idle, _) => ShortcutDecision::Start,
        (CaptureActivity::Recording, CaptureShortcut::Recording) => ShortcutDecision::StopRecording,
        _ => ShortcutDecision::Ignore,
    }
}

#[cfg(test)]
mod tests {
    use super::{decide_shortcut, CaptureActivity, CaptureShortcut, ShortcutDecision};

    #[test]
    fn 空闲时允许启动任意捕获工具() {
        for shortcut in [
            CaptureShortcut::Screenshot,
            CaptureShortcut::Longshot,
            CaptureShortcut::Recording,
        ] {
            assert_eq!(
                decide_shortcut(CaptureActivity::Idle, shortcut),
                ShortcutDecision::Start
            );
        }
    }

    #[test]
    fn 捕获期间忽略其他捕获工具快捷键() {
        let cases = [
            (CaptureActivity::Screenshot, CaptureShortcut::Screenshot),
            (CaptureActivity::Screenshot, CaptureShortcut::Longshot),
            (CaptureActivity::Screenshot, CaptureShortcut::Recording),
            (CaptureActivity::Longshot, CaptureShortcut::Screenshot),
            (CaptureActivity::Longshot, CaptureShortcut::Longshot),
            (CaptureActivity::Longshot, CaptureShortcut::Recording),
            (CaptureActivity::Recording, CaptureShortcut::Screenshot),
            (CaptureActivity::Recording, CaptureShortcut::Longshot),
        ];

        for (activity, shortcut) in cases {
            assert_eq!(
                decide_shortcut(activity, shortcut),
                ShortcutDecision::Ignore
            );
        }
    }

    #[test]
    fn 录屏快捷键可停止当前录制() {
        assert_eq!(
            decide_shortcut(CaptureActivity::Recording, CaptureShortcut::Recording),
            ShortcutDecision::StopRecording
        );
    }
}
