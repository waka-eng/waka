/** Device services used by the shared app. Native session/capture integration
 * follows in M2/M3; this foundation proves the underlying native contracts. */
export interface CredentialStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface LocalFileStore {
  write(path: string, text: string): Promise<void>;
  read(path: string): Promise<string>;
  remove(path: string): Promise<void>;
}
export interface AppIdentity {
  id: string;
  name: string;
  version: string;
  platform: 'ios' | 'android';
}
export interface PlatformServices {
  identity(): Promise<AppIdentity>;
  credentials: CredentialStore;
  files: LocalFileStore;
  health(): Promise<{ connected: boolean; origin: string }>;
  openBrowser(url: string): Promise<void>;
  listenForLinks(listener: (url: string) => void): Promise<() => void>;
}
