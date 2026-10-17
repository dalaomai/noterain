/** Supported locales */
export type Locale = 'en' | 'zh';

/** English strings (source of truth) */
export const en = {
  // File controls
  openMidi: 'Import score',
  selectFile: 'Select file...',

  // Playback
  muteAudio: 'Mute audio',
  enableAudio: 'Enable audio',
  volume: 'Volume: {percent}%',
  switchToLightTheme: 'Switch to light theme',
  switchToDarkTheme: 'Switch to dark theme',
  hideControls: 'Hide controls',
  showControls: 'Show controls',

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
} as const;

export type TranslationKeys = keyof typeof en;

/** Chinese (Simplified) strings */
export const zh: Record<TranslationKeys, string> = {
  // File controls
  openMidi: '导入乐曲',
  selectFile: '选择文件...',

  // Playback
  muteAudio: '静音',
  enableAudio: '取消静音',
  volume: '音量：{percent}%',
  switchToLightTheme: '切换到浅色主题',
  switchToDarkTheme: '切换到深色主题',
  hideControls: '隐藏控制栏',
  showControls: '显示控制栏',

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
