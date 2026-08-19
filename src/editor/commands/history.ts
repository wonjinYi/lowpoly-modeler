import { cloneDocument, type SceneDocument } from '../core/types';

export interface DocumentCommand {
  label: string;
  before: SceneDocument;
  after: SceneDocument;
}

export interface CommandHistory {
  past: DocumentCommand[];
  future: DocumentCommand[];
}

export const EMPTY_HISTORY: CommandHistory = { past: [], future: [] };

export function createDocumentCommand(
  label: string,
  before: SceneDocument,
  after: SceneDocument,
): DocumentCommand {
  return { label, before: cloneDocument(before), after: cloneDocument(after) };
}

export function executeCommand(
  document: SceneDocument,
  history: CommandHistory,
  command: DocumentCommand,
): { document: SceneDocument; history: CommandHistory } {
  if (JSON.stringify(command.before) !== JSON.stringify(document)) {
    throw new Error(`Cannot execute "${command.label}" because the source document has changed.`);
  }

  return {
    document: cloneDocument(command.after),
    history: { past: [...history.past, command], future: [] },
  };
}

export function undoCommand(
  document: SceneDocument,
  history: CommandHistory,
): { document: SceneDocument; history: CommandHistory } | null {
  const command = history.past.at(-1);
  if (!command) {
    return null;
  }
  if (JSON.stringify(command.after) !== JSON.stringify(document)) {
    throw new Error(`Cannot undo "${command.label}" because the document has changed.`);
  }

  return {
    document: cloneDocument(command.before),
    history: { past: history.past.slice(0, -1), future: [command, ...history.future] },
  };
}

export function redoCommand(
  document: SceneDocument,
  history: CommandHistory,
): { document: SceneDocument; history: CommandHistory } | null {
  const command = history.future[0];
  if (!command) {
    return null;
  }
  if (JSON.stringify(command.before) !== JSON.stringify(document)) {
    throw new Error(`Cannot redo "${command.label}" because the document has changed.`);
  }

  return {
    document: cloneDocument(command.after),
    history: { past: [...history.past, command], future: history.future.slice(1) },
  };
}
