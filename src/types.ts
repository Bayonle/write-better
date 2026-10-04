export interface Run {
  id: string;
  text: string;
  dim?: boolean;
  alternatives?: string[];
  choice?: number;
  article?: boolean;
}
export interface Block {
  id: string;
  runs: Run[];
}
export interface Draft {
  id: string;
  title: string;
  blocks: Block[];
  overflow: { id: string; text: string }[];
  updated: number;
}
export interface TextSelection {
  blockId: string;
  start: number;
  end: number;
  endBlockId?: string;
}
export type Mutate = (edit: (draft: Draft) => void, kind?: string) => void;
export type Provider = "codex" | "api";
export type AIMode = "alternatives" | "trim" | "tighten" | "half" | "proofread";
export interface AIInput {
  text: string;
  mode: AIMode;
  provider: Provider;
  before?: string;
  after?: string;
}
export interface AIConfig {
  ai: boolean;
  providers: Record<Provider, boolean>;
  defaultProvider: Provider;
}
export type ChatGPTConnection =
  | { status: "idle" | "starting" | "connected" }
  | { status: "waiting"; authUrl: string }
  | { status: "error"; message: string };
export interface AITarget extends TextSelection {
  text: string;
  docId: string;
  before: string;
  after: string;
}
