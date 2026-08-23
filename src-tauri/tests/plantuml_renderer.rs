#[allow(dead_code)]
#[path = "../src/plantuml.rs"]
mod plantuml;

use std::path::Path;
use std::time::Instant;

#[test]
fn plantuml_uses_the_bundled_java_and_jar_resource_layout() {
    let paths = plantuml::bundled_paths(Path::new(r"C:\Niuery\resources"));

    assert_eq!(
        paths.java,
        Path::new(r"C:\Niuery\resources\plantuml\jre\bin\java.exe")
    );
    assert_eq!(
        paths.jar,
        Path::new(r"C:\Niuery\resources\plantuml\plantuml.jar")
    );
}

#[test]
fn plantuml_svg_command_reads_utf8_source_from_standard_input() {
    let paths = plantuml::bundled_paths(Path::new(r"C:\Niuery\resources"));

    assert_eq!(
        plantuml::command_arguments(&paths, "svg"),
        vec![
            "-Djava.awt.headless=true",
            "-jar",
            r"C:\Niuery\resources\plantuml\plantuml.jar",
            "-charset",
            "UTF-8",
            "-tsvg",
            "-pipe",
        ]
    );
}

#[test]
fn plantuml_svg_command_strips_windows_extended_path_prefix_from_jar_argument() {
    let paths = plantuml::PlantUmlPaths {
        java: Path::new(r"C:\Niuery\resources\plantuml\jre\bin\java.exe").to_path_buf(),
        jar: Path::new(r"\\?\C:\Niuery\resources\plantuml\plantuml.jar").to_path_buf(),
    };

    assert_eq!(
        plantuml::command_arguments(&paths, "svg")[2],
        r"C:\Niuery\resources\plantuml\plantuml.jar"
    );
}

#[test]
fn plantuml_applies_the_dark_theme_inside_the_uml_document() {
    assert_eq!(
        plantuml::apply_scheme("@startuml\nAlice -> Bob\n@enduml", "dark").unwrap(),
        "@startuml\n!theme cyborg\nAlice -> Bob\n@enduml"
    );
    assert_eq!(
        plantuml::apply_scheme("@startuml\nAlice -> Bob\n@enduml", "light").unwrap(),
        "@startuml\nAlice -> Bob\n@enduml"
    );
}

#[test]
fn plantuml_reuses_the_jvm_for_consecutive_svg_renders() {
    let resource_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
    let paths = plantuml::bundled_paths(&resource_dir);
    if !paths.java.is_file() || !paths.jar.is_file() {
        return;
    }

    let source = "@startuml\nAlice -> Bob: warm\n@enduml";
    let first_started = Instant::now();
    let first = plantuml::render(&paths, source, "light", "svg").unwrap();
    let first_elapsed = first_started.elapsed();
    let second_started = Instant::now();
    let second = plantuml::render(&paths, source, "light", "svg").unwrap();
    let second_elapsed = second_started.elapsed();

    assert!(first.starts_with(b"<?xml") || first.starts_with(b"<svg"));
    assert!(second.starts_with(b"<?xml") || second.starts_with(b"<svg"));
    assert!(
        second_elapsed < first_elapsed,
        "first={first_elapsed:?}, second={second_elapsed:?}"
    );
}

#[test]
fn plantuml_reuses_the_jvm_for_png_renders_and_keeps_png_bytes_intact() {
    let resource_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
    let paths = plantuml::bundled_paths(&resource_dir);
    if !paths.java.is_file() || !paths.jar.is_file() {
        return;
    }

    let source = "@startuml\nAlice -> Bob: png\n@enduml";
    let first = plantuml::render(&paths, source, "light", "png").unwrap();
    let second = plantuml::render(&paths, source, "light", "png").unwrap();

    assert!(first.starts_with(b"\x89PNG\r\n\x1a\n"));
    assert!(second.starts_with(b"\x89PNG\r\n\x1a\n"));
}

#[test]
fn plantuml_does_not_wait_forever_for_incomplete_source() {
    let resource_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
    let paths = plantuml::bundled_paths(&resource_dir);
    if !paths.java.is_file() || !paths.jar.is_file() {
        return;
    }

    let started = Instant::now();
    let result = plantuml::render(&paths, "@startuml\nAlice ->\n@enduml", "light", "svg");

    assert!(result.is_ok());
    assert!(
        started.elapsed().as_secs() < 3,
        "render took {:?}",
        started.elapsed()
    );
}
