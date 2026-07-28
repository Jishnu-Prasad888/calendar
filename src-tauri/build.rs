fn main() {
    println!("cargo:rerun-if-env-changed=GOOGLE_CLIENT_ID");
    tauri_build::build()
}
