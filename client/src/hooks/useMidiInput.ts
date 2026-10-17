import { useEffect, useState, useRef } from 'react';
import { WebMidi, NoteMessageEvent, ControlChangeMessageEvent } from 'webmidi';
import { useMidiStore } from '../stores/midiStore';
import type { MidiDevice } from '../types/midi';

/** MIDI CC number for sustain pedal */
const SUSTAIN_CC = 64;

export type MidiAccessState =
  | 'unsupported'
  | 'insecure'
  | 'idle'
  | 'requesting'
  | 'enabled'
  | 'denied'
  | 'error';

let accessState: MidiAccessState = WebMidi.enabled
  ? 'enabled'
  : typeof window !== 'undefined' && !window.isSecureContext
    ? 'insecure'
  : typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
    ? 'idle'
    : 'unsupported';
let accessError: string | null = null;
let enablePromise: Promise<void> | null = null;
let deviceListenersInstalled = false;
const accessListeners = new Set<() => void>();

function notifyAccessListeners() {
  accessListeners.forEach((listener) => listener());
}

function updateDevices() {
  const midiDevices: MidiDevice[] = [
    ...WebMidi.inputs.map((input) => ({
      id: input.id,
      name: input.name,
      manufacturer: input.manufacturer,
      type: 'input' as const,
      connected: true,
    })),
    ...WebMidi.outputs.map((output) => ({
      id: output.id,
      name: output.name,
      manufacturer: output.manufacturer,
      type: 'output' as const,
      connected: true,
    })),
  ];
  useMidiStore.getState().setDevices(midiDevices);
}

function autoSelectDevice() {
  const state = useMidiStore.getState();
  const hardwareInputs = WebMidi.inputs.filter(
    (input) => !isVirtualDevice(input.name, input.manufacturer),
  );
  const selectedStillExists = hardwareInputs.some(
    (input) => input.id === state.selectedInputId,
  );
  if (hardwareInputs.length > 0 && (!state.selectedInputId || !selectedStillExists)) {
    state.selectInput(hardwareInputs[0].id);
  }
}

function installDeviceListeners() {
  if (deviceListenersInstalled) return;
  deviceListenersInstalled = true;
  WebMidi.addListener('connected', () => {
    updateDevices();
    autoSelectDevice();
  });
  WebMidi.addListener('disconnected', updateDevices);
}

async function requestMidiAccess(): Promise<void> {
  if (WebMidi.enabled) {
    accessState = 'enabled';
    updateDevices();
    autoSelectDevice();
    installDeviceListeners();
    notifyAccessListeners();
    return;
  }
  if (accessState === 'unsupported' || accessState === 'insecure') return;
  if (enablePromise) return enablePromise;

  accessState = 'requesting';
  accessError = null;
  notifyAccessListeners();

  enablePromise = WebMidi.enable({ sysex: false })
    .then(() => {
      accessState = 'enabled';
      updateDevices();
      autoSelectDevice();
      installDeviceListeners();
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      accessError = message;
      accessState = /permission|notallowed|denied/i.test(message)
        ? 'denied'
        : 'error';
      throw error;
    })
    .finally(() => {
      enablePromise = null;
      notifyAccessListeners();
    });

  return enablePromise;
}

/** Options for the useMidiInput hook */
export interface UseMidiInputOptions {
  /** Called when a note is pressed on the MIDI device */
  onNoteOn?: (noteNumber: number, velocity: number) => void;
  /** Called when a note is released on the MIDI device */
  onNoteOff?: (noteNumber: number) => void;
  /** Called when the sustain pedal state changes */
  onSustain?: (isPressed: boolean) => void;
}

/** Patterns that indicate virtual/software MIDI devices */
const VIRTUAL_DEVICE_PATTERNS = [
  /midi through/i,
  /iac driver/i,
  /loopbe/i,
  /loopmidi/i,
  /virtual/i,
  /microsoft gs/i,
  /wavetable/i,
  /synth/i,
  /rtpmidi/i,
  /network/i,
  /bus/i,
  /webmidi/i,
  /^output$/i,
];

