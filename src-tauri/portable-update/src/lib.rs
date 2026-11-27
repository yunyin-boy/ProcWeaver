#![cfg(windows)]

mod manifest;
mod transaction;

pub use manifest::{stable_version, Edition, Manifest, MAX_ARCHIVE_BYTES, MAX_MANIFEST_BYTES};
pub use semver::Version;
pub use transaction::{
    bootstrap, launch_installer, report_workbench_ready, run_updater, trial_abort_requested,
    workspace, Outcome, ARCHIVE_FILE, MANIFEST_FILE,
};
