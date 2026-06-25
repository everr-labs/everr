use std::fmt::Write as _;
use std::io::IsTerminal;

use anyhow::Result;

const LOGO_LINES: &[&str] = &[
    "⢠⡾⢻⣦⡀",
    "⣿⠁⣾⣉⣻⣦⡀",
    "⣿ ⣿⣉⣽⢿⡿⣦⡀",
    "⠘⣧⡈⠻⣧⣼⣧⡼⠿⣦",
    " ⠈⠛⠶⣤⣤⣤⣴⠾⠋",
];
const WORDMARK_LINES: &[&str] = &[
    "░████████ ░██    ░██  ░███████  ░██░████ ░██░████",
    "░██       ░██    ░██ ░██    ░██ ░███     ░███",
    "░███████   ░██  ░██  ░█████████ ░██      ░██",
    "░██         ░██░██   ░██        ░██      ░██",
    "░████████    ░███     ░███████  ░██      ░██",
];
const LOGO_COLUMN_WIDTH: usize = 10;
const BANNER_COLOR: &str = "\x1b[38;2;223;255;0m";
const ANSI_RESET: &str = "\x1b[0m";
const LOGO_PNG: &[u8] = include_bytes!("../assets/logo.png");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BannerMode {
    Image,
    Ansi,
    Plain,
}

/// Pure banner-mode selection. `color` is false under NO_COLOR / TERM=dumb /
/// non-TTY; `image_supported` is true when a graphics protocol is available.
pub(crate) fn banner_mode(color: bool, image_supported: bool) -> BannerMode {
    if !color {
        BannerMode::Plain
    } else if image_supported {
        BannerMode::Image
    } else {
        BannerMode::Ansi
    }
}

/// Pure detection of terminal image-protocol support from environment values.
pub(crate) fn image_protocol_from_env(
    term: Option<&str>,
    term_program: Option<&str>,
    kitty_window_id: bool,
) -> bool {
    let term = term.unwrap_or("");
    let term_program = term_program.unwrap_or("");
    kitty_window_id
        || term.contains("kitty")
        || term.contains("ghostty")
        || term_program.eq_ignore_ascii_case("ghostty")
        || term_program == "iTerm.app"
        || term_program == "WezTerm"
}

fn image_protocol_supported() -> bool {
    image_protocol_from_env(
        std::env::var("TERM").ok().as_deref(),
        std::env::var("TERM_PROGRAM").ok().as_deref(),
        std::env::var_os("KITTY_WINDOW_ID").is_some(),
    )
}

fn should_use_color() -> bool {
    std::io::stdout().is_terminal()
        && std::env::var_os("NO_COLOR").is_none()
        && std::env::var("TERM")
            .map(|term| term != "dumb")
            .unwrap_or(true)
}

pub(crate) fn print_banner() {
    println!();
    match banner_mode(should_use_color(), image_protocol_supported()) {
        BannerMode::Image => {
            if print_image_banner().is_err() {
                print_text_banner(true);
            }
        }
        BannerMode::Ansi => print_text_banner(true),
        BannerMode::Plain => print_text_banner(false),
    }
}

fn print_image_banner() -> Result<()> {
    let tmp = tempfile::Builder::new().suffix(".png").tempfile()?;
    std::fs::write(tmp.path(), LOGO_PNG)?;
    let config = viuer::Config {
        absolute_offset: false,
        height: Some(8),
        use_kitty: true,
        use_iterm: true,
        ..Default::default()
    };
    viuer::print_from_file(tmp.path(), &config)?;
    println!();
    Ok(())
}

fn print_text_banner(color: bool) {
    let banner = render_banner();
    if color {
        print!("{BANNER_COLOR}{banner}{ANSI_RESET}");
    } else {
        print!("{banner}");
    }
    println!();
}

fn render_banner() -> String {
    let mut banner = String::new();
    let total_lines = LOGO_LINES.len().max(WORDMARK_LINES.len());
    for line_index in 0..total_lines {
        let logo = LOGO_LINES.get(line_index).copied().unwrap_or("");
        let wordmark = WORDMARK_LINES.get(line_index).copied().unwrap_or("");
        if wordmark.is_empty() {
            writeln!(&mut banner, "{logo}").expect("banner line");
        } else {
            writeln!(
                &mut banner,
                "{logo:<width$}   {wordmark}",
                width = LOGO_COLUMN_WIDTH
            )
            .expect("banner line");
        }
    }
    banner
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_when_no_color() {
        assert_eq!(banner_mode(false, true), BannerMode::Plain);
        assert_eq!(banner_mode(false, false), BannerMode::Plain);
    }

    #[test]
    fn image_when_color_and_supported() {
        assert_eq!(banner_mode(true, true), BannerMode::Image);
    }

    #[test]
    fn ansi_when_color_without_image_support() {
        assert_eq!(banner_mode(true, false), BannerMode::Ansi);
    }

    #[test]
    fn detects_kitty_via_window_id() {
        assert!(image_protocol_from_env(Some("xterm-256color"), None, true));
    }

    #[test]
    fn detects_ghostty() {
        assert!(image_protocol_from_env(Some("xterm-ghostty"), None, false));
        assert!(image_protocol_from_env(None, Some("ghostty"), false));
    }

    #[test]
    fn detects_iterm_and_wezterm() {
        assert!(image_protocol_from_env(None, Some("iTerm.app"), false));
        assert!(image_protocol_from_env(None, Some("WezTerm"), false));
    }

    #[test]
    fn no_image_protocol_for_plain_terminal() {
        assert!(!image_protocol_from_env(
            Some("xterm-256color"),
            Some("Apple_Terminal"),
            false
        ));
    }

    #[test]
    fn renders_banner_with_logo_and_wordmark() {
        let banner = render_banner();
        assert!(banner.contains("░████████"));
        assert!(banner.lines().count() >= 5);
    }
}
