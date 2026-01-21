export enum ConnectionState {
  IDLE = 'IDLE',
  GENERATING = 'GENERATING',
  OFFERING = 'OFFERING',
  ANSWERING = 'ANSWERING',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED'
}

export type Theme = 'light' | 'dark' | 'modern';
export type Language = 'uk' | 'en';
export type EncLevel = 'standard' | 'personal' | 'open';

export interface CryptoConfig {
  encLevel: EncLevel;
  passphrase: string;
  useMic: boolean;
}

export interface FileMeta {
  name: string;
  mime: string;
  size: number;
  url?: string;
}

export interface Message {
  id: string;
  type: 'sent' | 'received' | 'system';
  content: string;
  timestamp: number;
  file?: FileMeta;
}
