import type { FileMetadata, Folder } from "@shared/types";

export type NavView =
  | "overview"
  | "content"
  | "photos"
  | "locations"
  | "tags";

export type ViewMode = "grid" | "list";

export type SortField = "name" | "size" | "date" | "type";
export type SortOrder = "asc" | "desc";

export interface TagItem {
  id: string;
  name: string;
  color: string;
}

export interface BreadcrumbItem {
  id: string | null;
  name: string;
}

export interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  file?: FileMetadata;
  folder?: Folder;
}

export interface ToastMessage {
  id: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message?: string;
}

