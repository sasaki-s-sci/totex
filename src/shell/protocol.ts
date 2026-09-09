/** The shell owns the document and update transaction; fronts own their React trees. */
export type Snapshot = { schema: 1; values: Record<string, unknown> };
export type Front = {
  snapshot(): Promise<Snapshot>;
  dispose(): Promise<void>;
  views(): string;
  version(): string;
  swap(version?: string): Promise<() => void>;
  focus(): void;
};
export type Connection = {
  snapshot?: Snapshot;
  install(front: Front): void;
  ready(): void;
  failed(reason: unknown): void;
  activate(version?: string): Promise<void>;
};
export type Shell = { connect(source: Window): Connection };
declare global {
  interface Window {
    __TOTEX_SHELL__?: Shell;
  }
}
