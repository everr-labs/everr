#[test]
fn tauri_runtime_registers_auth_account_commands() {
    let lib = include_str!("../src/lib.rs");
    let handler = lib
        .split(".invoke_handler(tauri::generate_handler![")
        .nth(1)
        .expect("tauri invoke handler should be declared");

    for command in ["get_user_profile", "get_org"] {
        assert!(
            handler.contains(&format!("{command},")),
            "missing {command} from tauri invoke handler"
        );
    }
}
