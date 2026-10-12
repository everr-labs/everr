#[derive(Clone, Copy)]
pub(crate) enum NpmScope {
    Project,
    Global,
    Temporary,
}

pub(crate) fn npm_scope() -> Option<NpmScope> {
    if std::env::var("EVERR_INSTALL_SOURCE").ok().as_deref() != Some("npm") {
        return None;
    }
    Some(
        match std::env::var("EVERR_NPM_INSTALL_SCOPE").ok().as_deref() {
            Some("global") => NpmScope::Global,
            Some("temporary") => NpmScope::Temporary,
            _ => NpmScope::Project,
        },
    )
}

impl NpmScope {
    pub(crate) fn update_command(self) -> &'static str {
        match self {
            Self::Project => "npm install @everr/cli@latest",
            Self::Global => "npm install --global @everr/cli@latest",
            Self::Temporary => "npx @everr/cli@latest <command>",
        }
    }

    pub(crate) fn removal_instruction(self) -> &'static str {
        match self {
            Self::Project => "npm uninstall @everr/cli",
            Self::Global => "npm uninstall --global @everr/cli",
            Self::Temporary => {
                "This temporary npx installation has no project dependency to remove."
            }
        }
    }
}
