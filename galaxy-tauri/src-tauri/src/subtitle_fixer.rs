use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::fs;

use crate::fs_guard::OutputFileGuard;
use crate::logging::AppLogger;
use crate::models::AppError;

static SUB_FIX_SEQ: AtomicU64 = AtomicU64::new(0);

/// Persian/Arabic subtitle charset detector and UTF-8 BOM transcoder.
pub struct SubtitleFixer;

impl SubtitleFixer {
    /// Maps a single Windows-1256 (CP1256) byte to its Unicode character.
    pub fn cp1256_byte_to_char(b: u8) -> char {
        match b {
            0x00..=0x7F => b as char,
            0x80 => '\u{20AC}', // Euro
            0x81 => '\u{067E}', // Peh (پ)
            0x82 => '\u{201A}',
            0x83 => '\u{0192}',
            0x84 => '\u{201E}',
            0x85 => '\u{2026}',
            0x86 => '\u{2020}',
            0x87 => '\u{2021}',
            0x88 => '\u{02C6}',
            0x89 => '\u{2030}',
            0x8A => '\u{0679}', // Tteh
            0x8B => '\u{2039}',
            0x8C => '\u{0152}',
            0x8D => '\u{0686}', // Tcheh / Cheh (چ)
            0x8E => '\u{0698}', // Zheh (ژ)
            0x8F => '\u{0688}', // Ddal
            0x90 => '\u{06AF}', // Gaf (گ)
            0x91 => '\u{2018}',
            0x92 => '\u{2019}',
            0x93 => '\u{201C}',
            0x94 => '\u{201D}',
            0x95 => '\u{2022}',
            0x96 => '\u{2013}',
            0x97 => '\u{2014}',
            0x98 => '\u{06A9}', // Keheh / Kaaf (ک)
            0x99 => '\u{2122}',
            0x9A => '\u{0691}', // Rreh
            0x9B => '\u{203A}',
            0x9C => '\u{0153}',
            0x9D => '\u{200C}', // ZWNJ (نیم‌فاصله)
            0x9E => '\u{200D}', // ZWJ
            0x9F => '\u{06BA}', // Noon Ghunna
            0xA0 => '\u{00A0}', // NBSP
            0xA1 => '\u{060C}', // Arabic comma (،)
            0xA2 => '\u{00A2}',
            0xA3 => '\u{00A3}',
            0xA4 => '\u{00A4}',
            0xA5 => '\u{00A5}',
            0xA6 => '\u{00A6}',
            0xA7 => '\u{00A7}',
            0xA8 => '\u{00A8}',
            0xA9 => '\u{00A9}',
            0xAA => '\u{06BE}',
            0xAB => '\u{00AB}',
            0xAC => '\u{00AC}',
            0xAD => '\u{00AD}',
            0xAE => '\u{00AE}',
            0xAF => '\u{00AF}',
            0xB0 => '\u{00B0}',
            0xB1 => '\u{00B1}',
            0xB2 => '\u{00B2}',
            0xB3 => '\u{00B3}',
            0xB4 => '\u{00B4}',
            0xB5 => '\u{00B5}',
            0xB6 => '\u{00B6}',
            0xB7 => '\u{00B7}',
            0xB8 => '\u{00B8}',
            0xB9 => '\u{00B9}',
            0xBA => '\u{061B}', // Arabic semicolon (؛)
            0xBB => '\u{00BB}',
            0xBC => '\u{0152}',
            0xBD => '\u{0153}',
            0xBE => '\u{0178}',
            0xBF => '\u{061F}', // Arabic question mark (؟)
            0xC0 => '\u{06C1}',
            0xC1 => '\u{0621}', // Hamza
            0xC2 => '\u{0622}', // Alef with madda (آ)
            0xC3 => '\u{0623}', // Alef with hamza above (أ)
            0xC4 => '\u{0624}', // Waw with hamza (ؤ)
            0xC5 => '\u{0625}', // Alef with hamza below (إ)
            0xC6 => '\u{0626}', // Yeh with hamza (ئ)
            0xC7 => '\u{0627}', // Alef (ا)
            0xC8 => '\u{0628}', // Beh (ب)
            0xC9 => '\u{0629}', // Teh Marbuta (ة)
            0xCA => '\u{062A}', // Teh (ت)
            0xCB => '\u{062B}', // Theh (ث)
            0xCC => '\u{062C}', // Jeem (ج)
            0xCD => '\u{062D}', // Hah (ح)
            0xCE => '\u{062E}', // Khaa (خ)
            0xCF => '\u{062F}', // Daal (د)
            0xD0 => '\u{0630}', // Thaal (ذ)
            0xD1 => '\u{0631}', // Reh (ر)
            0xD2 => '\u{0632}', // Zain (ز)
            0xD3 => '\u{0633}', // Seen (س)
            0xD4 => '\u{0634}', // Sheen (ش)
            0xD5 => '\u{0635}', // Saad (ص)
            0xD6 => '\u{0636}', // Daad (ض)
            0xD7 => '\u{00D7}', // Multiplication
            0xD8 => '\u{0637}', // Taa (ط)
            0xD9 => '\u{0638}', // Zaa (ظ)
            0xDA => '\u{0639}', // Ain (ع)
            0xDB => '\u{063A}', // Ghain (غ)
            0xDC => '\u{0640}', // Tatweel
            0xDD => '\u{0641}', // Feh (ف)
            0xDE => '\u{0642}', // Qaaf (ق)
            0xDF => '\u{06A9}', // Persian Kaaf (ک)
            0xE0 => '\u{00E0}',
            0xE1 => '\u{0644}', // Laam (ل)
            0xE2 => '\u{00E2}',
            0xE3 => '\u{0645}', // Meem (م)
            0xE4 => '\u{0646}', // Noon (ن)
            0xE5 => '\u{0647}', // Heh (ه)
            0xE6 => '\u{0648}', // Waw (و)
            0xE7 => '\u{00E7}',
            0xE8 => '\u{00E8}',
            0xE9 => '\u{00E9}',
            0xEA => '\u{00EA}',
            0xEB => '\u{00EB}',
            0xEC => '\u{0649}', // Alef maksura (ى)
            0xED => '\u{06CC}', // Persian Yeh (ی)
            0xEE => '\u{00EE}',
            0xEF => '\u{00EF}',
            0xF0 => '\u{064B}', // Fathatan
            0xF1 => '\u{064C}', // Dammatan
            0xF2 => '\u{064D}', // Kasratan
            0xF3 => '\u{064E}', // Fatha
            0xF4 => '\u{064F}', // Damma
            0xF5 => '\u{0650}', // Kasra
            0xF6 => '\u{0651}', // Shadda
            0xF7 => '\u{00F7}', // Division
            0xF8 => '\u{0652}', // Sukun
            0xF9 => '\u{00F9}',
            0xFA => '\u{00FA}',
            0xFB => '\u{00FB}',
            0xFC => '\u{00FC}',
            0xFD => '\u{200E}', // LRM
            0xFE => '\u{200F}', // RLM
            0xFF => '\u{06D2}',
        }
    }