/** Check if a device is likely a virtual/software MIDI device */
function isVirtualDevice(name: string, manufacturer: string): boolean {
  const combined = `${name} ${manufacturer}`.toLowerCase();
  return VIRTUAL_DEVICE_PATTERNS.some((pattern) => pattern.test(combined));
}

/** Hook for connecting to MIDI devices */
export function useMidiInput(options: UseMidiInputOptions = {}) {
  const {
    devices,
    selectedInputId,
    selectInput,
    setLiveNote,
    clearLiveNotes,
    addSatisfiedWaitNote,
  } = useMidiStore();

  const [midiAccessState, setMidiAccessState] = useState(accessState);
  const [midiAccessError, setMidiAccessError] = useState(accessError);

  // Store callbacks in refs to avoid re-subscribing when callbacks change
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  // Subscribe to the module-level singleton permission state. Permission is
  // requested only from requestAccess(), which is called by a user gesture.
  useEffect(() => {
    const update = () => {
      setMidiAccessState(accessState);
      setMidiAccessError(accessError);
    };
    accessListeners.add(update);
    if (WebMidi.enabled) void requestMidiAccess();
    return () => {
      accessListeners.delete(update);
    };
  }, []);

  // Handle input selection and note events
  useEffect(() => {
    const handlesMidiMessages = Boolean(
      options.onNoteOn || options.onNoteOff || options.onSustain,
    );
    if (!handlesMidiMessages || midiAccessState !== 'enabled' || !selectedInputId) {
      clearLiveNotes();
      return;
    }

    const input = WebMidi.getInputById(selectedInputId);
    if (!input) {
      console.log('[MidiInput] Selected input not found:', selectedInputId);
      clearLiveNotes();
      return;
    }

    console.log('[MidiInput] Listening for notes on:', input.name);

    const handleNoteOn = (e: NoteMessageEvent) => {
      setLiveNote(e.note.number, true);
      addSatisfiedWaitNote(e.note.number);
      callbacksRef.current.onNoteOn?.(e.note.number, e.note.rawAttack);
    };

    const handleNoteOff = (e: NoteMessageEvent) => {
      setLiveNote(e.note.number, false);
      callbacksRef.current.onNoteOff?.(e.note.number);
    };

    const handleControlChange = (e: ControlChangeMessageEvent) => {
      // Handle sustain pedal (CC64)
      if (e.controller.number === SUSTAIN_CC) {
        const isPressed = (e.rawValue ?? 0) >= 64;
        callbacksRef.current.onSustain?.(isPressed);
      }
    };

    input.addListener('noteon', handleNoteOn);
    input.addListener('noteoff', handleNoteOff);
    input.addListener('controlchange', handleControlChange);

    return () => {
      input.removeListener('noteon', handleNoteOn);
      input.removeListener('noteoff', handleNoteOff);
      input.removeListener('controlchange', handleControlChange);
      clearLiveNotes();
    };
  }, [midiAccessState, selectedInputId, setLiveNote, clearLiveNotes, addSatisfiedWaitNote]);

  // Get available inputs (filter out virtual devices)
  const inputs = devices.filter(
    (d) => d.type === 'input' && !isVirtualDevice(d.name, d.manufacturer)
  );
  const outputs = devices.filter(
    (d) => d.type === 'output' && !isVirtualDevice(d.name, d.manufacturer)
  );

  const selectedInput = inputs.find((d) => d.id === selectedInputId);

  return {
    inputs,
    outputs,
    selectedInput,
    selectInput,
    isEnabled: midiAccessState === 'enabled',
    accessState: midiAccessState,
    accessError: midiAccessError,
    requestAccess: requestMidiAccess,
  };
}
