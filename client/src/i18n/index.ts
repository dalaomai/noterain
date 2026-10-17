/** Supported locales */
export type Locale = 'en' | 'zh';

/** English strings (source of truth) */
export const en = {
  // File controls
  openMidi: 'Import score',
  selectFile: 'Select file...',
  scoreHistory: 'Import history',
  scoreHistoryDescription: 'Saved in this browser. Select a score to load it again, even offline.',
  closeHistory: 'Close import history',
  historyEmpty: 'No import history yet. Imported scores will appear here.',
  historyLoading: 'Loading scores...',
  loadHistoryScore: 'Load {name}',
  removeHistoryScore: 'Remove {name} from history',
  historyImportError: 'Could not load this saved score. Please import the original file again.',
  historySaveError: 'The score is loaded, but its import history could not be saved.',
  historyStorageError: 'Could not access local history. Close other NoteRain tabs and try again.',

  // Playback
  floatingRemote: 'Playback remote',
  showFloatingRemote: 'Show floating playback remote',
  moveFloatingRemote: 'Move playback remote: drag or use arrow keys',
  startPlayback: 'Play',
  pausePlayback: 'Pause',
  muteAudio: 'Mute audio',
  enableAudio: 'Enable audio',
  volume: 'Volume: {percent}%',
  switchToLightTheme: 'Switch to light theme',
  switchToDarkTheme: 'Switch to dark theme',
  hideControls: 'Hide controls',
  showControls: 'Show controls',
  showToolbar: 'Show toolbar',
  enterFullscreen: 'Fullscreen (landscape)',
  exitFullscreen: 'Exit fullscreen',
  fullscreenError: 'The browser did not switch fullscreen. Tap the fullscreen button to retry.',
  rotateForFullscreen: 'Rotate your device to landscape for a larger view.',

  // View modes
  fallingNotes: 'Falling Notes',
  sheetMusic: 'Sheet Music',
  scoreMode: 'Score:',
  originalScore: 'Original',
  simplifiedScore: 'Simplified',
  scoreDensity: 'Density:',
  scoreDensityRelaxed: 'Relaxed',
  scoreDensityStandard: 'Standard',
  scoreDensityCompact: 'Compact',
  expandRepeats: 'Expand repeats',

  // Settings
  theme: 'Theme',
  displaySettings: 'Display & score',
  keyboardSettings: 'Keyboard',
  practiceSettings: 'Practice & playback',
  keepScreenAwake: 'Keep screen awake',
  keepScreenAwakeDescription: 'Keep the screen on while this page is visible, including pauses to read the score.',
  screenWakeLockActive: 'Screen awake',
  screenWakeLockRequesting: 'Enabling...',
  screenWakeLockUnsupported: 'Screen wake lock is unavailable in this browser or connection. Try HTTPS.',
  screenWakeLockError: 'Could not keep the screen awake. Check browser permissions or power saving settings.',
  retryScreenWakeLock: 'Retry',
  trackSettings: 'Tracks',
  deviceSettings: 'MIDI devices',
  audioSettings: 'Audio & offline',
  generalSettings: 'General',
  pinKeyboardExpanded: 'Keep keyboard expanded',
  waitForInput: 'Wait for input',
  grace: 'Grace:',
  fitKeyboardToSong: 'Fit keyboard to song',
  playMidiInput: 'Play MIDI input',
  loadingSamples: 'Loading samples...',
  showNotesChords: 'Show notes/chords',
  speed: 'Speed:',
  colors: 'Colors:',
  track: 'Track',
  pitch: 'Pitch',
  colorByTrack: 'Color notes by track',
  colorByPitch: 'Color notes by pitch (C, D, E, etc.)',
  midiInput: 'MIDI Input:',
  midiNotAvailable: 'MIDI not available',
  enableMidi: 'Enable MIDI',
  enablingMidi: 'Requesting access...',
  midiPermissionDenied: 'Allow MIDI in site settings',
  midiUnsupported: 'Web MIDI is not supported',
  midiRequiresHttps: 'HTTPS is required for MIDI',
  midiAccessError: 'Could not enable MIDI. Try again',
  connectBluetoothMidi: 'Bluetooth MIDI',
  connectingBluetoothMidi: 'Connecting Bluetooth...',
  disconnectBluetoothMidi: 'Disconnect Bluetooth MIDI',
  bluetoothMidiConnected: 'Bluetooth: {device}',
  bluetoothMidiError: 'Bluetooth MIDI failed. Try again',
  noDevices: 'No devices',
  none: 'None',

  // Loop
  loop: 'Loop:',
  toggleLoop: 'Toggle loop',
  loopStartMeasure: 'Loop start measure',
  loopEndMeasure: 'Loop end measure',
  clearLoop: 'Clear loop',

  // Tracks
  tracks: 'Tracks',
  hideTrack: 'Hide track',
  showTrackVisually: 'Show track visually',
  muteTrack: 'Mute track',
  playTrackAudio: 'Play track audio',

  // Offline pack
  offline: 'Offline:',
  offlineReady: 'Ready',
  downloadAudioPack: 'Download all piano samples (~85MB) for full offline use',
  audioPack: 'Audio pack',
  cancelDownload: 'Cancel download',
  removeOfflinePack: 'Remove offline audio pack (~85MB)',
  failedCount: '{count} failed',

  // Loading screen
  loadingPianoSamples: 'Loading Piano Samples',
  downloadingPianoSamples: 'Downloading Piano Samples',
  decodingPianoSamples: 'Decoding Piano Samples',
  samplesProgress: '{progress} / {total} samples',
  velocityLayersProgress: '{progress} / {total} velocity layers',

  // MusicXML
  loadingMusicXml: 'Loading MusicXML score...',
  musicXmlRenderError: 'Unable to render MusicXML score',
  musicXmlLoadingEngine: 'Loading notation engine',
  musicXmlParsingScore: 'Reading MusicXML score',
  musicXmlLayingOutScore: 'Laying out notation',
  musicXmlRenderingPages: 'Rendering pages',

  // Empty state
  emptyState: 'Drop a MIDI or MusicXML score here, or click "Import score"',

  // Language
  language: 'Language:',
  settings: 'Settings',
} as const;

