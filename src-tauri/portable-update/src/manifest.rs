use base64::{engine::general_purpose::STANDARD, Engine};
use ring::{digest, signature};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{self, Read, Seek},
    path::Path,
};

pub const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
pub const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
pub(crate) const UPDATER_EXE: &str = "ProcWeaverUpdater.exe";
pub(crate) const DEFAULT_CONFIG: &str = "data/config/default.yaml";
const PUBLISHER_KEY: &str = include_str!("publisher.hex");

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Edition {
    Full,
    Process,
}

impl Edition {
    pub fn name(self) -> &'static str {
        match self {
            Self::Full => "ProcWeaver",
            Self::Process => "ProcWeaverProcess",
        }
    }

    pub fn executable(self) -> &'static str {
        match self {
            Self::Full => "ProcWeaver.exe",
            Self::Process => "ProcWeaverProcess.exe",
        }
    }

    pub fn portable_marker(self) -> &'static str {
        match self {
            Self::Full => "portable",
            Self::Process => "process-portable",
        }
    }

    pub fn package_name(self, version: &Version) -> String {
        format!("{}_v{version}_x64_Portable.zip", self.name())
    }

    pub fn manifest_name(self, version: &Version) -> String {
        format!("{}_v{version}_x64_Portable.update.json", self.name())
    }
}

