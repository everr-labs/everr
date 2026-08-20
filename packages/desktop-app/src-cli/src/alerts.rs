use std::borrow::Cow;
use std::fmt::Write as _;
use std::io::{IsTerminal, Read};
use std::time::SystemTime;

use anyhow::{Context, Result, bail};
use chrono::{DateTime, SecondsFormat, Utc};
use everr_core::api::{
    ApiClient, Channel, ChannelConfig, MatchOp, Matcher, Silence, SilenceInput, SilenceQuery,
};

use crate::cli::{
    AlertsSubcommand, ChannelSecretArgs, ChannelTypeArg, ChannelsCreateArgs, ChannelsDeleteArgs,
    ChannelsEditArgs, ChannelsListArgs, ChannelsSubcommand, SilencesCreateArgs, SilencesExpireArgs,
    SilencesListArgs, SilencesSubcommand,
};
use crate::core::confirm_action;

/// The marker a read puts where a secret was. Sending it back keeps whatever
/// the server has stored.
const REDACTED: &str = "***";

const URL_ENV: &str = "EVERR_CHANNEL_URL";
const BOT_TOKEN_ENV: &str = "EVERR_CHANNEL_BOT_TOKEN";

pub async fn run_alerts(cmd: AlertsSubcommand) -> Result<()> {
    // Like `everr resources`, these target the session-authenticated /api/cli
    // routes, which have no API-key path.
    let session = crate::auth::require_session_with_refresh().await?;
    let client = ApiClient::from_session(&session)?;
    match cmd {
        AlertsSubcommand::Silences(args) => match args.command {
            SilencesSubcommand::List(args) => silences_list(&client, args).await,
            SilencesSubcommand::Create(args) => silences_create(&client, args).await,
            SilencesSubcommand::Expire(args) => silences_expire(&client, args).await,
        },
        AlertsSubcommand::Channels(args) => match args.command {
            ChannelsSubcommand::List(args) => channels_list(&client, args).await,
            ChannelsSubcommand::Create(args) => channels_create(&client, args).await,
            ChannelsSubcommand::Edit(args) => channels_edit(&client, args).await,
            ChannelsSubcommand::Delete(args) => channels_delete(&client, args).await,
        },
    }
}

// ---------------------------------------------------------------- silences

async fn silences_list(client: &ApiClient, args: SilencesListArgs) -> Result<()> {
    let now = SystemTime::now();
    let from = resolve_bound(args.from.as_deref(), now, "--from")?;
    let to = resolve_bound(args.to.as_deref(), now, "--to")?;
    // Both are RFC 3339 in UTC with a fixed width, so ordering them as text
    // orders them as instants.
    if let (Some(from), Some(to)) = (&from, &to)
        && from > to
    {
        bail!("--from is after --to, so no silence could overlap the window");
    }
    // One row more than we mean to show: if it comes back, another page exists,
    // and the count that answers that costs nothing extra.
    let probe = args.limit.saturating_add(1);
    let mut silences = client
        .list_silences(&SilenceQuery {
            limit: probe,
            offset: args.offset,
            from: from.as_deref(),
            to: to.as_deref(),
        })
        .await?;
    let has_more = silences.len() > args.limit as usize;
    silences.truncate(args.limit as usize);

    if args.json {
        println!("{}", serde_json::to_string_pretty(&silences)?);
        return Ok(());
    }
    print!("{}", render_silences(&silences, Utc::now()));
    if has_more {
        println!(
            "\nMore silences available. Rerun with --limit {} --offset {} to continue.",
            args.limit,
            args.offset.saturating_add(args.limit)
        );
    }
    Ok(())
}

/// The silence table, as text. Separate from printing it so what a reader sees
/// can be asserted without a terminal.
fn render_silences(silences: &[Silence], now: DateTime<Utc>) -> String {
    if silences.is_empty() {
        return "No silences.\n".to_string();
    }
    let mut out = format!(
        "{:<38}  {:<10}  {:<24}  {:<18}  MATCHERS\n",
        "ID", "STATE", "ENDS", "AUTHOR"
    );
    for silence in silences {
        let state = silence_state(silence, now);
        let _ = writeln!(
            out,
            "{:<38}  {:<10}  {:<24}  {:<18}  {}",
            silence.id,
            state,
            silence.ends_at,
            truncate(&silence.author, 18),
            format_matchers(&silence.matchers)
        );
    }
    out
}

