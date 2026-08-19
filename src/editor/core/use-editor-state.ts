import { useSyncExternalStore } from 'react';
import { editorStore, type EditorState } from './store';

export function useEditorState(): EditorState {
  return useSyncExternalStore(editorStore.subscribe, editorStore.getState, editorStore.getState);
}