pub fn stable_version(value: &str) -> Option<Version> {
    let parsed = Version::parse(value.trim_start_matches(['v', 'V'])).ok()?;
    (parsed.pre.is_empty() && parsed.build.is_empty()).then_some(parsed)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignedManifest {
    manifest: String,
    signature: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub schema: u32,
    pub edition: Edition,
    pub version: String,
    pub architecture: String,
    pub package: String,
    pub bytes: u64,
    pub sha256: String,
    pub files: Vec<PayloadFile>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayloadFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

fn hex_bytes(encoded: &str, length: usize) -> Option<Vec<u8>> {
    if encoded.len() != length * 2 || !encoded.bytes().all(|digit| digit.is_ascii_hexdigit()) {
        return None;
    }
    (0..encoded.len()).step_by(2)
        .map(|offset| u8::from_str_radix(&encoded[offset..offset + 2], 16).ok())
        .collect()
}

fn valid_release_path(path: &str, edition: Edition) -> bool {
    if path.is_empty() || path.len() > 220 || !path.split('/').all(valid_component) {
        return false;
    }
    matches!(path, UPDATER_EXE | "LICENSE" | "README.md" | "README.txt")
        || path == edition.executable()
        || path == edition.portable_marker()
        || (edition == Edition::Full && path == DEFAULT_CONFIG)
        || path.starts_with("binaries/")
        || path.starts_with("licenses/")
}

fn valid_component(part: &str) -> bool {
    if !part.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
        || part.ends_with([' ', '.'])
        || !part.bytes().all(|digit| digit.is_ascii_alphanumeric() || b" ._-".contains(&digit))
    {
        return false;
    }
    let device = part.split('.').next().unwrap_or_default().trim_end().to_ascii_uppercase();
    !matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        && !(device.len() == 4 && (device.starts_with("COM") || device.starts_with("LPT"))
            && device.as_bytes()[3].is_ascii_digit())
}

impl Manifest {
    pub fn verify(envelope: &[u8], edition: Edition, version: &Version) -> Result<Self, String> {
        if envelope.len() as u64 > MAX_MANIFEST_BYTES {
            return Err("更新签名清单超过大小限制".into());
        }
        let signed: SignedManifest = serde_json::from_slice(envelope)
            .map_err(|_| "更新签名清单格式无效")?;
        let bytes = STANDARD.decode(signed.manifest).map_err(|_| "更新清单编码无效")?;
        let signature = STANDARD.decode(signed.signature).map_err(|_| "更新签名编码无效")?;
        let public_key = hex_bytes(PUBLISHER_KEY.trim(), 65).ok_or("更新公钥格式无效")?;
        signature::UnparsedPublicKey::new(&signature::ECDSA_P256_SHA256_FIXED, public_key)
            .verify(&bytes, &signature)
            .map_err(|_| "发布者签名校验失败")?;
        let manifest: Self = serde_json::from_slice(&bytes).map_err(|_| "更新清单格式无效")?;
        if manifest.schema != 1 || manifest.edition != edition || manifest.version != version.to_string()
            || manifest.architecture != "x64" || manifest.package != edition.package_name(version)
            || manifest.bytes == 0 || manifest.bytes > MAX_ARCHIVE_BYTES
            || hex_bytes(&manifest.sha256, 32).is_none()
        {
            return Err("更新清单与当前版本类型或目标版本不符".into());
        }
        manifest.file_index()?;
        Ok(manifest)
    }

    fn file_index(&self) -> Result<BTreeMap<String, &PayloadFile>, String> {
        let mut files = BTreeMap::new();
        let mut bytes = 0u64;
        if self.files.len() > 256 {
            return Err("更新包文件数超过限制".into());
        }
        for file in &self.files {
            bytes = bytes.checked_add(file.bytes).ok_or("更新包解压大小无效")?;
            if bytes > 2 * MAX_ARCHIVE_BYTES || hex_bytes(&file.sha256, 32).is_none()
                || !valid_release_path(&file.path, self.edition)
                || files.insert(file.path.to_ascii_lowercase(), file).is_some()
            {
                return Err(format!("更新清单包含无效或重复的文件 {}", file.path));
            }
        }
        let required = [self.edition.executable(), UPDATER_EXE, self.edition.portable_marker(), "LICENSE"];
        for name in required {
            if files.get(&name.to_ascii_lowercase()).is_none_or(|entry| entry.path != name) {
                return Err(format!("更新包缺少 {name}"));
            }
        }
        if self.edition == Edition::Full && !files.contains_key(DEFAULT_CONFIG) {
            return Err("完整版更新包缺少基础配置".into());
        }
        for name in files.keys() {
            if name.match_indices('/').any(|(end, _)| files.contains_key(&name[..end])) {
                return Err(format!("更新包文件与目录冲突 {name}"));
            }
        }
        Ok(files)
    }

    pub(crate) fn unpack(&self, archive: &Path, destination: &Path) -> Result<(), String> {
        let mut source = File::open(archive).map_err(file_error)?;
        if source.metadata().map_err(file_error)?.len() != self.bytes
            || !hash_matches(&mut source, &self.sha256).map_err(file_error)?
        {
            return Err("更新包 SHA-256 校验失败".into());
        }
        source.rewind().map_err(file_error)?;
        let mut zip = zip::ZipArchive::new(source).map_err(|error| format!("无法读取更新包 {error}"))?;
        let mut files = self.file_index()?;
        if zip.len() > 512 {
            return Err("更新压缩包条目数超过限制".into());
        }
        for index in 0..zip.len() {
            let mut member = zip.by_index(index).map_err(|_| "无法读取更新包文件")?;
            let name = member.name().map_err(|_| "更新包文件名无效")?.into_owned();
            if member.is_dir() && !member.is_symlink()
                && name.ends_with('/') && self.files.iter().any(|file| file.path.starts_with(&name))
            { continue; }
            let file = files.remove(&name.to_ascii_lowercase())
                .filter(|file| file.path == name && file.bytes == member.size() && member.is_file())
                .ok_or_else(|| format!("更新包文件与签名清单不符 {name}"))?;
            let path = destination.join(&file.path);
            fs::create_dir_all(path.parent().expect("staged path has parent")).map_err(file_error)?;
            let mut output = File::create_new(&path).map_err(file_error)?;
            let received = io::copy(&mut member.by_ref().take(file.bytes + 1), &mut output).map_err(file_error)?;
            output.sync_all().map_err(file_error)?;
            if received != file.bytes || !hash_matches(File::open(&path).map_err(file_error)?, &file.sha256).map_err(file_error)? {
                return Err(format!("更新包文件校验失败 {name}"));
            }
        }
        if !files.is_empty() {
            return Err("更新包缺少签名清单中的文件".into());
        }
        Ok(())
    }
}

pub(crate) fn file_error(error: io::Error) -> String {
    error.to_string()
}

pub(crate) fn hash_matches(mut reader: impl Read, expected: &str) -> io::Result<bool> {
    let mut digest = digest::Context::new(&digest::SHA256);
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 { break; }
        digest.update(&buffer[..read]);
    }
    Ok(hex_bytes(expected, 32).is_some_and(|expected| digest.finish().as_ref() == expected))
}