async fn silences_create(client: &ApiClient, args: SilencesCreateArgs) -> Result<()> {
    let matchers = args
        .matchers
        .iter()
        .map(|raw| parse_matcher(raw))
        .collect::<Result<Vec<_>>>()?;
    let (starts_at, ends_at) = resolve_window(
        args.duration.as_deref(),
        args.starts_at.as_deref(),
        args.ends_at.as_deref(),
        SystemTime::now(),
    )?;
    let silence = client
        .create_silence(&SilenceInput {
            matchers,
            starts_at,
            ends_at,
            comment: args.comment,
        })
        .await?;
    if args.json {
        println!("{}", serde_json::to_string_pretty(&silence)?);
        return Ok(());
    }
    println!(
        "Created silence {} for {}.",
        silence.id,
        format_matchers(&silence.matchers)
    );
    println!("Window: {} to {}.", silence.starts_at, silence.ends_at);
    println!("Matching alerts stay visible; they are not delivered.");
    Ok(())
}

async fn silences_expire(client: &ApiClient, args: SilencesExpireArgs) -> Result<()> {
    if !confirm_action(
        format!("Expire silence {}?", args.id),
        args.yes,
        false,
        "refusing to proceed without confirmation; re-run with --yes".into(),
    )? {
        println!("Aborted.");
        return Ok(());
    }
    let outcome = client.expire_silence(&args.id).await?;
    if outcome.expired {
        println!("Expired silence {}.", args.id);
        println!("Alerts it was withholding are re-checked now.");
    } else {
        println!("Silence {} was already closed. Nothing to do.", args.id);
    }
    Ok(())
}

/// A closed window withholds nothing any more.
const EXPIRED: &str = "expired";

fn silence_state(silence: &Silence, now: DateTime<Utc>) -> &'static str {
    if parse_timestamp(&silence.ends_at).is_some_and(|ends| ends <= now) {
        return EXPIRED;
    }
    match parse_timestamp(&silence.starts_at) {
        Some(starts) if starts > now => "scheduled",
        _ => "active",
    }
}

fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// Parse `label=value` or `label!=value`.
///
/// `!=` is tested first: `env!=staging` also contains `=`, and splitting on
/// that would silence `env!` instead of everything but staging.
fn parse_matcher(raw: &str) -> Result<Matcher> {
    let (label, op, value) = match raw.split_once("!=") {
        Some((label, value)) => (label, MatchOp::Ne, value),
        None => match raw.split_once('=') {
            Some((label, value)) => (label, MatchOp::Eq, value),
            None => {
                bail!("matcher `{raw}` needs an operator: write `label=value` or `label!=value`")
            }
        },
    };
    if label.trim().is_empty() {
        bail!("matcher `{raw}` has no label");
    }
    Ok(Matcher {
        label: label.trim().to_string(),
        op,
        value: value.to_string(),
    })
}

/// The window to silence, as the two timestamps the API takes.
///
/// `--for` is the common case and means "starting now". The explicit pair is
/// for a window that starts later. Both go through date math, so `--ends-at
/// now+30m` works as well as an absolute timestamp.
fn resolve_window(
    duration: Option<&str>,
    starts_at: Option<&str>,
    ends_at: Option<&str>,
    now: SystemTime,
) -> Result<(String, String)> {
    let start = match starts_at {
        Some(expression) => resolve_time(expression, now, "--starts-at")?,
        None => now,
    };
    let end = match (duration, ends_at) {
        (Some(duration), _) => resolve_time(&format!("now+{duration}"), now, "--for")?,
        (None, Some(expression)) => resolve_time(expression, now, "--ends-at")?,
        (None, None) => bail!("pass --for to silence from now, or --starts-at with --ends-at"),
    };
    if end <= start {
        bail!("the silence would end before it starts");
    }
    Ok((format_timestamp(start), format_timestamp(end)))
}

/// A filter bound, resolved to an absolute timestamp so the request says what
/// it asked for rather than deferring `now` to the server.
fn resolve_bound(expression: Option<&str>, now: SystemTime, flag: &str) -> Result<Option<String>> {
    expression
        .map(|value| resolve_time(value, now, flag).map(format_timestamp))
        .transpose()
}

