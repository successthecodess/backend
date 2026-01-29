import multer from 'multer';
import path from 'path';

const storage = multer.memoryStorage();

// Allowed MIME types for file uploads
const ALLOWED_MIME_TYPES = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

// Allowed file extensions (must match MIME types)
const ALLOWED_EXTENSIONS = ['.csv', '.xlsx'];

/**
 * Sanitize filename to prevent path traversal and injection attacks
 * Removes any path components and dangerous characters
 */
function sanitizeFilename(filename: string): string {
  // Get just the filename without any path
  const basename = path.basename(filename);
  // Remove any characters that aren't alphanumeric, dots, hyphens, or underscores
  return basename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Validate file extension matches expected patterns
 */
function isAllowedExtension(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

export const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1, // Only allow single file upload
  },
  fileFilter: (req, file, cb) => {
    // Check MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only CSV and Excel files are allowed.'));
    }

    // Check file extension (defense in depth - MIME types can be spoofed)
    if (!isAllowedExtension(file.originalname)) {
      return cb(new Error('Invalid file extension. Only .csv and .xlsx files are allowed.'));
    }

    // Sanitize the filename to prevent path traversal
    file.originalname = sanitizeFilename(file.originalname);

    cb(null, true);
  },
});

/**
 * Sanitize CSV content to prevent formula injection attacks
 * Prefixes cells that start with dangerous characters with a single quote
 */
export function sanitizeCsvContent(content: string): string {
  const dangerousChars = ['=', '+', '-', '@', '\t', '\r'];

  return content
    .split('\n')
    .map(line => {
      return line
        .split(',')
        .map(cell => {
          const trimmed = cell.trim();
          // If cell starts with a dangerous character, prefix with single quote
          if (dangerousChars.some(char => trimmed.startsWith(char))) {
            return `'${trimmed}`;
          }
          return cell;
        })
        .join(',');
    })
    .join('\n');
}
