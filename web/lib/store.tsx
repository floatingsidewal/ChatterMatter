"use client";

import {
  createContext,
  useContext,
  useReducer,
  type ReactNode,
  type Dispatch,
} from "react";
import {
  loadBlocks,
  getCleanContent,
  buildThreads,
  addComment as cmAddComment,
  resolveBlock as cmResolveBlock,
  deleteBlock as cmDeleteBlock,
  type Block,
  type BlockType,
  type Anchor,
  type ThreadNode,
} from "./chattermatter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentEntry {
  id: string;
  fileName: string;
  markdown: string;
  cleanContent: string;
  blocks: Block[];
  threads: ThreadNode[];
}

interface AppState {
  documents: DocumentEntry[];
  activeDocumentId: string | null;
  authorName: string;
}

type Action =
  | { type: "LOAD_DOCUMENT"; fileName: string; markdown: string }
  | { type: "SET_ACTIVE"; id: string }
  | { type: "ADD_COMMENT"; content: string; blockType?: BlockType; anchor?: Anchor; parentId?: string; suggestion?: { original: string; replacement: string } }
  | { type: "RESOLVE_BLOCK"; blockId: string }
  | { type: "DELETE_BLOCK"; blockId: string }
  | { type: "UPDATE_MARKDOWN"; markdown: string }
  | { type: "SET_AUTHOR"; name: string }
  | { type: "REMOVE_DOCUMENT"; id: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveDocument(id: string, fileName: string, markdown: string): DocumentEntry {
  const { blocks: parsedBlocks } = loadBlocks(markdown);
  const blocks = parsedBlocks.map((pb) => pb.block);
  return {
    id,
    fileName,
    markdown,
    cleanContent: getCleanContent(markdown),
    blocks,
    threads: buildThreads(blocks),
  };
}

function updateActiveDocument(state: AppState, updater: (doc: DocumentEntry) => DocumentEntry): AppState {
  if (!state.activeDocumentId) return state;
  return {
    ...state,
    documents: state.documents.map((doc) =>
      doc.id === state.activeDocumentId ? updater(doc) : doc,
    ),
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "LOAD_DOCUMENT": {
      const id = crypto.randomUUID();
      const doc = deriveDocument(id, action.fileName, action.markdown);
      return {
        ...state,
        documents: [...state.documents, doc],
        activeDocumentId: id,
      };
    }

    case "SET_ACTIVE":
      return { ...state, activeDocumentId: action.id };

    case "ADD_COMMENT": {
      return updateActiveDocument(state, (doc) => {
        const { markdown } = cmAddComment(doc.markdown, {
          content: action.content,
          type: action.blockType,
          author: state.authorName || undefined,
          anchor: action.anchor,
          parent_id: action.parentId,
          suggestion: action.suggestion,
        });
        return deriveDocument(doc.id, doc.fileName, markdown);
      });
    }

    case "RESOLVE_BLOCK":
      return updateActiveDocument(state, (doc) => {
        const markdown = cmResolveBlock(doc.markdown, action.blockId);
        return deriveDocument(doc.id, doc.fileName, markdown);
      });

    case "DELETE_BLOCK":
      return updateActiveDocument(state, (doc) => {
        const markdown = cmDeleteBlock(doc.markdown, action.blockId);
        return deriveDocument(doc.id, doc.fileName, markdown);
      });

    case "UPDATE_MARKDOWN":
      return updateActiveDocument(state, (doc) =>
        deriveDocument(doc.id, doc.fileName, action.markdown),
      );

    case "SET_AUTHOR":
      return { ...state, authorName: action.name };

    case "REMOVE_DOCUMENT":
      return {
        ...state,
        documents: state.documents.filter((d) => d.id !== action.id),
        activeDocumentId:
          state.activeDocumentId === action.id
            ? state.documents.find((d) => d.id !== action.id)?.id ?? null
            : state.activeDocumentId,
      };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const initialState: AppState = {
  documents: [],
  activeDocumentId: null,
  authorName: "",
};

const StoreContext = createContext<{
  state: AppState;
  dispatch: Dispatch<Action>;
}>({ state: initialState, dispatch: () => {} });

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  return useContext(StoreContext);
}

export function useActiveDocument(): DocumentEntry | null {
  const { state } = useStore();
  if (!state.activeDocumentId) return null;
  return state.documents.find((d) => d.id === state.activeDocumentId) ?? null;
}