fn resolve_time(expression: &str, now: SystemTime, flag: &str) -> Result<SystemTime> {
    everr_core::datemath::resolve(expression, now)
        .with_context(|| format!("{flag} is not a time or a duration: {expression}"))
}

fn format_timestamp(time: SystemTime) -> String {
    DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn format_matchers(matchers: &[Matcher]) -> String {
    let mut out = String::new();
    for (index, matcher) in matchers.iter().enumerate() {
        if index > 0 {
            out.push_str(", ");
        }
        out.push_str(&matcher.label);
        out.push_str(match matcher.op {
            MatchOp::Eq => "=",
            MatchOp::Ne => "!=",
        });
        out.push_str(&matcher.value);
    }
    out
}

// ---------------------------------------------------------------- channels

async fn channels_list(client: &ApiClient, args: ChannelsListArgs) -> Result<()> {
    let channels = client.list_channels().await?;
    if args.json {
        println!("{}", serde_json::to_string_pretty(&channels)?);
        return Ok(());
    }
    print!("{}", render_channels(&channels));
    Ok(())
}

/// The channel table, as text. See `render_silences`.
fn render_channels(channels: &[Channel]) -> String {
    if channels.is_empty() {
        return "No channels.\n".to_string();
    }
    let mut out = format!("{:<28}  {:<10}  DESTINATION\n", "NAME", "TYPE");
    for channel in channels {
        let _ = writeln!(
            out,
            "{:<28}  {:<10}  {}",
            channel.name,
            channel_type_name(&channel.config),
            channel_destination(&channel.config)
        );
    }
    out.push_str("\nSecrets are stored encrypted and are never returned.\n");
    out
}

async fn channels_create(client: &ApiClient, args: ChannelsCreateArgs) -> Result<()> {
    let config = build_config(args.channel_type, &args.secret, None)?;
    let channel = client.create_channel(&args.name, &config).await?;
    report_channel("Created", &channel, args.json)
}

async fn channels_edit(client: &ApiClient, args: ChannelsEditArgs) -> Result<()> {
    // A rename says nothing about the credential or the transport, so it needs
    // neither the stored config nor the round trip that would read it back.
    if args.channel_type.is_none() && !args.secret.is_given() {
        let Some(rename) = args.rename.as_deref() else {
            bail!("nothing to change: pass --rename, --type, or a secret to set");
        };
        let channel = client
            .update_channel(&args.name, Some(rename), None)
            .await?;
        return report_channel("Updated", &channel, args.json);
    }
    let current = find_channel(client, &args.name).await?;
    let channel_type = args
        .channel_type
        .unwrap_or_else(|| channel_type_of(&current.config));
    // A stored secret belongs to the transport it was made for, so a type
    // change cannot carry it over. The server would store the redaction marker
    // verbatim, leaving a channel that delivers nowhere.
    let previous = if channel_type == channel_type_of(&current.config) {
        Some(&current.config)
    } else {
        None
    };
    let config = build_config(channel_type, &args.secret, previous)?;
    let channel = client
        .update_channel(&args.name, args.rename.as_deref(), Some(&config))
        .await?;
    report_channel("Updated", &channel, args.json)
}

async fn channels_delete(client: &ApiClient, args: ChannelsDeleteArgs) -> Result<()> {
    if !confirm_action(
        format!("Delete channel «{}»?", args.name),
        args.yes,
        true,
        "refusing to proceed without confirmation; re-run with --yes".into(),
    )? {
        println!("Aborted.");
        return Ok(());
    }
    client.delete_channel(&args.name).await?;
    println!("Deleted channel «{}».", args.name);
    println!(
        "note: rules naming it keep the name, and deliver again once a channel with that name exists."
    );
    Ok(())
}

async fn find_channel(client: &ApiClient, name: &str) -> Result<Channel> {
    let channels = client.list_channels().await?;
    channels
        .into_iter()
        .find(|channel| channel.name == name)
        .with_context(|| format!("Channel not found: {name}"))
}

/// Assemble the config to send.
///
/// `previous` is the channel's current config when an edit keeps its type: its
/// redacted secret goes back untouched, which is how an edit that changes only
/// the name leaves the credential alone.
fn build_config(
    channel_type: ChannelTypeArg,
    secret: &ChannelSecretArgs,
    previous: Option<&ChannelConfig>,
) -> Result<ChannelConfig> {
    reject_inapplicable_flags(channel_type, secret)?;
    let webhook_url = |label| {
        resolve_secret(
            secret.url_file.as_deref(),
            URL_ENV,
            label,
            previous.is_some(),
        )
    };
    Ok(match channel_type {
        ChannelTypeArg::Telegram => {
            let bot_token = resolve_secret(
                secret.bot_token_file.as_deref(),
                BOT_TOKEN_ENV,
                "Telegram bot token",
                previous.is_some(),
            )?;
            let chat_ids = if secret.chat_ids.is_empty() {
                match previous {
                    Some(ChannelConfig::Telegram { chat_ids, .. }) => chat_ids.clone(),
                    _ => bail!("--chat-id names the chat to deliver to; pass at least one"),
                }
            } else {
                secret.chat_ids.clone()
            };
            ChannelConfig::Telegram {
                bot_token,
                chat_ids,
            }
        }
        ChannelTypeArg::Slack => ChannelConfig::Slack {
            url: webhook_url("Slack webhook URL")?,
        },
        ChannelTypeArg::Discord => ChannelConfig::Discord {
            url: webhook_url("Discord webhook URL")?,
        },
        ChannelTypeArg::Webhook => ChannelConfig::Webhook {
            url: webhook_url("Webhook URL")?,
        },
    })
}

/// Refuse a secret flag that belongs to another transport, rather than
/// silently ignoring it and storing a channel the caller did not describe.
fn reject_inapplicable_flags(
    channel_type: ChannelTypeArg,
    secret: &ChannelSecretArgs,
) -> Result<()> {
    if channel_type == ChannelTypeArg::Telegram {
        if secret.url_file.is_some() {
            bail!("--url-file does not apply to a telegram channel; use --bot-token-file");
        }
        return Ok(());
    }
    if secret.bot_token_file.is_some() {
        bail!("--bot-token-file only applies to a telegram channel; use --url-file");
    }
    if !secret.chat_ids.is_empty() {
        bail!("--chat-id only applies to a telegram channel");
    }
    Ok(())
}

/// The secret to send, from a file, the environment, or a hidden prompt.
///
/// `keep_stored` is set when the channel already has a secret of this kind: the
/// caller may be editing something else entirely, so the redaction marker goes
/// back and the stored secret stays. Without one, a value has to come from
/// somewhere, and a non-interactive shell is told where.
fn resolve_secret(
    file: Option<&str>,
    env_var: &str,
    label: &str,
    keep_stored: bool,
) -> Result<String> {
    if let Some(path) = file {
        return read_secret_file(path, label);
    }
    if let Ok(value) = std::env::var(env_var)
        && !value.trim().is_empty()
    {
        return Ok(value.trim().to_string());
    }
    if keep_stored {
        return Ok(REDACTED.to_string());
    }
    if !(std::io::stdin().is_terminal() && std::io::stdout().is_terminal()) {
        bail!(
            "no {label} given: set ${env_var}, or pass the file holding it \
             (`-` reads stdin). It is deliberately not a flag, so it stays out \
             of your shell history."
        );
    }
    let value = cliclack::password(format!("{label}:")).interact()?;
    if value.trim().is_empty() {
        bail!("no {label} given");
    }
    Ok(value.trim().to_string())
}

fn read_secret_file(path: &str, label: &str) -> Result<String> {
    let contents = if path == "-" {
        let mut buffer = String::new();
        std::io::stdin()
            .read_to_string(&mut buffer)
            .context("failed to read the secret from stdin")?;
        buffer
    } else {
        std::fs::read_to_string(path).with_context(|| format!("failed to read {path}"))?
    };
    let value = contents.trim();
    if value.is_empty() {
        bail!("{label} is empty");
    }
    Ok(value.to_string())
}

fn channel_type_of(config: &ChannelConfig) -> ChannelTypeArg {
    match config {
        ChannelConfig::Webhook { .. } => ChannelTypeArg::Webhook,
        ChannelConfig::Slack { .. } => ChannelTypeArg::Slack,
        ChannelConfig::Discord { .. } => ChannelTypeArg::Discord,
        ChannelConfig::Telegram { .. } => ChannelTypeArg::Telegram,
    }
}

fn channel_type_name(config: &ChannelConfig) -> &'static str {
    match config {
        ChannelConfig::Webhook { .. } => "webhook",
        ChannelConfig::Slack { .. } => "slack",
        ChannelConfig::Discord { .. } => "discord",
        ChannelConfig::Telegram { .. } => "telegram",
    }
}

