import React, { useState } from 'react'

interface FolderSelectorProps {
  onFolderSelected: (folderHandle: FileSystemDirectoryHandle) => void;
}

const FolderSelector: React.FC<FolderSelectorProps> = ({ onFolderSelected }) => {
  const [status, setStatus] = useState('No folder selected');

  const selectFolder = async () => {
    try {
      // @ts-ignore: File System Access API is not yet fully typed
      const folderHandle = await window.showDirectoryPicker();
      onFolderSelected(folderHandle);
      setStatus(`Selected: ${folderHandle.name}`);
    } catch (error: any) {
      if (error.name === 'AbortError') {
        setStatus('Folder selection cancelled');
      } else {
        setStatus(`Error: ${error.message}`);
        console.error('Error selecting folder:', error);
      }
    }
  };

  return (
    <div style={{ position: 'absolute', top: 10, left: 10, background: 'white', padding: 10, borderRadius: 5, zIndex: 100 }}>
      <button onClick={selectFolder}>Select MW3 Game Folder</button>
      <p>{status}</p>
    </div>
  );
};

export default FolderSelector;
