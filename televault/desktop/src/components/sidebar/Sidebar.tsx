import { useState } from "react";
import {
  Compass,
  Files,
  Image as ImageIcon,
  Cloud,
  Send,
  FolderPlus,
  Settings,
  ChevronDown,
  Folder as FolderOutlineIcon,
} from "lucide-react";
import { useApp } from "../../context/AppContext";
import type { TagItem } from "../../types";
import { TroveLogo } from "../common/Logo";

const DEFAULT_TAGS: TagItem[] = [
  { id: "keepsake", name: "Keepsake", color: "#ec4899" },
  { id: "personal", name: "Personal", color: "#64748b" },
  { id: "projects", name: "Projects", color: "#10b981" },
  { id: "memes", name: "Media", color: "#a855f7" },
  { id: "work", name: "Work", color: "#06b6d4" },
];

export function Sidebar() {
  const {
    activeView,
    setActiveView,
    currentFolderId,
    navigateToFolder,
    folders,
    createFolder,
    telegramStatus,
    telegramProfile,
    openSettings,
    openSetup,
    selectedTag,
    setSelectedTag,
  } = useApp();

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isLibraryDropdownOpen, setIsLibraryDropdownOpen] = useState(false);

  const activeAccount =
    telegramProfile ||
    (telegramStatus?.account
      ? {
          firstName: telegramStatus.account.firstName || "Telegram User",
          lastName: telegramStatus.account.lastName || "",
          username: telegramStatus.account.username || null,
          id: telegramStatus.account.telegramUserId,
        }
      : null);

  const isConnected =
    telegramStatus?.state === "connected" ||
    Boolean(telegramStatus?.sessionStored && activeAccount);

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    await createFolder(newFolderName.trim());
    setNewFolderName("");
    setIsCreatingFolder(false);
  };

  const navButtonClass = (isActive: boolean) =>
    `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150 ${
      isActive
        ? "bg-blue-600 text-white shadow-sm shadow-blue-500/20"
        : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#0e172a] hover:text-slate-900 dark:hover:text-slate-200"
    }`;

  return (
    <aside className="flex h-full w-56 flex-col border-r border-slate-200 dark:border-[#19243d] bg-white dark:bg-[#060912] text-slate-700 dark:text-slate-300 select-none transition-colors">
      {/* Top Brand & Library Selector */}
      <div className="p-3 border-b border-slate-200 dark:border-[#141e38]">
        <div className="flex items-center gap-2.5 mb-2 px-1">
          <TroveLogo size={28} />
          <div className="flex flex-col">
            <span className="text-xs font-bold tracking-tight text-slate-900 dark:text-white">Trove</span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400">Personal Cloud Storage</span>
          </div>
        </div>

        {/* Vault Library Selector Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsLibraryDropdownOpen((prev) => !prev)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-200 dark:border-[#1a2644] bg-slate-50 dark:bg-[#0c1324] px-2.5 py-1.5 text-2xs font-medium text-slate-700 dark:text-slate-300 hover:border-blue-500/40 hover:bg-slate-100 dark:hover:bg-[#131e36] transition-colors"
          >
            <div className="flex items-center gap-1.5 truncate">
              <Cloud className="h-3 w-3 text-blue-400 shrink-0" />
              <span className="truncate">
                {activeAccount?.username
                  ? `@${activeAccount.username}'s Vault`
                  : activeAccount?.firstName
                  ? `${activeAccount.firstName}'s Vault`
                  : "Telegram Cloud Vault"}
              </span>
            </div>
            <ChevronDown className="h-3 w-3 text-slate-400 shrink-0" />
          </button>

          {isLibraryDropdownOpen && (
            <div className="absolute left-0 top-full z-40 mt-1 w-full rounded-lg border border-[#1e202a] bg-[#12141c] p-1 shadow-2xl backdrop-blur-md">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400">
                Connected Vaults
              </div>
              <button
                onClick={() => {
                  setIsLibraryDropdownOpen(false);
                  setActiveView("overview");
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-white hover:bg-blue-600/20"
              >
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span className="truncate">Saved Messages Vault</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Navigation Scroll Area */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {/* Section: Overview */}
        <div>
          <button
            onClick={() => {
              setActiveView("overview");
              setSelectedTag(null);
            }}
            className={navButtonClass(activeView === "overview" && selectedTag === null)}
          >
            <Compass className="h-3.5 w-3.5" />
            <span>Overview</span>
          </button>
        </div>

        {/* Section: Storage Destinations */}
        <div>
          <div className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Storage Destinations
          </div>
          <div className="space-y-0.5">
            <button
              onClick={() => {
                setActiveView("content");
                navigateToFolder(null);
                setSelectedTag(null);
              }}
              className={navButtonClass(
                activeView === "content" && currentFolderId === null && selectedTag === null,
              )}
            >
              <Cloud className="h-3.5 w-3.5 text-blue-400" />
              <span className="truncate">Trove Cloud Vault</span>
            </button>

            <button
              onClick={() => {
                setActiveView("content");
                navigateToFolder(null);
                setSelectedTag(null);
              }}
              className={navButtonClass(false)}
            >
              <Send className="h-3.5 w-3.5 text-indigo-400" />
              <span className="truncate">Saved Messages</span>
            </button>
          </div>
        </div>

        {/* Section: Content Categories */}
        <div>
          <div className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Content
          </div>
          <div className="space-y-0.5">
            <button
              onClick={() => {
                setActiveView("content");
                setSelectedTag(null);
              }}
              className={navButtonClass(activeView === "content" && selectedTag === null)}
            >
              <Files className="h-3.5 w-3.5" />
              <span>All Files</span>
            </button>

            <button
              onClick={() => {
                setActiveView("photos");
                setSelectedTag(null);
              }}
              className={navButtonClass(activeView === "photos")}
            >
              <ImageIcon className="h-3.5 w-3.5" />
              <span>Photos & Media</span>
            </button>
          </div>
        </div>

        {/* Section: Locations / Folders */}
        <div>
          <div className="flex items-center justify-between px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <span>Locations</span>
            <button
              onClick={() => setIsCreatingFolder(true)}
              title="Add Location / Folder"
              className="text-slate-400 hover:text-blue-400 transition-colors"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* New folder creation inline input */}
          {isCreatingFolder && (
            <form onSubmit={handleCreateFolder} className="mb-2 px-1">
              <input
                type="text"
                autoFocus
                placeholder="Folder name..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={() => {
                  if (!newFolderName.trim()) setIsCreatingFolder(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setIsCreatingFolder(false);
                }}
                className="w-full rounded-md border border-blue-500 bg-[#12141c] px-2 py-1 text-xs text-white placeholder-slate-400 focus:outline-none"
              />
            </form>
          )}

          <div className="space-y-0.5">
            {folders.map((folder) => {
              const isActive = activeView === "content" && currentFolderId === folder.id;
              return (
                <button
                  key={folder.id}
                  onClick={() => {
                    setActiveView("content");
                    navigateToFolder(folder.id, folder.name);
                    setSelectedTag(null);
                  }}
                  className={navButtonClass(isActive)}
                >
                  <FolderOutlineIcon className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  <span className="truncate">{folder.name}</span>
                  {folder.fileCount > 0 && (
                    <span className="ml-auto text-[10px] text-slate-400 bg-[#151720] px-1.5 py-0.2 rounded-full">
                      {folder.fileCount}
                    </span>
                  )}
                </button>
              );
            })}

            <button
              onClick={() => setIsCreatingFolder(true)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1 text-xs text-slate-400 hover:text-slate-300 transition-colors"
            >
              <span className="text-sm leading-none">+</span>
              <span className="text-[11px]">Add Location</span>
            </button>
          </div>
        </div>

        {/* Section: Tags */}
        <div>
          <div className="px-2.5 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Tags
          </div>
          <div className="space-y-0.5">
            {DEFAULT_TAGS.map((tag) => {
              const isSelected = selectedTag === tag.id;
              return (
                <button
                  key={tag.id}
                  onClick={() => {
                    setActiveView("content");
                    setSelectedTag(isSelected ? null : tag.id);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                    isSelected
                      ? "bg-slate-200 dark:bg-[#181b24] text-slate-900 dark:text-white font-medium"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#12141c] hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="truncate">{tag.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Footer Section: Telegram Status & Settings */}
      <div className="border-t border-slate-200 dark:border-[#161720] p-2.5 space-y-2">
        {/* Telegram Connectivity Pill */}
        <button
          onClick={openSetup}
          className="flex w-full items-center justify-between rounded-lg border border-slate-200 dark:border-[#1a1c24] bg-slate-50 dark:bg-[#0c0d12] px-2.5 py-1.5 text-2xs transition-colors hover:border-slate-300 dark:hover:border-[#272a38] cursor-pointer shadow-2xs"
        >
          <div className="flex items-center gap-2 truncate">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                isConnected
                  ? "bg-emerald-500 dark:bg-emerald-400 shadow-sm shadow-emerald-400/50"
                  : "bg-amber-500 dark:bg-amber-400 animate-pulse"
              }`}
            />
            <span className="truncate text-slate-700 dark:text-slate-300 font-medium">
              {isConnected
                ? activeAccount?.username
                  ? `@${activeAccount.username}`
                  : `${activeAccount?.firstName || "Telegram Connected"}`
                : "Connect Telegram"}
            </span>
          </div>
          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
            {isConnected ? "Active" : "Setup"}
          </span>
        </button>

        {/* Settings button & app version */}
        <div className="flex items-center justify-between px-1">
          <button
            onClick={openSettings}
            className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>Settings</span>
          </button>
          <span className="text-[10px] text-slate-400 font-mono">v0.1.0</span>
        </div>
      </div>
    </aside>
  );
}
