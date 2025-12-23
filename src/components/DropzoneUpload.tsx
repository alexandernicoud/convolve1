import { useCallback, useState } from "react";
import { Upload, File, X } from "lucide-react";

interface DropzoneUploadProps {
  accept: string;
  label: string;
  hint: string;
  onFileSelect: (file: File | null) => void;
}

export default function DropzoneUpload({ accept, label, hint, onFileSelect }: DropzoneUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragIn = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragOut = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setFile(files[0]);
      onFileSelect(files[0]);
    }
  }, [onFileSelect]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setFile(files[0]);
      onFileSelect(files[0]);
    }
  }, [onFileSelect]);

  const clearFile = useCallback(() => {
    setFile(null);
    onFileSelect(null);
  }, [onFileSelect]);

  if (file) {
    return (
      <div className="bg-secondary/50 border border-border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
              <File className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          </div>
          <button
            onClick={clearFile}
            className="p-2 hover:bg-secondary rounded-md transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <label
      onDragEnter={handleDragIn}
      onDragLeave={handleDragOut}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      className={`
        relative block border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
        transition-all duration-200
        ${isDragging 
          ? 'border-primary bg-primary/5' 
          : 'border-border hover:border-muted-foreground/50 hover:bg-secondary/30'
        }
      `}
    >
      <input
        type="file"
        accept={accept}
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
      <Upload className={`w-8 h-8 mx-auto mb-3 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
      <p className="text-sm font-medium text-foreground mb-1">{label}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </label>
  );
}
