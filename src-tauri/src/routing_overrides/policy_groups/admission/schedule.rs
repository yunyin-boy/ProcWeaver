use super::{
    eligible, AutoMember, Conditions, DelayResult, Entry, Group, ProfileGroups, Reading, Sample,
    MAX_NODES,
};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, MutexGuard, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const BATCH_SIZE: usize = 32;
const RETRY_AFTER: Duration = Duration::from_secs(20);
const FAILURES_TO_REMOVE: u8 = 2;

#[derive(PartialEq, Eq)]
pub(super) struct Scope {
    profile: String,
    url: String,
    pid: u32,
}

impl Scope {
    pub(super) fn new(profile: &str, url: &str, pid: u32) -> Self {
        Self {
            profile: profile.into(),
            url: url.into(),
            pid,
        }
    }
}

#[derive(Default)]
pub(super) struct Schedules {
    scope: Option<Scope>,
    groups: HashMap<String, Schedule>,
}

struct Schedule {
    conditions: Conditions,
    manual_members: Vec<String>,
    next_full: Instant,
    known: HashMap<String, NodeCheck>,
    round: Option<Round>,
    last: Option<Report>,
    apply_error: Option<(String, Instant)>,
}

#[derive(Default, Clone, Copy)]
struct NodeCheck {
    failures: u8,
    retry_at: Option<Instant>,
}

