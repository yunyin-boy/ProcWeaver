use base64::{
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD},
    Engine as _,
};
use percent_encoding::percent_decode_str;
use reqwest::header::{HeaderMap, CONTENT_DISPOSITION};

const GENERIC_FILENAMES: &[&str] = &[
    "clash",
    "config",
    "configuration",
    "default",
    "download",
    "mihomo",
    "profile",
    "subscribe",
    "subscription",
    "订阅",
    "订阅配置",
    "配置",
];

pub(super) fn resolve(entered: &str, headers: &HeaderMap, source_host: &str) -> String {
    let entered = entered.trim();
    if !entered.is_empty() {
        return entered.to_owned();
    }
    headers
        .get("profile-title")
        .and_then(|value| std::str::from_utf8(value.as_bytes()).ok())
        .and_then(profile_title)
        .or_else(|| {
            headers
                .get(CONTENT_DISPOSITION)
                .and_then(|value| std::str::from_utf8(value.as_bytes()).ok())
                .and_then(disposition_name)
        })
        .unwrap_or_else(|| source_host.to_owned())
}

fn displayable_name(name: &str) -> Option<&str> {
    let name = name.trim();
    (!name.is_empty() && name.len() <= 240 && !name.chars().any(char::is_control)).then_some(name)
}

fn profile_title(value: &str) -> Option<String> {
    let value = value.trim();
    let Some((_, encoded)) = value
        .split_once(':')
        .filter(|(kind, _)| kind.eq_ignore_ascii_case("base64"))
    else {
        return displayable_name(value).map(str::to_owned);
    };
    let encoded = encoded.trim();
    let bytes = STANDARD
        .decode(encoded)
        .or_else(|_| STANDARD_NO_PAD.decode(encoded))
        .ok()?;
    displayable_name(std::str::from_utf8(&bytes).ok()?).map(str::to_owned)
}

fn disposition_name(value: &str) -> Option<String> {
    let mut quoted = false;
    let mut escaped = false;
    let parameters = value.split(|ch| {
        let separator = ch == ';' && !quoted;
        if escaped {
            escaped = false;
        } else if quoted && ch == '\\' {
            escaped = true;
        } else if ch == '"' {
            quoted = !quoted;
        }
        separator
    });
    let mut extended = None;
    let mut plain = None;
    for parameter in parameters.skip(1) {
        let Some((key, value)) = parameter.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.eq_ignore_ascii_case("filename*") && extended.is_none() {
            extended = extended_filename(value.trim()).and_then(|name| filename_label(&name));
        } else if key.eq_ignore_ascii_case("filename") && plain.is_none() {
            plain = unquote_filename(value.trim()).and_then(|name| filename_label(&name));
        }
    }
    extended.or(plain)
}

fn unquote_filename(value: &str) -> Option<String> {
    if !value.starts_with('"') {
        return Some(value.to_owned());
    }
    let mut chars = value.strip_prefix('"')?.strip_suffix('"')?.chars();
    let mut unquoted = String::new();
    while let Some(ch) = chars.next() {
        unquoted.push(if ch == '\\' { chars.next()? } else { ch });
    }
    Some(unquoted)
}

fn extended_filename(value: &str) -> Option<String> {
    let (charset, rest) = value.split_once('\'')?;
    let (_, encoded) = rest.split_once('\'')?;
    let valid_escapes = encoded.split('%').skip(1).all(|part| {
        part.as_bytes()
            .get(..2)
            .is_some_and(|bytes| bytes.iter().all(u8::is_ascii_hexdigit))
    });
    if !valid_escapes {
        return None;
    }
    let bytes = percent_decode_str(encoded);
    if charset.eq_ignore_ascii_case("utf-8") {
        bytes.decode_utf8().ok().map(|name| name.into_owned())
    } else if charset.eq_ignore_ascii_case("iso-8859-1") {
        Some(bytes.map(char::from).collect())
    } else {
        None
    }
}

fn filename_label(value: &str) -> Option<String> {
    let filename = value.rsplit(['/', '\\']).next()?.trim();
    let name = match filename.rsplit_once('.') {
        Some((stem, extension))
            if matches!(
                extension.to_ascii_lowercase().as_str(),
                "yaml" | "yml" | "json" | "txt"
            ) =>
        {
            stem
        }
        _ => filename,
    };
    let name = displayable_name(name)?;
    (name.chars().any(|ch| ch != '.')
        && !GENERIC_FILENAMES
            .iter()
            .any(|generic| name.eq_ignore_ascii_case(generic)))
    .then(|| name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::HeaderValue;

    #[test]
    fn manual_name_precedes_response_title_and_download_filename() {
        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_DISPOSITION,
            HeaderValue::from_static("attachment; filename=backup.yaml"),
        );
        headers.insert(
            "profile-title",
            HeaderValue::from_str(&format!("base64:{}", STANDARD.encode("  星云网络  "))).unwrap(),
        );
        assert_eq!(
            resolve(" 我的订阅 ", &headers, "sub.example.test"),
            "我的订阅"
        );
        assert_eq!(resolve("  ", &headers, "sub.example.test"), "星云网络");

        headers.insert(
            "profile-title",
            HeaderValue::from_bytes("云端订阅".as_bytes()).unwrap(),
        );
        assert_eq!(resolve("", &headers, "sub.example.test"), "云端订阅");
        headers.insert("profile-title", HeaderValue::from_static("base64:??"));
        assert_eq!(resolve("", &headers, "sub.example.test"), "backup");
    }

    #[test]
    fn response_filename_accepts_quotes_and_prefers_the_encoded_name() {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_DISPOSITION, HeaderValue::from_static(
            "inline; filename=\"Plan; Gold.yaml\"; filename*=UTF-8'zh'%E6%98%9F%E4%BA%91+Pro.YML",
        ));
        assert_eq!(resolve("", &headers, "sub.example.test"), "星云+Pro");

        headers.insert(CONTENT_DISPOSITION, HeaderValue::from_static(
            "attachment; filename*=UTF-8''broken%XX.yml; filename=\"dir/Plan; \\\"Gold\\\".yaml\"",
        ));
        assert_eq!(resolve("", &headers, "sub.example.test"), "Plan; \"Gold\"");
    }

    #[test]
    fn missing_and_generic_metadata_use_the_original_host() {
        let mut headers = HeaderMap::new();
        assert_eq!(
            resolve("", &headers, "sub.example.test"),
            "sub.example.test"
        );
        headers.insert(
            CONTENT_DISPOSITION,
            HeaderValue::from_static(
                "attachment; filename=SUBSCRIBE.YAML; filename*=UTF-8''config.yml",
            ),
        );
        headers.insert("profile-title", HeaderValue::from_static("base64:ICAg"));
        assert_eq!(
            resolve("\t ", &headers, "sub.example.test"),
            "sub.example.test"
        );
    }
}
