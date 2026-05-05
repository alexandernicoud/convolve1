import { useState, useRef, useCallback } from "react";
import { Upload, X, File, AlertTriangle, CheckCircle } from "lucide-react";
import { apiUrl, fetchApi } from "@/lib/api";

interface DatasetSummary {
  total_images: number;
  label_distribution: Record<string, number>;
  example_filenames: string[];
}

interface UploadedDataset {
  dataset_id: string;
  extracted_path: string;
  summary: DatasetSummary;
}

interface DatasetUploaderProps {
  onDatasetUploaded: (dataset: UploadedDataset) => void;
  onDatasetRemoved: () => void;
  uploadedDataset?: UploadedDataset | null;
  compact?: boolean;
}

export default function DatasetUploader({
  onDatasetUploaded,
  onDatasetRemoved,
  uploadedDataset,
  compact = false,
}: DatasetUploaderProps) {
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
    if (!file.name.toLowerCase().endsWith('.zip')) {
      return "Only ZIP files are supported";
    }
    if (file.size > 2 * 1024 * 1024 * 1024) { // 2GB
      return "File size exceeds 2GB limit";
    }
    return null;
  };

  const validateFileContent = async (file: File): Promise<string | null> => {
    // Check if it's actually a ZIP file by reading the header
    const header = await file.slice(0, 4).arrayBuffer();
    const headerBytes = new Uint8Array(header);
    const zipSignature = [0x50, 0x4B, 0x03, 0x04];

    for (let i = 0; i < 4; i++) {
      if (headerBytes[i] !== zipSignature[i]) {
        return "File does not appear to be a valid ZIP archive. Please check the file and try again.";
      }
    }

    return null;
  };

  const uploadFile = async (file: File) => {
    // Clear previous errors
    setError(null);

    // Basic validation
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    // Content validation
    try {
      const contentError = await validateFileContent(file);
      if (contentError) {
        setError(contentError);
        return;
      }
    } catch (err) {
      setError("Unable to read file. Please try again.");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    // Check if backend is accessible first
    try {
      await fetchApi('/datasets/test', { method: 'HEAD' });
    } catch {
      setError("Backend not running. Start the dev server with 'npm run dev'.");
      setIsUploading(false);
      return;
    }

    try {
      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const progress = (e.loaded / e.total) * 100;
          setUploadProgress(progress);
        }
      });

      // Handle completion
      xhr.addEventListener('load', () => {
        console.log('Upload completed with status:', xhr.status);
        console.log('Response:', xhr.responseText);

        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            onDatasetUploaded(response);
            setIsUploading(false);
          } catch (parseError) {
            console.error('JSON parse error:', parseError);
            setError(`Server response parsing failed: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`);
            setIsUploading(false);
          }
        } else {
          // Handle different HTTP status codes
          let errorMessage = `Upload failed with status ${xhr.status}`;

          if (xhr.status === 413) {
            errorMessage = "File too large. Please use a smaller ZIP file (under 2GB).";
          } else if (xhr.status === 415) {
            errorMessage = "Invalid file type. Only ZIP files are supported.";
          } else if (xhr.status === 422) {
            errorMessage = "File validation failed. Check file format and contents.";
          } else if (xhr.status >= 500) {
            errorMessage = "Server error. Please try again later.";
          }

          try {
            const errorData = JSON.parse(xhr.responseText);
            if (errorData.detail) {
              errorMessage += `: ${errorData.detail}`;
            }
          } catch {
            // If we can't parse error response, keep the generic message
            if (xhr.responseText) {
              errorMessage += ` - ${xhr.responseText.slice(0, 100)}`;
            }
          }

          setError(errorMessage);
          setIsUploading(false);
        }
      });

      // Handle network errors
      xhr.addEventListener('error', () => {
        console.error('Network error during upload');
        setError("Network connection failed. Check that the dev server is running (Vite proxies to the API) or set VITE_API_BASE_URL if the API is elsewhere.");
        setIsUploading(false);
      });

      // Handle timeout
      xhr.addEventListener('timeout', () => {
        console.error('Upload timeout');
        setError("Upload timed out. The file may be too large or the server is busy. Try with a smaller file.");
        setIsUploading(false);
      });

      // Handle abort
      xhr.addEventListener('abort', () => {
        console.log('Upload was cancelled by user');
        setError("Upload was cancelled");
        setIsUploading(false);
      });

      // Set timeout (5 minutes for large files)
      xhr.timeout = 5 * 60 * 1000;

      xhr.open('POST', apiUrl('/datasets/upload'));
      xhr.send(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setIsUploading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      uploadFile(files[0]);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      uploadFile(files[0]);
    }
  };

  const handleRemove = () => {
    onDatasetRemoved();
    setError(null);
    setUploadProgress(0);
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

  if (uploadedDataset) {
    return (
      <div className={`bg-[#0a0a0a]/60 border border-white/8 rounded-lg ${compact ? "p-3" : "p-4"}`}>
        <div className={`flex items-start justify-between ${compact ? "mb-2" : "mb-3"}`}>
          <div className="flex items-center gap-2">
            <CheckCircle className={`${compact ? "w-4 h-4" : "w-5 h-5"} text-[#e5e5e5]`} />
            <h3 className={`font-semibold text-[#F5F5F5] ${compact ? "text-xs" : "text-sm"}`}>Dataset</h3>
          </div>
          <button
            onClick={handleRemove}
            className="p-1 text-[#F5F5F5]/60 hover:text-[#f87171] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={`grid grid-cols-2 gap-2 text-sm ${compact ? "text-xs" : ""}`}>
          <div>
            <span className="text-[#F5F5F5]/62">Images:</span>
            <span className="text-[#F5F5F5] ml-2">{uploadedDataset.summary.total_images}</span>
          </div>
          <div>
            <span className="text-[#F5F5F5]/62">Classes:</span>
            <span className="text-[#F5F5F5] ml-2">
              {Object.keys(uploadedDataset.summary.label_distribution).length}
            </span>
          </div>
        </div>

        {!compact && Object.keys(uploadedDataset.summary.label_distribution).length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-[#F5F5F5]/62 mb-2">Label Distribution:</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(uploadedDataset.summary.label_distribution).map(([label, count]) => (
                <span
                  key={label}
                  className="px-2 py-1 bg-white/10 text-white text-xs rounded"
                >
                  {label}: {count}
                </span>
              ))}
            </div>
          </div>
        )}

        {!compact && uploadedDataset.summary.example_filenames.length > 0 && (
          <div className="mt-3">
            <div className="text-xs text-[#F5F5F5]/62 mb-2">Example Files:</div>
            <div className="space-y-1">
              {uploadedDataset.summary.example_filenames.slice(0, 3).map((filename, idx) => (
                <div key={idx} className="text-xs text-[#F5F5F5]/80 font-mono">
                  {filename}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const dzPad = compact ? "p-4 min-h-[100px]" : "p-6";
  const upIcon = compact ? "w-8 h-8 mb-2" : "w-12 h-12 mx-auto mb-4";

  return (
    <div className="space-y-3">
      <div
        className={`border-2 border-dashed rounded-lg text-center transition-all duration-200 cursor-pointer ${dzPad}
          ${isDragOver
            ? 'border-[#737373] bg-[#737373]/10'
            : 'border-white/30/45 hover:border-[#737373]/70 hover:bg-[#737373]/5'
          }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip"
          onChange={handleFileSelect}
          className="hidden"
        />

        {isUploading ? (
          <div className={compact ? "space-y-2" : "space-y-3"}>
            <div className={`${compact ? "w-8 h-8" : "w-12 h-12"} mx-auto border-2 border-white/30 border-t-transparent rounded-full animate-spin`} />
            <div>
              <div className={`font-medium text-[#F5F5F5] mb-2 ${compact ? "text-xs" : "text-sm"}`}>Uploading...</div>
              <div className="w-full bg-[#0a0a0a]/60 rounded-full h-2">
                <div
                  className="bg-white h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className="text-xs text-[#F5F5F5]/62 mt-1">
                {uploadProgress.toFixed(1)}%
              </div>
            </div>
          </div>
        ) : (
          <div>
            <Upload className={`${upIcon} text-white/60 mx-auto`} />
            <div className={`font-medium text-[#F5F5F5] mb-1 ${compact ? "text-xs" : "text-sm mb-2"}`}>
              {compact ? "ZIP — drop or click" : "Drop ZIP file here or click to browse"}
            </div>
            <div className={`text-[#F5F5F5]/62 ${compact ? "text-[10px]" : "text-xs"}`}>
              .zip · max 2GB
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 bg-[#f87171]/10 border border-[#f87171]/20 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-[#f87171] flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-semibold text-[#f87171] mb-2">Upload Error</div>
            <div className="text-sm text-[#F5F5F5]/80 mb-3">{error}</div>

            {/* Troubleshooting hints */}
            <div className="text-xs text-[#F5F5F5]/60 space-y-1">
              <div><strong>Troubleshooting:</strong></div>
              {error.includes('Backend not running') && (
                <div>• Start both servers with: <code className="bg-[#0a0a0a] px-1 rounded">npm run dev</code></div>
              )}
              {error.includes('File too large') && (
                <div>• Try compressing your images or reducing image quality</div>
              )}
              {error.includes('Invalid file type') && (
                <div>• Ensure your file is a valid ZIP archive containing image files</div>
              )}
              {error.includes('timed out') && (
                <div>• Try uploading a smaller file or check your internet connection</div>
              )}
              {!error.includes('Backend') && !error.includes('large') && !error.includes('type') && !error.includes('timeout') && (
                <div>• Check browser console (F12) for detailed error information</div>
              )}
            </div>

            {/* Technical details (collapsible) */}
            <details className="mt-3 text-xs text-[#F5F5F5]/50">
              <summary className="cursor-pointer hover:text-[#F5F5F5]/70">Show technical details</summary>
              <div className="mt-2 p-2 bg-[#0a0a0a]/60 rounded border border-white/5 font-mono text-xs">
                <div>Timestamp: {new Date().toISOString()}</div>
                <div>User Agent: {navigator.userAgent.slice(0, 50)}...</div>
                <div>Upload URL: /datasets/upload</div>
                <div>Error: {error}</div>
                <div className="mt-2 text-[#F5F5F5]/40">
                  Check browser Network tab (F12) for full request/response details
                </div>
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}
