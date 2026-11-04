//! Public routing is independent of Mihomo's kernel-wide mode on Windows.
use serde_yaml::Value;

pub const KEY: &str = "procweaver-public-mode";
pub const RULES: &str = "pw-public-rules";
pub fn enabled() -> bool { cfg!(windows) && !crate::edition::PROCESS }
pub fn normalize(mode: &str) -> Result<&'static str, String> {
    match mode.to_ascii_lowercase().as_str() {
        "rule" => Ok("rule"), "global" => Ok("global"), "direct" => Ok("direct"),
        _ => Err("公共模式无效，请选择规则、全局或直连".into()),
    }
}

pub fn compose(raw: &str, mode: &str) -> Result<String, String> {
    if !enabled() { return Ok(raw.into()); }
    let mode = normalize(mode)?;
    let mut yaml: Value = serde_yaml::from_str(raw).map_err(|_| "公共运行配置无效")?;
    if mode != "rule" {
        let target = if mode == "direct" { "DIRECT" } else { "GLOBAL" };
        let mut rules = vec![Value::from(format!("MATCH,{target}"))];
        // Mihomo skips a proxy that cannot carry UDP. Do not then default to DIRECT.
        if mode == "global" { rules.push(Value::from("MATCH,REJECT")); }
        yaml["rules"] = rules.into();
    }
    yaml["mode"] = "rule".into();
    yaml[KEY] = mode.into();
    if yaml["rules"].is_null() { yaml["rules"] = vec![Value::from("MATCH,DIRECT")].into(); }
    let rules = yaml["rules"].clone();
    let map = yaml.as_mapping_mut().ok_or("公共运行配置必须是对象")?;
    let subrules = map.entry(Value::from("sub-rules")).or_insert(Value::Mapping(Default::default()))
        .as_mapping_mut().ok_or("sub-rules 必须是对象")?;
    if subrules.insert(RULES.into(), rules).is_some() { return Err("订阅使用了公共规则保留名称".into()); }
    serde_yaml::to_string(&yaml).map_err(|_| "生成公共模式失败".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_modes_keep_kernel_rule_and_share_exact_sandbox_fallback() {
        if !enabled() { return; }
        for (mode, expected) in [("rule", "MATCH,REJECT"), ("global", "MATCH,GLOBAL"), ("direct", "MATCH,DIRECT")] {
            let yaml: Value = serde_yaml::from_str(&compose("mode: global\nproxy-groups: [{name: PROXY, type: select, proxies: [DIRECT]}]\nrules: ['MATCH,REJECT']\n", mode).unwrap()).unwrap();
            assert_eq!(yaml["mode"].as_str(), Some("rule"));
            assert_eq!(yaml[KEY].as_str(), Some(mode));
            assert_eq!(yaml["rules"][0].as_str(), Some(expected));
            if mode == "global" { assert_eq!(yaml["rules"][1].as_str(), Some("MATCH,REJECT")); }
            assert_eq!(yaml["sub-rules"][RULES], yaml["rules"]);
        }
        assert!(normalize("other").is_err());
    }
}