    /// Converts raw Windows-1256 bytes into a UTF-8 string prefixed with a UTF-8 BOM.
    pub fn convert_cp1256_to_utf8(raw_bytes: &[u8]) -> String {
        let mut result = String::with_capacity(raw_bytes.len() * 2 + 3);
        result.push('\u{FEFF}');
        for &b in raw_bytes {
            result.push(Self::cp1256_byte_to_char(b));
        }
        result
    }

    /// Writes the transcoded subtitle atomically and collision-safely via [`OutputFileGuard`].
    pub async fn write_output_sub(file_path: &Path, content: &str) -> Result<PathBuf, AppError> {
        let out_stem = file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("sub");
        let ext = file_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("srt");
        let parent = match file_path.parent() {
            Some(p) if !p.as_os_str().is_empty() => p,
            _ => Path::new("."),
        };

        let target_name = format!("{}_utf8.{}", out_stem, ext);
        let job_id = format!(
            "subfix_{}_{}",
            std::process::id(),
            SUB_FIX_SEQ.fetch_add(1, Ordering::Relaxed)
        );

        let mut guard = OutputFileGuard::new(parent, &target_name, &job_id).await?;
        if let Err(err) = fs::write(&guard.temp_path, content.as_bytes()).await {
            guard.abort_cleanup().await;
            return Err(AppError::Io {
                message: format!("Failed to write fixed subtitle staging file: {}", err),
                path: Some(guard.temp_path.to_string_lossy().to_string()),
            });
        }

        guard.commit().await
    }

    fn decode_utf16(bytes: &[u8], little_endian: bool, file_path: &Path) -> String {
        let (chunks, remainder) = bytes.as_chunks::<2>();
        let has_trailing_odd_byte = !remainder.is_empty();

        let u16_words: Vec<u16> = chunks
            .iter()
            .map(|c| {
                if little_endian {
                    u16::from_le_bytes(*c)
                } else {
                    u16::from_be_bytes(*c)
                }
            })
            .collect();

        let mut decoded: String = char::decode_utf16(u16_words)
            .map(|r| r.unwrap_or('\u{FFFD}'))
            .collect();

        if has_trailing_odd_byte {
            AppLogger::warn(
                "subtitle_fixer",
                &format!(
                    "Odd trailing byte detected in UTF-16 subtitle {:?}; appended U+FFFD replacement character",
                    file_path
                ),
            );
            decoded.push('\u{FFFD}');
        }

        format!("\u{FEFF}{}", decoded.trim_start_matches('\u{FEFF}'))
    }

    /// Detects UTF-16 LE/BE, UTF-8, or Windows-1256 encoding and writes a UTF-8 BOM-prefixed subtitle.
    pub async fn fix_subtitle_file(file_path: &Path) -> Result<PathBuf, AppError> {
        if !file_path.is_file() {
            return Err(AppError::FileNotFound(
                file_path.to_string_lossy().to_string(),
            ));
        }

        let raw_bytes = fs::read(file_path).await.map_err(|e| AppError::Io {
            message: format!("Failed to read subtitle file: {}", e),
            path: Some(file_path.to_string_lossy().to_string()),
        })?;

        if raw_bytes.starts_with(&[0xFF, 0xFE]) {
            let content_with_bom = Self::decode_utf16(&raw_bytes[2..], true, file_path);
            return Self::write_output_sub(file_path, &content_with_bom).await;
        } else if raw_bytes.starts_with(&[0xFE, 0xFF]) {
            let content_with_bom = Self::decode_utf16(&raw_bytes[2..], false, file_path);
            return Self::write_output_sub(file_path, &content_with_bom).await;
        }

        if let Ok(valid_utf8) = std::str::from_utf8(&raw_bytes) {
            let content_with_bom = if valid_utf8.starts_with('\u{FEFF}') {
                valid_utf8.to_string()
            } else {
                format!("\u{FEFF}{}", valid_utf8)
            };
            return Self::write_output_sub(file_path, &content_with_bom).await;
        }

        let utf8_string = Self::convert_cp1256_to_utf8(&raw_bytes);
        Self::write_output_sub(file_path, &utf8_string).await
    }
}
