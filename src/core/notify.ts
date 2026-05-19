import * as vscode from "vscode";
import { stripCodicons, firstNonEmptyLine, isWorkingTreeDirtyError, isIndexLockError } from "./notify-pure";
import { getIndexLockInfo, removeIndexLock } from "./git";

export { stripCodicons, isWorkingTreeDirtyError };

export interface ErrorAction {
  label: string;
  run: () => Promise<void> | void;
}

// Surface a git error in two layers:
//   • A single-line summary toast with a "Details" button.
//   • Optional inline actions (Stash and retry, etc.) appear as additional buttons.
//   • "Details" opens a modal with the full multi-line message — VS Code toasts
//     silently collapse newlines, so we need the modal `detail` field.
export async function showGitError(
  scope: string,
  err: unknown,
  actions: ErrorAction[] = []
): Promise<void> {
  const raw = (err instanceof Error ? err.message : String(err)).trim();
  const summary = firstNonEmptyLine(raw);
  const cleanScope = stripCodicons(scope);
  const labels = ["Details", ...actions.map((a) => a.label)];
  const pick = await vscode.window.showErrorMessage(
    `${cleanScope}: ${summary}`,
    ...labels
  );
  if (!pick) return;
  if (pick === "Details") {
    await vscode.window.showErrorMessage(vscode.l10n.t("{0} — full error", cleanScope), {
      modal: true,
      detail: raw,
    });
    return;
  }
  const chosen = actions.find((a) => a.label === pick);
  if (chosen) await chosen.run();
}

// Inspect a git error message; if it's clearly an index.lock collision, offer
// to remove the lock and signal the caller to retry. Caller decides whether
// it's safe to retry the operation it just attempted.
export type LockRecovery = "retry" | "abort" | "not-applicable";

export async function maybeRecoverFromIndexLock(root: string, message: string): Promise<LockRecovery> {
  if (!isIndexLockError(message)) return "not-applicable";
  const info = await getIndexLockInfo(root);
  if (!info.exists) {
    // The error mentioned index/lock but the file isn't there now — could be a
    // perm/disk problem. Defer to the generic toast.
    return "not-applicable";
  }
  const ageSec = Math.max(0, Math.round((Date.now() - (info.mtimeMs ?? Date.now())) / 1000));
  const ageStr =
    ageSec < 60 ? vscode.l10n.t("{0}s old", String(ageSec)) :
    ageSec < 3600 ? vscode.l10n.t("{0} min old", String(Math.round(ageSec / 60))) :
    vscode.l10n.t("{0} h old", String(Math.round(ageSec / 3600)));
  const fresh = ageSec < 3;
  const waitLabel = vscode.l10n.t("Wait 2s and retry");
  const removeLabel = vscode.l10n.t("Remove lock and retry");
  const choice = await vscode.window.showWarningMessage(
    fresh
      ? vscode.l10n.t("Another git process is currently holding the index (.git/index.lock is {0} — likely still active). Wait a moment and retry, or force-remove.", ageStr)
      : vscode.l10n.t("Stale .git/index.lock detected ({0}). This usually means an earlier git command was interrupted. Removing it is safe IF no other git command is running right now.", ageStr),
    { modal: true, detail: message },
    fresh ? waitLabel : removeLabel,
    vscode.l10n.t("Cancel")
  );
  if (choice === waitLabel) {
    await new Promise((r) => setTimeout(r, 2000));
    return "retry";
  }
  if (choice === removeLabel) {
    try {
      await removeIndexLock(root);
    } catch (e: unknown) {
      await vscode.window.showErrorMessage(vscode.l10n.t("Failed to remove lock: {0}", (e as Error).message));
      return "abort";
    }
    return "retry";
  }
  return "abort";
}
