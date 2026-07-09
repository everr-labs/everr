#[test]
fn sqlguard_rejects_non_select() {
    assert!(cc::sqlguard::validate("DROP TABLE x").is_err());
    assert!(cc::sqlguard::validate("SELECT 1").is_ok());
}
