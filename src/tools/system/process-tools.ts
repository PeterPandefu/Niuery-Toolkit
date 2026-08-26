import { invoke } from '@tauri-apps/api/core';

export interface ProcessTarget {
  pid: number;
  creationTime: number;
}

export interface PortEndpoint {
  protocol: 'tcp' | 'udp';
  localAddress: string;
  state: string | null;
}

export interface ProcessOwner {
  target: ProcessTarget;
  name: string;
  executablePath: string | null;
  endpoints: PortEndpoint[];
}

export type TerminationStatus = 'terminated' | 'alreadyExited' | 'accessDenied' | 'protected' | 'identityChanged' | 'failed';

export interface ProcessTerminationResult {
  pid: number;
  status: TerminationStatus;
  message: string | null;
}

export function validatePortInput(value: string): string | null {
  if (!/^(?:[1-9]\d{0,4})$/.test(value) || Number(value) > 65535) {
    return '端口必须在 1 到 65535 之间';
  }
  return null;
}

export function findPortOwners(port: number) {
  return invoke<ProcessOwner[]>('find_port_owners', { port });
}

export function findFileLockOwners(path: string) {
  return invoke<ProcessOwner[]>('find_file_lock_owners', { path });
}

export function terminateProcesses(targets: ProcessTarget[]) {
  return invoke<ProcessTerminationResult[]>('terminate_processes', { targets });
}

export function pickExistingFile() {
  return invoke<string | null>('pick_existing_file');
}
