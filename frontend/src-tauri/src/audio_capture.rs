use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use hound::{WavSpec, WavWriter};
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// 全局录音状态
static IS_RECORDING: AtomicBool = AtomicBool::new(false);

/// 录音线程句柄
static RECORDING_HANDLE: once_cell::sync::Lazy<Arc<Mutex<Option<thread::JoinHandle<()>>>>>
    = once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(None)));

/// 音频数据缓冲
static AUDIO_BUFFER: once_cell::sync::Lazy<Arc<Mutex<Vec<i16>>>>
    = once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(Vec::new())));

/// 采样率配置
static SAMPLE_RATE_CONFIG: once_cell::sync::Lazy<Arc<Mutex<(u32, u16)>>>
    = once_cell::sync::Lazy::new(|| Arc::new(Mutex::new((44100, 1))));

/// 录音状态控制
static RECORDING_ACTIVE: once_cell::sync::Lazy<Arc<AtomicBool>>
    = once_cell::sync::Lazy::new(|| Arc::new(AtomicBool::new(false)));

/// 获取可用的音频输入设备列表
#[tauri::command]
pub fn list_audio_devices() -> Result<Vec<String>, String> {
    log::info!("list_audio_devices: enumerating audio devices");

    let host = cpal::default_host();
    let mut devices = Vec::new();

    let input_devices = host
        .input_devices()
        .map_err(|e| format!("Failed to enumerate devices: {}", e))?;

    for (i, device) in input_devices.enumerate() {
        let name = device.name().unwrap_or_else(|_| format!("Device {}", i));
        devices.push(name);
    }

    if devices.is_empty() {
        return Err("No audio input devices found".to_string());
    }

    log::info!("list_audio_devices: found {} devices", devices.len());
    Ok(devices)
}

/// 开始录音
#[tauri::command]
pub fn start_audio_recording() -> Result<(), String> {
    log::info!("start_audio_recording: starting");

    if IS_RECORDING.load(Ordering::SeqCst) {
        log::warn!("start_audio_recording: already recording");
        return Err("Already recording".to_string());
    }

    let host = cpal::default_host();

    let device = host
        .default_input_device()
        .ok_or_else(|| "No audio input device found".to_string())?;

    log::info!("Using device: {:?}", device.name());

    let config = device
        .default_input_config()
        .map_err(|e| format!("Failed to get audio config: {}", e))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels();

    // 保存配置
    {
        let mut cfg = SAMPLE_RATE_CONFIG.lock().unwrap();
        *cfg = (sample_rate, channels);
    }

    // 清空缓冲
    {
        let mut buf = AUDIO_BUFFER.lock().unwrap();
        buf.clear();
    }

    // 重置录音状态
    RECORDING_ACTIVE.store(true, Ordering::SeqCst);

    // 创建录音线程
    let buffer = AUDIO_BUFFER.clone();
    let active_for_stream = RECORDING_ACTIVE.clone();
    let active_for_loop = RECORDING_ACTIVE.clone();

    let handle = thread::spawn(move || {
        log::info!("Recording thread started");

        let stream = match config.sample_format() {
            cpal::SampleFormat::I16 => {
                device.build_input_stream(
                    &config.into(),
                    move |data: &[i16], _: &cpal::InputCallbackInfo| {
                        if active_for_stream.load(Ordering::SeqCst) {
                            let mut buf = buffer.lock().unwrap();
                            buf.extend_from_slice(data);
                        }
                    },
                    |err| log::error!("Stream error: {}", err),
                    None,
                )
            }
            cpal::SampleFormat::F32 => {
                device.build_input_stream(
                    &config.into(),
                    move |data: &[f32], _: &cpal::InputCallbackInfo| {
                        if active_for_stream.load(Ordering::SeqCst) {
                            let mut buf = buffer.lock().unwrap();
                            for &sample in data.iter() {
                                buf.push((sample * 32767.0).clamp(-32768.0, 32767.0) as i16);
                            }
                        }
                    },
                    |err| log::error!("Stream error: {}", err),
                    None,
                )
            }
            _ => {
                log::error!("Unsupported sample format: {:?}", config.sample_format());
                return;
            }
        };

        if let Ok(stream) = stream {
            if let Err(e) = stream.play() {
                log::error!("Failed to start stream: {}", e);
                return;
            }

            log::info!("Recording stream playing");

            // 保持录音直到被停止
            // 使用短睡眠循环避免忙等待
            while active_for_loop.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(50));
            }

            log::info!("Recording thread: stop signal received");
            drop(stream);
        }
    });

    // 保存线程句柄
    {
        let mut handle_guard = RECORDING_HANDLE.lock().unwrap();
        *handle_guard = Some(handle);
    }

    IS_RECORDING.store(true, Ordering::SeqCst);

    log::info!(
        "Recording started: sample_rate={}, channels={}",
        sample_rate,
        channels
    );
    Ok(())
}

/// 停止录音并返回 Base64 编码的 WAV
#[tauri::command]
pub fn stop_audio_recording() -> Result<String, String> {
    log::info!("stop_audio_recording: stopping");

    if !IS_RECORDING.load(Ordering::SeqCst) {
        log::warn!("stop_audio_recording: not recording");
        return Err("Not recording".to_string());
    }

    // 停止录音线程
    RECORDING_ACTIVE.store(false, Ordering::SeqCst);
    IS_RECORDING.store(false, Ordering::SeqCst);

    // 等待线程结束
    {
        let mut handle_guard = RECORDING_HANDLE.lock().unwrap();
        if let Some(handle) = handle_guard.take() {
            log::info!("Waiting for recording thread to finish...");
            drop(handle); // 通知线程停止并等待
        }
    }

    // 获取音频数据
    let samples = {
        let buf = AUDIO_BUFFER.lock().unwrap();
        buf.clone()
    };
    let (sample_rate, channels) = *SAMPLE_RATE_CONFIG.lock().unwrap();

    log::info!(
        "Recording stopped: {} samples, {} Hz, {} channels",
        samples.len(),
        sample_rate,
        channels
    );

    if samples.is_empty() {
        log::error!("No audio data recorded - buffer was empty");
        return Err("No audio data recorded".to_string());
    }

    // 编码为 WAV
    let wav_data = encode_wav(&samples, sample_rate, channels)?;

    // 转为 Base64
    use base64::{engine::general_purpose::STANDARD, Engine};
    let b64 = STANDARD.encode(&wav_data);

    log::info!("Audio encoded to base64, length: {}", b64.len());

    Ok(b64)
}

/// 检查是否正在录音
#[tauri::command]
pub fn is_audio_recording() -> bool {
    IS_RECORDING.load(Ordering::SeqCst)
}

/// 将 PCM 数据编码为 WAV 格式
fn encode_wav(samples: &[i16], sample_rate: u32, channels: u16) -> Result<Vec<u8>, String> {
    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = WavWriter::new(&mut cursor, spec)
            .map_err(|e| format!("Failed to create WAV writer: {}", e))?;

        for &sample in samples {
            writer
                .write_sample(sample)
                .map_err(|e| format!("Failed to write sample: {}", e))?;
        }

        writer
            .finalize()
            .map_err(|e| format!("Failed to finalize WAV: {}", e))?;
    }

    Ok(cursor.into_inner())
}
