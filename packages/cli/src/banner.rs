use std::fmt::Write as _;
use std::io::IsTerminal;

const LOGO_LINES: &[&str] = &["⢠⡾⢻⣦⡀", "⣿⠁⣾⣉⣻⣦⡀", "⣿ ⣿⣉⣽⢿⡿⣦⡀", "⠘⣧⡈⠻⣧⣼⣧⡼⠿⣦", " ⠈⠛⠶⣤⣤⣤⣴⠾⠋"];
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

fn should_use_color() -> bool {
    std::io::stdout().is_terminal()
        && std::env::var_os("NO_COLOR").is_none()
        && std::env::var("TERM")
            .map(|term| term != "dumb")
            .unwrap_or(true)
}

pub(crate) fn print_banner() {
    println!();
    let banner = render_banner();
    if should_use_color() {
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
    fn renders_banner_with_logo_and_wordmark() {
        let banner = render_banner();
        assert!(banner.contains("░████████"));
        assert!(banner.lines().count() >= 5);
    }
}
