fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    tauri_build::build()
}
