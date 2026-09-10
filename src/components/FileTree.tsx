import React, { useState } from 'react';
import { 
  Folder, FolderOpen, FileCode, FileText, ChevronRight, ChevronDown, Plus, RefreshCw
} from 'lucide-react';
import { FileNode } from '../types';

interface FileTreeProps {
  files: FileNode[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  onRefresh: () => void;
  onCreateFile: (fileName: string) => void;
  width?: number;
}

const FileTreeNode: React.FC<{
  node: FileNode;
  level: number;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}> = ({ node, level, activeFile, onSelectFile }) => {
  const [isOpen, setIsOpen] = useState(true);

  if (node.isDir) {
    return (
      <div>
        <div
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center space-x-1 px-2 py-1 rounded cursor-pointer hover:bg-studio-panel/70 text-xs text-slate-300 transition"
          style={{ paddingLeft: `${level * 14 + 8}px` }}
        >
          {isOpen ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
          {isOpen ? <FolderOpen size={14} className="text-role-user-400" /> : <Folder size={14} className="text-role-user-400" />}
          <span className="truncate">{node.name}</span>
        </div>
        {isOpen && node.children && (
          <div>
            {node.children.map(child => (
              <FileTreeNode
                key={child.path}
                node={child}
                level={level + 1}
                activeFile={activeFile}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isActive = activeFile === node.path;
  const isCode = node.name.match(/\.(js|ts|jsx|tsx|py|html|css|json|md)$/);

  return (
    <div
      onClick={() => onSelectFile(node.path)}
      className={`flex items-center space-x-1.5 px-2 py-1 rounded cursor-pointer text-xs transition ${
        isActive 
          ? 'bg-role-user-600/20 text-role-user-300 font-medium' 
          : 'text-slate-400 hover:text-slate-200 hover:bg-studio-panel/50'
      }`}
      style={{ paddingLeft: `${level * 14 + 20}px` }}
    >
      {isCode ? (
        <FileCode size={13} className={isActive ? 'text-role-user-400' : 'text-slate-400'} />
      ) : (
        <FileText size={13} className="text-slate-400" />
      )}
      <span className="truncate">{node.name}</span>
    </div>
  );
};

const FileTreeInner: React.FC<FileTreeProps> = ({
  files,
  activeFile,
  onSelectFile,
  onRefresh,
  onCreateFile,
  width = 240
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (newFileName.trim()) {
      onCreateFile(newFileName.trim());
      setNewFileName('');
      setIsCreating(false);
    }
  };

  return (
    <div 
      className="h-full flex flex-col bg-studio-surface border-r border-studio-border flex-shrink-0 select-none overflow-hidden"
      style={{ width: `${width}px` }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-studio-border text-xs font-semibold text-slate-400 uppercase tracking-wider">
        <span>Explorer</span>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setIsCreating(true)}
            className="p-1 rounded hover:bg-studio-panel hover:text-slate-200 text-slate-400 transition"
            title="New File"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={onRefresh}
            className="p-1 rounded hover:bg-studio-panel hover:text-slate-200 text-slate-400 transition"
            title="Refresh Files"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {isCreating && (
        <form onSubmit={handleCreate} className="p-2 border-b border-studio-border bg-studio-panel/50">
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder="filename.ext"
            className="w-full bg-studio-bg border border-studio-border focus:border-role-user-500 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none"
            autoFocus
            onBlur={() => {
              if (!newFileName.trim()) setIsCreating(false);
            }}
          />
        </form>
      )}

      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {files.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-400">
            No files found
          </div>
        ) : (
          files.map(node => (
            <FileTreeNode
              key={node.path}
              node={node}
              level={0}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
            />
          ))
        )}
      </div>
    </div>
  );
};

// Memoized. App holds all state in one component, so without this every
// streamed chunk re-rendered this whole subtree. Effective only because the
// handlers App passes down are now referentially stable (useEventCallback).
export const FileTree = React.memo(FileTreeInner);