export type TranslationKeys = keyof typeof en;

/** Chinese (Simplified) strings */
export const zh: Record<TranslationKeys, string> = {
  // File controls
  openMidi: '导入乐曲',
  selectFile: '选择文件...',
  scoreHistory: '导入历史',
  scoreHistoryDescription: '记录保存在当前浏览器中，点击乐曲即可重新载入，离线也可使用。',
  closeHistory: '关闭导入历史',
  historyEmpty: '暂无导入记录，导入乐曲后会自动保存在这里。',
  historyLoading: '正在载入乐曲...',
  loadHistoryScore: '载入 {name}',
  removeHistoryScore: '从历史记录移除 {name}',
  historyImportError: '无法载入这条记录，请重新导入原始文件。',
  historySaveError: '乐曲已载入，但导入历史保存失败。',
  historyStorageError: '无法读取本地历史，请关闭其他 NoteRain 标签页后重试。',

  // Playback
  floatingRemote: '悬浮小遥控',
  showFloatingRemote: '显示悬浮小遥控',
  moveFloatingRemote: '移动小遥控：拖动或使用方向键',
  startPlayback: '播放',
  pausePlayback: '暂停',
  muteAudio: '静音',
  enableAudio: '取消静音',
  volume: '音量：{percent}%',
  switchToLightTheme: '切换到浅色主题',
  switchToDarkTheme: '切换到深色主题',
  hideControls: '隐藏控制栏',
  showControls: '显示控制栏',
  showToolbar: '显示顶部栏',
  enterFullscreen: '全屏（自动横屏）',
  exitFullscreen: '退出全屏',
  fullscreenError: '浏览器未能切换全屏，请再次点击全屏按钮重试。',
  rotateForFullscreen: '浏览器无法自动横屏，请将设备旋转至横屏。',

  // View modes
  fallingNotes: '下落音符',
  sheetMusic: '五线谱',
  scoreMode: '乐谱：',
  originalScore: '原谱',
  simplifiedScore: '简化谱',
  scoreDensity: '乐谱密度：',
  scoreDensityRelaxed: '宽松',
  scoreDensityStandard: '标准',
  scoreDensityCompact: '紧凑',
  expandRepeats: '展开反复',

  // Settings
  theme: '主题',
  displaySettings: '显示与乐谱',
  keyboardSettings: '键盘',
  practiceSettings: '练习与播放',
  keepScreenAwake: '保持屏幕常亮',
  keepScreenAwakeDescription: '页面在前台时保持常亮，暂停读谱时也适用。',
  screenWakeLockActive: '常亮已启用',
  screenWakeLockRequesting: '正在启用...',
  screenWakeLockUnsupported: '当前浏览器或连接不支持屏幕常亮，请使用 HTTPS 访问。',
  screenWakeLockError: '未能保持常亮，请检查浏览器权限或省电设置。',
  retryScreenWakeLock: '重试',
  trackSettings: '音轨',
  deviceSettings: 'MIDI 设备',
  audioSettings: '音频与离线',
  generalSettings: '通用',
  pinKeyboardExpanded: '固定展开键盘',
  waitForInput: '跟弹模式',
  grace: '提前容差：',
  fitKeyboardToSong: '按乐曲范围显示键盘',
  playMidiInput: '播放 MIDI 输入音频',
  loadingSamples: '正在加载采样...',
  showNotesChords: '显示音符与和弦',
  speed: '速度：',
  colors: '着色方式：',
  track: '音轨',
  pitch: '音高',
  colorByTrack: '按音轨着色',
  colorByPitch: '按音高着色（C、D、E 等）',
  midiInput: 'MIDI 输入：',
  midiNotAvailable: 'MIDI 不可用',
  enableMidi: '启用 MIDI',
  enablingMidi: '正在请求授权...',
  midiPermissionDenied: '请在站点设置中允许 MIDI',
  midiUnsupported: '当前浏览器不支持 Web MIDI',
  midiRequiresHttps: 'MIDI 需要 HTTPS 安全连接',
  midiAccessError: '无法启用 MIDI，点击重试',
  connectBluetoothMidi: '连接蓝牙 MIDI',
  connectingBluetoothMidi: '正在连接蓝牙 MIDI...',
  disconnectBluetoothMidi: '断开蓝牙 MIDI',
  bluetoothMidiConnected: '蓝牙：{device}',
  bluetoothMidiError: '蓝牙 MIDI 连接失败，点击重试',
  noDevices: '未检测到设备',
  none: '不选择',

  // Loop
  loop: '循环：',
  toggleLoop: '切换循环播放',
  loopStartMeasure: '循环起始小节',
  loopEndMeasure: '循环结束小节',
  clearLoop: '清除循环',

  // Tracks
  tracks: '音轨',
  hideTrack: '隐藏音轨',
  showTrackVisually: '显示音轨画面',
  muteTrack: '将音轨静音',
  playTrackAudio: '取消音轨静音',

  // Offline pack
  offline: '离线：',
  offlineReady: '可离线使用',
  downloadAudioPack: '下载全部钢琴采样（约 85MB），供离线使用',
  audioPack: '下载离线钢琴音色',
  cancelDownload: '取消下载',
  removeOfflinePack: '删除离线音源包（约 85MB）',
  failedCount: '{count} 个失败',

  // Loading screen
  loadingPianoSamples: '正在读取钢琴采样',
  downloadingPianoSamples: '正在下载钢琴采样',
  decodingPianoSamples: '正在解码钢琴采样',
  samplesProgress: '{progress} / {total} 个采样',
  velocityLayersProgress: '{progress} / {total} 个力度分层',

  // MusicXML
  loadingMusicXml: '正在载入 MusicXML 乐谱...',
  musicXmlRenderError: '无法渲染 MusicXML 乐谱',
  musicXmlLoadingEngine: '正在载入乐谱引擎',
  musicXmlParsingScore: '正在读取 MusicXML 乐谱',
  musicXmlLayingOutScore: '正在计算乐谱排版',
  musicXmlRenderingPages: '正在渲染乐谱页面',

  // Empty state
  emptyState: '将 MIDI 或 MusicXML 乐谱拖到此处，或点击“导入乐曲”',

  // Language
  language: '语言：',
  settings: '设置',
};

/** All locale dictionaries */
export const dictionaries: Record<Locale, Record<TranslationKeys, string>> = {
  en,
  zh,
};

/** Available locale options for UI */
export const LOCALE_OPTIONS: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
];

/** Detect browser locale */
export function detectLocale(): Locale {
  const saved = localStorage.getItem('noterain-locale');
  if (saved === 'en' || saved === 'zh') return saved;
  const lang = navigator.language?.toLowerCase() ?? 'en';
  return lang.startsWith('zh') ? 'zh' : 'en';
}

/** Persist locale choice */
export function saveLocale(locale: Locale): void {
  localStorage.setItem('noterain-locale', locale);
}