/// What a list can say about where a channel delivers. The URL is redacted, so
/// only a Telegram channel has anything to show: its chat ids are not secret.
fn channel_destination(config: &ChannelConfig) -> Cow<'static, str> {
    match config {
        ChannelConfig::Telegram { chat_ids, .. } => {
            Cow::Owned(format!("chats {}", chat_ids.join(", ")))
        }
        _ => Cow::Borrowed(REDACTED),
    }
}

fn report_channel(verb: &str, channel: &Channel, json: bool) -> Result<()> {
    if json {
        println!("{}", serde_json::to_string_pretty(channel)?);
        return Ok(());
    }
    println!(
        "{verb} channel «{}» ({}).",
        channel.name,
        channel_type_name(&channel.config)
    );
    Ok(())
}

/// `value` shortened to `width` characters, with an ellipsis standing for what
/// was cut. Borrows when it already fits, which is the usual case.
fn truncate(value: &str, width: usize) -> Cow<'_, str> {
    // `nth(width)` stops at the first character past the limit, so a value that
    // fits is never walked further than the limit itself.
    if value.char_indices().nth(width).is_none() {
        return Cow::Borrowed(value);
    }
    let end = value
        .char_indices()
        .nth(width.saturating_sub(1))
        .map_or(value.len(), |(index, _)| index);
    Cow::Owned(format!("{}…", &value[..end]))
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, UNIX_EPOCH};

    use super::*;
    use crate::test_support::ENV_LOCK;

    /// 2026-08-20T09:00:00Z, so the expected windows read as timestamps.
    fn fixed_now() -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(1_787_216_400)
    }

    fn no_secret_flags() -> ChannelSecretArgs {
        ChannelSecretArgs {
            url_file: None,
            bot_token_file: None,
            chat_ids: Vec::new(),
        }
    }

    #[test]
    fn a_matcher_reads_its_operator() {
        assert_eq!(
            parse_matcher("service=api").unwrap(),
            Matcher {
                label: "service".to_string(),
                op: MatchOp::Eq,
                value: "api".to_string(),
            }
        );
    }

    #[test]
    fn a_negated_matcher_keeps_its_label_whole() {
        let matcher = parse_matcher("env!=staging").unwrap();

        assert_eq!(matcher.label, "env");
        assert_eq!(matcher.op, MatchOp::Ne);
        assert_eq!(matcher.value, "staging");
    }

    #[test]
    fn a_value_may_contain_the_operator_character() {
        assert_eq!(parse_matcher("url=a=b").unwrap().value, "a=b");
    }

    #[test]
    fn a_matcher_without_an_operator_is_refused() {
        let error = parse_matcher("service").unwrap_err().to_string();

        assert!(error.contains("label=value"), "got: {error}");
    }

    #[test]
    fn a_matcher_without_a_label_is_refused() {
        assert!(parse_matcher("=api").is_err());
    }

    #[test]
    fn a_duration_silences_from_now() {
        let (starts_at, ends_at) = resolve_window(Some("2h"), None, None, fixed_now()).unwrap();

        assert_eq!(starts_at, "2026-08-20T09:00:00.000Z");
        assert_eq!(ends_at, "2026-08-20T11:00:00.000Z");
    }

    #[test]
    fn an_explicit_pair_schedules_a_later_window() {
        let (starts_at, ends_at) = resolve_window(
            None,
            Some("2026-08-21T09:00:00Z"),
            Some("2026-08-21T11:00:00Z"),
            fixed_now(),
        )
        .unwrap();

        assert_eq!(starts_at, "2026-08-21T09:00:00.000Z");
        assert_eq!(ends_at, "2026-08-21T11:00:00.000Z");
    }

    #[test]
    fn a_window_with_no_end_is_refused() {
        let error = resolve_window(None, None, None, fixed_now())
            .unwrap_err()
            .to_string();

        assert!(error.contains("--for"), "got: {error}");
    }

    #[test]
    fn a_window_that_ends_before_it_starts_is_refused() {
        let error = resolve_window(
            None,
            Some("2026-08-21T11:00:00Z"),
            Some("2026-08-21T09:00:00Z"),
            fixed_now(),
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("before it starts"), "got: {error}");
    }

    #[test]
    fn an_expired_silence_is_told_apart_from_a_scheduled_one() {
        let now = DateTime::<Utc>::from(fixed_now());
        let silence = |starts_at: &str, ends_at: &str| Silence {
            id: "s-1".to_string(),
            matchers: Vec::new(),
            starts_at: starts_at.to_string(),
            ends_at: ends_at.to_string(),
            comment: String::new(),
            author: "Ada".to_string(),
            created_at: "2026-08-20T08:00:00Z".to_string(),
            canceled_at: None,
        };

        assert_eq!(
            silence_state(
                &silence("2026-08-20T06:00:00Z", "2026-08-20T08:00:00Z"),
                now
            ),
            "expired"
        );
        assert_eq!(
            silence_state(
                &silence("2026-08-20T08:00:00Z", "2026-08-20T10:00:00Z"),
                now
            ),
            "active"
        );
        assert_eq!(
            silence_state(
                &silence("2026-08-20T10:00:00Z", "2026-08-20T12:00:00Z"),
                now
            ),
            "scheduled"
        );
    }

    #[test]
    fn a_url_flag_is_refused_on_a_telegram_channel() {
        let secret = ChannelSecretArgs {
            url_file: Some("hook.txt".to_string()),
            ..no_secret_flags()
        };

        let error = reject_inapplicable_flags(ChannelTypeArg::Telegram, &secret)
            .unwrap_err()
            .to_string();

        assert!(error.contains("--bot-token-file"), "got: {error}");
    }

    #[test]
    fn a_chat_id_is_refused_on_a_webhook_channel() {
        let secret = ChannelSecretArgs {
            chat_ids: vec!["1".to_string()],
            ..no_secret_flags()
        };

        assert!(reject_inapplicable_flags(ChannelTypeArg::Slack, &secret).is_err());
    }

    #[test]
    fn an_edit_that_touches_no_secret_sends_the_marker_back() {
        let _guard = ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        unsafe { std::env::remove_var(URL_ENV) };
        let previous = ChannelConfig::Slack {
            url: REDACTED.to_string(),
        };

        let config = build_config(ChannelTypeArg::Slack, &no_secret_flags(), Some(&previous))
            .expect("keeps the stored secret");

        assert_eq!(
            config,
            ChannelConfig::Slack {
                url: REDACTED.to_string()
            }
        );
    }

    #[test]
    fn an_edit_keeps_the_chat_ids_it_does_not_change() {
        let _guard = ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        unsafe { std::env::remove_var(BOT_TOKEN_ENV) };
        let previous = ChannelConfig::Telegram {
            bot_token: REDACTED.to_string(),
            chat_ids: vec!["1".to_string(), "2".to_string()],
        };

        let config = build_config(
            ChannelTypeArg::Telegram,
            &no_secret_flags(),
            Some(&previous),
        )
        .expect("keeps the stored chats");

        assert_eq!(
            config,
            ChannelConfig::Telegram {
                bot_token: REDACTED.to_string(),
                chat_ids: vec!["1".to_string(), "2".to_string()],
            }
        );
    }

    #[test]
    fn the_environment_supplies_the_secret_when_no_file_does() {
        let _guard = ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        unsafe { std::env::set_var(URL_ENV, "https://hooks.slack.test/abc\n") };

        let config = build_config(ChannelTypeArg::Slack, &no_secret_flags(), None)
            .expect("reads the environment");

        unsafe { std::env::remove_var(URL_ENV) };
        assert_eq!(
            config,
            ChannelConfig::Slack {
                url: "https://hooks.slack.test/abc".to_string()
            }
        );
    }

    #[test]
    fn a_file_outranks_the_environment() {
        let _guard = ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        unsafe { std::env::set_var(URL_ENV, "https://hooks.slack.test/from-env") };
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("hook.txt");
        std::fs::write(&path, "https://hooks.slack.test/from-file\n").expect("write");
        let secret = ChannelSecretArgs {
            url_file: Some(path.to_string_lossy().into_owned()),
            ..no_secret_flags()
        };

        let config = build_config(ChannelTypeArg::Slack, &secret, None).expect("reads the file");

        unsafe { std::env::remove_var(URL_ENV) };
        assert_eq!(
            config,
            ChannelConfig::Slack {
                url: "https://hooks.slack.test/from-file".to_string()
            }
        );
    }

    #[test]
    fn a_type_change_will_not_carry_the_old_secret_over() {
        let _guard = ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        unsafe { std::env::remove_var(BOT_TOKEN_ENV) };

        // `previous` is None whenever the type changes, which is what makes the
        // marker unavailable and forces a real token.
        let error = build_config(ChannelTypeArg::Telegram, &no_secret_flags(), None)
            .expect_err("a new transport needs its own credential");

        assert!(error.to_string().contains(BOT_TOKEN_ENV), "got: {error}");
    }
    fn silence_at(id: &str, starts_at: &str, ends_at: &str) -> Silence {
        Silence {
            id: id.to_string(),
            matchers: vec![Matcher {
                label: "service".to_string(),
                op: MatchOp::Eq,
                value: "api".to_string(),
            }],
            starts_at: starts_at.to_string(),
            ends_at: ends_at.to_string(),
            comment: String::new(),
            author: "Ada".to_string(),
            created_at: "2026-08-20T08:00:00Z".to_string(),
            canceled_at: None,
        }
    }

    #[test]
    fn the_silence_table_shows_every_row_the_page_returned() {
        // The page is the query's decision, so the renderer states each row's
        // state rather than deciding what to hide.
        let now = DateTime::<Utc>::from(fixed_now());
        let silences = vec![silence_at(
            "s-1",
            "2026-08-20T06:00:00Z",
            "2026-08-20T08:00:00Z",
        )];

        let out = render_silences(&silences, now);

        assert!(out.contains("s-1"), "got: {out}");
        assert!(out.contains(EXPIRED), "got: {out}");
    }

    #[test]
    fn an_empty_page_says_so() {
        assert_eq!(
            render_silences(&[], DateTime::<Utc>::from(fixed_now())),
            "No silences.\n"
        );
    }

    #[test]
    fn the_silence_table_prints_the_matchers_it_was_created_with() {
        let now = DateTime::<Utc>::from(fixed_now());
        let silences = vec![silence_at(
            "s-1",
            "2026-08-20T08:00:00Z",
            "2026-08-20T10:00:00Z",
        )];

        let out = render_silences(&silences, now);

        assert!(out.contains("service=api"), "got: {out}");
        assert!(out.contains("Ada"), "got: {out}");
        assert!(out.contains("active"), "got: {out}");
    }

    #[test]
    fn the_channel_table_never_shows_a_secret() {
        let channels = vec![
            Channel {
                id: "c-1".to_string(),
                name: "oncall".to_string(),
                config: ChannelConfig::Slack {
                    url: REDACTED.to_string(),
                },
            },
            Channel {
                id: "c-2".to_string(),
                name: "tg".to_string(),
                config: ChannelConfig::Telegram {
                    bot_token: REDACTED.to_string(),
                    chat_ids: vec!["1".to_string(), "2".to_string()],
                },
            },
        ];

        let out = render_channels(&channels);

        assert!(out.contains("oncall"), "got: {out}");
        assert!(out.contains("slack"), "got: {out}");
        // Chat ids are not secret, so they are the one destination worth showing.
        assert!(out.contains("chats 1, 2"), "got: {out}");
        assert!(out.contains("never returned"), "got: {out}");
    }

    #[test]
    fn an_empty_channel_list_says_so() {
        assert_eq!(render_channels(&[]), "No channels.\n");
    }

    #[test]
    fn a_long_author_is_truncated_to_fit_its_column() {
        assert_eq!(truncate("abcdefghij", 5), "abcd\u{2026}");
        assert_eq!(truncate("abc", 5), "abc");
    }

    fn edit_args(name: &str) -> ChannelsEditArgs {
        ChannelsEditArgs {
            name: name.to_string(),
            rename: None,
            channel_type: None,
            secret: no_secret_flags(),
            json: false,
        }
    }

    fn test_client(base_url: &str) -> ApiClient {
        ApiClient::from_session(&everr_core::state::Session {
            api_base_url: base_url.to_string(),
            token: "test-token".to_string(),
        })
        .expect("client")
    }

    #[tokio::test]
    async fn a_full_page_asks_for_one_more_row_and_says_another_page_exists() {
        let mut server = mockito::Server::new_async().await;
        // Two rows come back for a page of one: the extra is the probe.
        let list = server
            .mock("GET", "/api/cli/alerts/silences")
            .match_query(mockito::Matcher::AllOf(vec![
                mockito::Matcher::UrlEncoded("limit".into(), "2".into()),
                mockito::Matcher::UrlEncoded("offset".into(), "0".into()),
            ]))
            .with_body(
                serde_json::to_string(&[
                    silence_at("s-1", "2026-08-20T08:00:00Z", "2026-08-20T10:00:00Z"),
                    silence_at("s-2", "2026-08-20T08:00:00Z", "2026-08-20T10:00:00Z"),
                ])
                .expect("fixture"),
            )
            .create_async()
            .await;
        let client = test_client(&server.url());

        silences_list(
            &client,
            SilencesListArgs {
                from: None,
                to: None,
                limit: 1,
                offset: 0,
                json: false,
            },
        )
        .await
        .expect("listed");

        list.assert_async().await;
    }

    #[tokio::test]
    async fn a_window_is_resolved_before_it_is_asked_for() {
        let mut server = mockito::Server::new_async().await;
        // Date math never reaches the server: the request names two instants.
        let list = server
            .mock("GET", "/api/cli/alerts/silences")
            .match_query(mockito::Matcher::AllOf(vec![
                mockito::Matcher::UrlEncoded("limit".into(), "21".into()),
                mockito::Matcher::UrlEncoded("offset".into(), "0".into()),
                mockito::Matcher::Regex("from=2026-08".into()),
                mockito::Matcher::Regex("to=2026-08".into()),
            ]))
            .with_body("[]")
            .create_async()
            .await;
        let client = test_client(&server.url());

        silences_list(
            &client,
            SilencesListArgs {
                from: Some("now-1d".to_string()),
                to: Some("now".to_string()),
                limit: 20,
                offset: 0,
                json: false,
            },
        )
        .await
        .expect("listed");

        list.assert_async().await;
    }

    #[tokio::test]
    async fn a_window_that_starts_after_it_ends_is_refused() {
        // No mock: the refusal has to come before any request.
        let server = mockito::Server::new_async().await;
        let client = test_client(&server.url());

        let error = silences_list(
            &client,
            SilencesListArgs {
                from: Some("now".to_string()),
                to: Some("now-1h".to_string()),
                limit: 20,
                offset: 0,
                json: false,
            },
        )
        .await
        .expect_err("an inverted window overlaps nothing");

        assert!(
            error.to_string().contains("--from is after --to"),
            "got: {error}"
        );
    }

    #[tokio::test]
    async fn an_edit_that_names_nothing_to_change_is_refused() {
        let server = mockito::Server::new_async().await;
        let client = test_client(&server.url());

        let error = channels_edit(&client, edit_args("oncall"))
            .await
            .expect_err("nothing was asked for");

        assert!(error.to_string().contains("--rename"), "got: {error}");
        // Refused before any request: the mock has no expectations to match.
    }

    #[tokio::test]
    async fn a_rename_reaches_the_server_without_reading_the_channel_back() {
        let mut server = mockito::Server::new_async().await;
        // No GET is mocked, so a fetch of the channel list would fail the call.
        let patch = server
            .mock("PATCH", "/api/cli/alerts/channels/oncall")
            .match_body(mockito::Matcher::JsonString(
                r#"{"name":"primary-oncall"}"#.to_string(),
            ))
            .with_body(
                r#"{"id":"c-1","tenant":"org-1","name":"primary-oncall","config":{"type":"slack","url":"***"}}"#,
            )
            .create_async()
            .await;
        let client = test_client(&server.url());

        let args = ChannelsEditArgs {
            rename: Some("primary-oncall".to_string()),
            ..edit_args("oncall")
        };
        channels_edit(&client, args).await.expect("renamed");

        patch.assert_async().await;
    }
}
