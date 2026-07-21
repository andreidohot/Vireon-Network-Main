#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app;
mod secure;
mod services;

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title("Vireon.exe")
            .with_decorations(false)
            .with_inner_size([1600.0, 900.0])
            .with_min_inner_size([1120.0, 720.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Vireon Desktop",
        options,
        Box::new(|context| Ok(Box::new(app::VireonApp::new(context)))),
    )
}
