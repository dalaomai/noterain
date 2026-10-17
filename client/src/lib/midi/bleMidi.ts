const BLE_MIDI_SERVICE = '03b80e5a-ede8-4b33-a751-6ce34ec4c700';
const BLE_MIDI_CHARACTERISTIC = '7772e5db-3868-4112-a1a9-f2669d106bf3';

export type BleMidiConnectionState =
  | 'unsupported'
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface BleMidiMessage {
  status: number;
  data1: number;
  data2: number;
}

export interface BleMidiConnection {
  deviceName: string;
  disconnect: () => void;
}

function isStatusByte(value: number): boolean {
  return (value & 0x80) !== 0;
}

/**
 * Decode BLE-MIDI packets into standard three-byte channel messages.
 * BLE-MIDI uses high-bit timestamp bytes around ordinary MIDI status/data bytes.
 */
export function decodeBleMidiPacket(data: DataView): BleMidiMessage[] {
  if (data.byteLength < 3) return [];

  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const messages: BleMidiMessage[] = [];
  let index = 1; // first byte is the high timestamp header
  let runningStatus = 0;

  while (index < bytes.length) {
    // A timestamp-low byte always has bit 7 set. It is followed by either a
    // status byte or MIDI data under running status.
    if (isStatusByte(bytes[index])) index++;
    if (index >= bytes.length) break;

    if (isStatusByte(bytes[index])) {
      runningStatus = bytes[index++];
    }
    if (!runningStatus || index >= bytes.length) break;

    const command = runningStatus & 0xf0;
    const dataLength = command === 0xc0 || command === 0xd0 ? 1 : 2;
    const data1 = bytes[index++] & 0x7f;
    const data2 = dataLength === 2 && index < bytes.length
      ? bytes[index++] & 0x7f
      : 0;

    if (command >= 0x80 && command <= 0xe0) {
      messages.push({ status: runningStatus, data1, data2 });
    }
  }

  return messages;
}

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export async function connectBleMidi(
  onMessage: (message: BleMidiMessage) => void,
  onDisconnected: () => void,
): Promise<BleMidiConnection> {
  if (!isWebBluetoothSupported()) {
    throw new Error('Web Bluetooth is not supported');
  }

  const bluetooth = navigator.bluetooth;
  const device = await bluetooth.requestDevice({
    filters: [{ services: [BLE_MIDI_SERVICE] }],
    optionalServices: [BLE_MIDI_SERVICE],
  });

  const server = await device.gatt?.connect();
  if (!server) throw new Error('Unable to connect to Bluetooth MIDI device');

  const service = await server.getPrimaryService(BLE_MIDI_SERVICE);
  const characteristic = await service.getCharacteristic(BLE_MIDI_CHARACTERISTIC);

  const handleValueChanged = (event: Event) => {
    const target = event.target as BluetoothRemoteGATTCharacteristic;
    if (!target.value) return;
    for (const message of decodeBleMidiPacket(target.value)) onMessage(message);
  };
  const handleDisconnected = () => onDisconnected();

  characteristic.addEventListener(
    'characteristicvaluechanged',
    handleValueChanged,
  );
  device.addEventListener('gattserverdisconnected', handleDisconnected);
  await characteristic.startNotifications();

  return {
    deviceName: device.name || 'Bluetooth MIDI',
    disconnect: () => {
      characteristic.removeEventListener(
        'characteristicvaluechanged',
        handleValueChanged,
      );
      device.removeEventListener('gattserverdisconnected', handleDisconnected);
      device.gatt?.disconnect();
    },
  };
}
