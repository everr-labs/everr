use std::fmt::Write as _;
use std::io::IsTerminal;

// Braille rendition of packages/ui/src/assets/favicon.svg.
const LOGO_LINES: &[&str] = &[
    "     ⣠⣤⣤⡀",
    "     ⣿⡿⢿⠇   \x1b[38;2;215;255;0m⣶\x1b[0m",
    "    ⢀⣀⣸⣧⣤⣀⡀\x1b[38;2;215;255;0m⠘⠃⢀⣠⡤\x1b[0m",
    "  ⣠⣾⣿⠿⠛⠛⠛⠛⠛⠷⣄\x1b[38;2;215;255;0m⠉⠁\x1b[0m",
    " ⢸⣿⣿⠃ \x1b[38;2;215;255;0m⢀\x1b[0m   \x1b[38;2;215;255;0m⢀\x1b[0m ⠘⣇",
    "⣼⡇⣿⣏  \x1b[38;2;215;255;0m⢿⠇\x1b[0m  \x1b[38;2;215;255;0m⢿⠇\x1b[0m ⣿",
    "⠘⠣⣿⣿⣄      ⢀⣠⠏",
    "  ⠉⠛⠛⠛⠛⠛⠛⠛⠛⠛⠁",
];
const WORDMARK_LINES: &[&str] = &[
    "░████████ ░██    ░██  ░███████  ░██░████ ░██░████",
    "░██       ░██    ░██ ░██    ░██ ░███     ░███",
    "░███████   ░██  ░██  ░█████████ ░██      ░██",
    "░██         ░██░██   ░██        ░██      ░██",
    "░████████    ░███     ░███████  ░██      ░██",
];
const LOGO_COLUMN_WIDTH: usize = 16;

fn should_use_color() -> bool {
    std::io::stdout().is_terminal()
        && std::env::var_os("NO_COLOR").is_none()
        && std::env::var("TERM")
            .map(|term| term != "dumb")
            .unwrap_or(true)
}

pub(crate) fn print_banner() {
    println!();
    print!("{}", render_banner(should_use_color()));
    println!();
}

fn render_banner(use_color: bool) -> String {
    let mut banner = String::new();
    let total_lines = LOGO_LINES.len().max(WORDMARK_LINES.len());
    let wordmark_offset = (total_lines - WORDMARK_LINES.len()) / 2;
    for line_index in 0..total_lines {
        let logo = LOGO_LINES.get(line_index).copied().unwrap_or("");
        let logo = if use_color {
            std::borrow::Cow::Borrowed(logo)
        } else {
            console::strip_ansi_codes(logo)
        };
        let wordmark = line_index
            .checked_sub(wordmark_offset)
            .and_then(|index| WORDMARK_LINES.get(index))
            .copied()
            .unwrap_or("");
        if wordmark.is_empty() {
            writeln!(&mut banner, "{logo}").expect("banner line");
        } else {
            let padding = " ".repeat(LOGO_COLUMN_WIDTH - console::measure_text_width(&logo));
            writeln!(&mut banner, "{logo}{padding}   {wordmark}").expect("banner line");
        }
    }
    banner
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_same_banner_with_or_without_color() {
        let banner = render_banner(false);
        assert!(banner.contains("░████████"));
        assert!(!banner.contains('\x1b'));
        assert_eq!(console::strip_ansi_codes(&render_banner(true)), banner);
    }
}