#[derive(Default)]
struct Round {
    full: bool,
    pending: HashSet<String>,
    readings: HashMap<String, Reading>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MemberChange {
    name: String,
    reason: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct Report {
    checked_at: u64,
    added: Vec<MemberChange>,
    removed: Vec<MemberChange>,
    incomplete: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::routing_overrides::policy_groups) struct CheckStatus {
    checking: bool,
    next_at: Option<u64>,
    last: Option<Report>,
    error: Option<String>,
}

static SCHEDULES: OnceLock<Mutex<Schedules>> = OnceLock::new();

pub(super) fn schedules() -> MutexGuard<'static, Schedules> {
    SCHEDULES
        .get_or_init(|| Mutex::new(Schedules::default()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn timestamp(delay: Duration) -> u64 {
    (SystemTime::now() + delay)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(in crate::routing_overrides::policy_groups) fn check_status(
    profile: &str,
    url: &str,
    group: &Group,
    running: bool,
) -> Option<CheckStatus> {
    group.automatic.as_ref()?;
    let state = schedules();
    let current = state
        .scope
        .as_ref()
        .is_some_and(|scope| scope.profile == profile && scope.url == url);
    let schedule = current
        .then(|| state.groups.get(&group.name))
        .flatten()
        .filter(|schedule| schedule.matches(group));
    let checking = running
        && schedule
            .is_some_and(|schedule| schedule.round.is_some() && schedule.apply_error.is_none());
    let next_at = (running && !checking).then(|| {
        timestamp(schedule.map_or(Duration::ZERO, |schedule| {
            schedule.next().saturating_duration_since(Instant::now())
        }))
    });
    Some(CheckStatus {
        checking,
        next_at,
        last: schedule.and_then(|schedule| schedule.last.clone()),
        error: schedule.and_then(|schedule| {
            schedule
                .apply_error
                .as_ref()
                .map(|(error, _)| error.clone())
        }),
    })
}

impl Schedule {
    fn new(group: &Group, conditions: &Conditions, now: Instant) -> Self {
        Self {
            conditions: conditions.clone(),
            manual_members: group.members.clone(),
            next_full: now,
            known: HashMap::new(),
            round: None,
            last: None,
            apply_error: None,
        }
    }

    fn matches(&self, group: &Group) -> bool {
        group.automatic.as_ref() == Some(&self.conditions) && group.members == self.manual_members
    }

    fn next(&self) -> Instant {
        if let Some((_, retry_at)) = &self.apply_error {
            return *retry_at;
        }
        self.known
            .values()
            .filter_map(|node| node.retry_at)
            .fold(self.next_full, Instant::min)
    }

    fn backing_off(&self, now: Instant) -> bool {
        self.apply_error
            .as_ref()
            .is_some_and(|(_, retry_at)| *retry_at > now)
    }
}

pub(super) struct Batch {
    pub(super) entries: Vec<Entry>,
    pub(super) more: bool,
    pub(super) started: bool,
    pub(super) ready: bool,
}

pub(super) struct Completed {
    group: String,
    full: bool,
    observed: HashMap<String, NodeCheck>,
    report: Report,
}

impl Schedules {
    fn enter(&mut self, scope: Scope) {
        if self.scope.as_ref() != Some(&scope) {
            self.scope = Some(scope);
            self.groups.clear();
        }
    }

    fn group(&mut self, group: &Group, conditions: &Conditions, now: Instant) -> &mut Schedule {
        let schedule = self
            .groups
            .entry(group.name.clone())
            .or_insert_with(|| Schedule::new(group, conditions, now));
        if !schedule.matches(group) {
            *schedule = Schedule::new(group, conditions, now);
        }
        schedule
    }

    pub(super) fn request(&mut self, scope: Scope, group: &Group, conditions: &Conditions) {
        let now = Instant::now();
        self.enter(scope);
        let schedule = self.group(group, conditions, now);
        schedule.next_full = now;
        schedule.apply_error = None;
    }

    pub(super) fn retain_saved(&mut self, profile: &str, groups: &[Group]) {
        if self
            .scope
            .as_ref()
            .is_some_and(|scope| scope.profile == profile)
        {
            self.groups.retain(|name, schedule| {
                groups
                    .iter()
                    .any(|group| &group.name == name && schedule.matches(group))
            });
        }
    }

    pub(super) fn until_next(&self) -> Option<Duration> {
        self.groups
            .values()
            .map(Schedule::next)
            .min()
            .map(|next| next.saturating_duration_since(Instant::now()))
    }

    pub(super) fn prepare(
        &mut self,
        scope: Scope,
        profile: &ProfileGroups,
        entries: &[Entry],
    ) -> Batch {
        let now = Instant::now();
        self.enter(scope);
        let automatic: HashSet<_> = profile
            .groups
            .iter()
            .filter(|group| group.automatic.is_some())
            .map(|group| &group.name)
            .collect();
        self.groups.retain(|name, _| automatic.contains(name));
        let mut pending = HashSet::new();
        let mut started = false;
        let mut ready = false;
        for group in &profile.groups {
            let Some(conditions) = &group.automatic else {
                continue;
            };
            let schedule = self.group(group, conditions, now);
            if schedule.backing_off(now) {
                continue;
            }
            let eligible: HashSet<_> = eligible(group, entries)
                .map(|(_, node)| node.identity.as_str())
                .collect();
            schedule
                .known
                .retain(|id, _| eligible.contains(id.as_str()));
            let full = now >= schedule.next_full;
            let due = eligible.iter().copied().filter(|id| {
                full || schedule
                    .known
                    .get(*id)
                    .is_none_or(|node| node.retry_at.is_some_and(|time| time <= now))
            });
            let mut due = due.peekable();
            let member_missing =
                profile
                    .automatic_members
                    .get(&group.name)
                    .is_some_and(|members| {
                        members
                            .iter()
                            .any(|member| !eligible.contains(member.identity.as_str()))
                    });
            if schedule.round.is_none() && (full || due.peek().is_some() || member_missing) {
                schedule.round = Some(Round::default());
                started = true;
            }
            if let Some(round) = &mut schedule.round {
                round.full |= full;
                round.pending.retain(|id| eligible.contains(id.as_str()));
                round
                    .readings
                    .retain(|id, _| eligible.contains(id.as_str()));
                round.pending.extend(
                    due.filter(|id| !round.readings.contains_key(*id))
                        .map(str::to_owned),
                );
                pending.extend(round.pending.iter().cloned());
                ready |= round.pending.is_empty();
            }
        }
        let more = pending.len() > BATCH_SIZE;
        let entries = entries
            .iter()
            .filter(|entry| {
                entry
                    .node
                    .as_ref()
                    .is_some_and(|node| pending.remove(&node.identity))
            })
            .take(BATCH_SIZE)
            .cloned()
            .collect();
        Batch {
            entries,
            more,
            started,
            ready,
        }
    }

    pub(super) fn record(&mut self, entries: &[Entry], samples: &[Sample]) {
        for (entry, sample) in entries.iter().zip(samples) {
            let Some(node) = &entry.node else { continue };
            for round in self
                .groups
                .values_mut()
                .filter_map(|schedule| schedule.round.as_mut())
            {
                if round.pending.remove(&node.identity) {
                    round.readings.insert(node.identity.clone(), sample.value);
                }
            }
        }
    }

    pub(super) fn propose(
        &self,
        profile: &mut ProfileGroups,
        entries: &[Entry],
    ) -> (Vec<Completed>, bool) {
        let mut completed = Vec::new();
        let mut changed = false;
        let now = Instant::now();
        let catalog = entries
            .iter()
            .map(|entry| (entry.name.as_str(), entry))
            .collect();
        for group in &profile.groups {
            let Some(schedule) = self
                .groups
                .get(&group.name)
                .filter(|schedule| schedule.matches(group) && !schedule.backing_off(now))
            else {
                continue;
            };
            let Some(round) = schedule
                .round
                .as_ref()
                .filter(|round| round.pending.is_empty())
            else {
                continue;
            };
            let previous = profile
                .automatic_members
                .get(&group.name)
                .map_or(&[][..], Vec::as_slice);
            let (completion, members) =
                schedule.result(group, round, entries, &catalog, previous, now);
            if members != previous {
                changed = true;
                if members.is_empty() {
                    profile.automatic_members.remove(&group.name);
                } else {
                    profile
                        .automatic_members
                        .insert(group.name.clone(), members);
                }
            }
            completed.push(completion);
        }
        (completed, changed)
    }

    pub(super) fn finish(&mut self, completed: Vec<Completed>, error: Option<String>) {
        let now = Instant::now();
        for completion in completed {
            let Some(schedule) = self.groups.get_mut(&completion.group) else {
                continue;
            };
            if let Some(error) = &error {
                schedule.apply_error = Some((error.clone(), now + RETRY_AFTER));
                continue;
            }
            schedule.apply_error = None;
            schedule.round = None;
            schedule.known.extend(completion.observed);
            schedule.last = Some(completion.report);
            if completion.full {
                schedule.next_full = now
                    + Duration::from_secs(
                        u64::from(schedule.conditions.check_interval_minutes) * 60,
                    );
            }
        }
    }
}

impl Schedule {
    fn result(
        &self,
        group: &Group,
        round: &Round,
        entries: &[Entry],
        catalog: &HashMap<&str, &Entry>,
        previous: &[AutoMember],
        now: Instant,
    ) -> (Completed, Vec<AutoMember>) {
        let mut report = Report {
            checked_at: timestamp(Duration::ZERO),
            ..Report::default()
        };
        let mut observed = HashMap::new();
        let mut added = Vec::new();
        let mut removed = HashSet::new();
        let mut active = Vec::new();
        let matched: HashSet<_> = eligible(group, entries)
            .map(|(_, node)| node.identity.as_str())
            .collect();
        for member in previous {
            if matched.contains(member.identity.as_str()) {
                active.push(member.clone());
                continue;
            }
            let entry = catalog.get(member.name.as_str());
            let reason = match entry {
                None => "节点已从当前方案移除",
                Some(_) if group.members.contains(&member.name) => "改为手动成员",
                Some(entry)
                    if entry
                        .node
                        .as_ref()
                        .is_some_and(|node| node.identity != member.identity) =>
                {
                    "节点配置已变更"
                }
                Some(_) => "节点已不符合入组条件",
            };
            report.removed.push(MemberChange {
                name: entry.map_or_else(|| member.name.clone(), |entry| entry.label.clone()),
                reason: reason.into(),
            });
        }
        let admitted: HashSet<_> = active
            .iter()
            .map(|member| member.identity.clone())
            .collect();
        for (entry, node) in eligible(group, entries) {
            let Some(reading) = round.readings.get(&node.identity) else {
                continue;
            };
            let existing = admitted.contains(&node.identity);
            let mut check = self.known.get(&node.identity).copied().unwrap_or_default();
            check.retry_at = None;
            match *reading {
                Reading::Delay(DelayResult::Passed(delay)) if self.conditions.allows(delay) => {
                    check.failures = 0;
                    if !existing {
                        added.push((entry, node, delay));
                    }
                }
                Reading::Delay(DelayResult::Timeout | DelayResult::Passed(_)) if existing => {
                    check.failures = check.failures.saturating_add(1);
                    if check.failures < FAILURES_TO_REMOVE {
                        check.retry_at = Some(now + RETRY_AFTER);
                    } else {
                        removed.insert(node.identity.as_str());
                        let reason = match *reading {
                            Reading::Delay(DelayResult::Passed(delay)) => {
                                format!("连续两次未达标，最近延迟 {delay} ms")
                            }
                            _ => "连续两次未达标，最近一次超时".into(),
                        };
                        report.removed.push(MemberChange {
                            name: entry.label.clone(),
                            reason,
                        });
                        check.failures = 0;
                    }
                }
                Reading::Unavailable | Reading::Delay(DelayResult::Failed) => {
                    report.incomplete += 1;
                    if matches!(reading, Reading::Unavailable) || check.failures > 0 {
                        check.retry_at = Some(now + RETRY_AFTER);
                    }
                }
                Reading::Delay(_) => {}
            }
            observed.insert(node.identity.clone(), check);
        }
        active.retain(|member| !removed.contains(member.identity.as_str()));
        let remaining = MAX_NODES.saturating_sub(group.members.len() + active.len());
        for (entry, node, delay) in added.into_iter().take(remaining) {
            active.push(AutoMember {
                name: entry.name.clone(),
                identity: node.identity.clone(),
            });
            report.added.push(MemberChange {
                name: entry.label.clone(),
                reason: format!("测速达标 · {delay} ms"),
            });
        }
        (
            Completed {
                group: group.name.clone(),
                full: round.full,
                observed,
                report,
            },
            active,
        )
    }
}
