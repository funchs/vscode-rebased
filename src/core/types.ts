export interface CommitRef {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  email: string;
  date: number;
  subject: string;
  refs: string[];
}

export interface FileChange {
  path: string;
  staged: boolean;
  status: "M" | "A" | "D" | "R" | "C" | "U" | "?";
  oldPath?: string;
}

export interface StashEntry {
  index: number;
  ref: string;
  subject: string;
  branch: string;
}

export interface BranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export type RebaseAction =
  | "pick"
  | "reword"
  | "edit"
  | "squash"
  | "fixup"
  | "drop"
  | "exec"
  | "break"
  | "label"
  | "reset"
  | "merge";

export interface RebaseTodoEntry {
  action: RebaseAction;
  hash?: string;
  subject?: string;
  argument?: string;
}
