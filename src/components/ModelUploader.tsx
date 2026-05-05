import { useState, useRef, useCallback } from "react";
import { Upload, X, File, AlertTriangle, CheckCircle, Brain } from "lucide-react";
import { apiUrl } from "@/lib/api";

/** Matches backend ModelUploadResponse; absolute_path is the canonical file location on the API host. */
interface UploadedModel {
  model_id: string;
  storage_key: string;
  absolute_path: string;
  original_filename: string;
  byte_size: number;
  content_type: string;
  saved_at: string;
  filename: string;
  size: number;
  uploaded_at: string;
}

interface ModelUploaderProps {
  onModelUploaded: (model: UploadedModel) => void;
  onModelRemoved: () => void;
  uploadedModel?: UploadedModel | null;
  /** Tighter padding and height for side-by-side layout */
  compact?: boolean;
}

export default function ModelUploader({
  onModelUploaded,
  onModelRemoved,
  uploadedModel,
  compact = false,
}: ModelUploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const validateFile = (file: File): string | null => {
    if (!file.name.toLowerCase().endsWith('.keras')) {
      return "Only .keras files are supported";
    }
    if (file.size > 500 * 1024 * 1024) { // 500MB
      return "File size exceeds 500MB limit";
    }
    return null;
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length !== 1) {
      setError("Please drop exactly one .keras file");
      return;
    }

    const file = files[0];
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    await uploadFile(file);
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length !== 1) return;

    const file = files[0];
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    await uploadFile(file);
  };

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    setError(null);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      const uploadPromise = new Promise<{
        model_id: string;
        storage_key: string;
        absolute_path: string;
        original_filename: string;
        byte_size: number;
        content_type: string;
        saved_at: string;
      }>((resolve, reject) => {
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText);
              resolve(response);
            } catch (e) {
              reject(new Error('Invalid response from server'));
            }
          } else {
            try {
              const errorResponse = JSON.parse(xhr.responseText);
              reject(new Error(errorResponse.detail || 'Upload failed'));
            } catch (e) {
              reject(new Error(`Upload failed with status ${xhr.status}`));
            }
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error during upload'));
        });

        xhr.open('POST', apiUrl('/models/upload'));
        xhr.send(formData);
      });

      const response = await uploadPromise;

      const uploadedModel: UploadedModel = {
        model_id: response.model_id,
        storage_key: response.storage_key,
        absolute_path: response.absolute_path,
        original_filename: response.original_filename,
        byte_size: response.byte_size,
        content_type: response.content_type,
        saved_at: response.saved_at,
        filename: file.name,
        size: file.size,
        uploaded_at: new Date().toISOString(),
      };

      onModelUploaded(uploadedModel);
      setUploadProgress(100);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleRemove = () => {
    onModelRemoved();
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const dzPad = compact ? "p-4 min-h-[100px]" : "p-8";
  const iconWrap = compact ? "p-2.5" : "p-4";
  const iconSz = compact ? "w-5 h-5" : "w-8 h-8";
  const titleCls = compact ? "text-sm font-medium text-white mb-1" : "text-lg font-medium text-white mb-2";
  const subCls = compact ? "text-xs text-[rgba(255,255,255,0.6)] leading-snug" : "text-sm text-[rgba(255,255,255,0.65)]";

  return (
    <div className={compact ? "space-y-2" : "space-y-4"}>
      {!uploadedModel ? (
        <>
          {/* Dropzone */}
          <div
            className={`relative border-2 border-dashed rounded-lg text-center transition-all duration-200 cursor-pointer ${dzPad} ${
              isDragOver
                ? 'border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.06)]'
                : 'border-[rgba(255,255,255,0.15)] hover:border-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.15)]'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".keras"
              onChange={handleFileSelect}
              className="hidden"
            />

            <div className={`flex flex-col items-center ${compact ? "gap-2" : "gap-4"}`}>
              <div className={`${iconWrap} rounded-full ${isDragOver ? 'bg-[rgba(255,255,255,0.06)]' : 'bg-[rgba(255,255,255,0.15)]'}`}>
                <Brain className={`${iconSz} ${isDragOver ? 'text-[#737373]' : 'text-white'}`} />
              </div>

              <div>
                <h3 className={titleCls}>
                  Keras Model (.keras)
                </h3>
                <p className={subCls}>
                  {isDragOver ? 'Drop file here' : compact ? 'Drop or click — .keras' : 'Drag & drop your trained Keras model, or click to browse'}
                </p>
              </div>

              {isUploading && (
                <div className="w-full max-w-xs">
                  <div className="w-full bg-[rgba(0,0,0,0.2)] rounded-full h-2 mb-2">
                    <div
                      className="bg-gradient-to-r from-[#737373] to-[#a3a3a3] h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="text-xs text-[rgba(255,255,255,0.65)]">
                    Uploading... {uploadProgress}%
                  </p>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Uploaded Model Display */
        <div className={`bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.06)] rounded-lg ${compact ? "p-3" : "p-4"}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2 sm:gap-3">
              <div className={`${compact ? "p-1.5" : "p-2"} bg-[rgba(255,255,255,0.06)] rounded-lg`}>
                <CheckCircle className={`${compact ? "w-4 h-4" : "w-5 h-5"} text-[#737373]`} />
              </div>
              <div className="min-w-0">
                <h4 className={`font-medium text-white ${compact ? "text-xs truncate" : ""}`}>{uploadedModel.filename}</h4>
                <p className={`text-[rgba(255,255,255,0.65)] ${compact ? "text-[10px]" : "text-sm"}`}>
                  {formatFileSize(uploadedModel.size)} • {new Date(uploadedModel.uploaded_at).toLocaleDateString()}
                </p>
              </div>
            </div>
            <button
              onClick={handleRemove}
              className="p-1 hover:bg-[rgba(255,255,255,0.05)] rounded transition-colors"
              title="Remove model"
            >
              <X className="w-4 h-4 text-[rgba(255,255,255,0.5)]" />
            </button>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-white/15 bg-white/[0.04] p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#fca5a5]" />
          <div>
            <p className="text-sm text-white/90">{error}</p>
            <p className="text-xs text-[rgba(255,255,255,0.5)] mt-1">
              Try uploading a valid .keras file under 500MB
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

